import { STUDY_FILE_FIELD } from '@/app/lib/analysis-upload-contract';
import { ApiErrorCode } from '@/app/lib/api-errors';
import { fail } from '@/app/lib/api-response';
import { env } from '@/app/lib/env';
import { HttpStatus } from '@/app/lib/http-status';
import { isValidWebhookUrl } from '@/app/lib/webhook';

/**
 * Request-shape guards shared by both ways a study reaches the pipeline: the
 * token-authenticated `/api/v1/[token]/analyses` (an integration posting from a
 * gateway or the widget) and `/api/organization/analyses/upload` (a signed-in
 * user uploading from the portal).
 *
 * Only the *authentication* differs between the two — the size caps, the form
 * field names and the webhook validation are the same contract, so they live
 * here instead of being re-typed per route and drifting apart.
 */

type WarnLogger = { warn: (_obj: object, _msg: string) => void };

/**
 * Rejects an oversized study before it costs anything downstream. Returns a 413
 * response when `bytes` is over the cap, or null to proceed.
 *
 * Called twice per upload: on the declared Content-Length (before the body is
 * read) and on the parsed `file.size` (authoritative, since Content-Length can
 * be absent or spoofed).
 *
 * `context` rather than a required organization id: the token surface knows the
 * organization before it reads anything, while the portal surface only learns it
 * from the parsed form — so the first check there has nothing truthful to log.
 */
export function tooLargeResponse(
  bytes: number,
  log: WarnLogger,
  context: Record<string, unknown> = {},
): ReturnType<typeof fail> | null {
  if (bytes <= env.APP_MAX_STUDY_ZIP_BYTES) return null;
  log.warn(
    { ...context, bytes, max: env.APP_MAX_STUDY_ZIP_BYTES },
    'study upload rejected: over size limit',
  );
  return fail(ApiErrorCode.PAYLOAD_TOO_LARGE, HttpStatus.PAYLOAD_TOO_LARGE, {
    message: 'Uploaded study exceeds the maximum allowed size.',
  });
}

/** The study file from an already-parsed form, or a 400 when it is missing. */
export function readStudyFile(
  formData: FormData,
): { file: File } | { error: ReturnType<typeof fail> } {
  const file = formData.get(STUDY_FILE_FIELD) as File | null;
  if (!file) return { error: fail(ApiErrorCode.BAD_REQUEST, HttpStatus.BAD_REQUEST) };
  return { file };
}

// Reads the optional completion webhook from the form. Returns the validated URL
// (or undefined when absent), or { valid: false } when present but malformed/unsafe.
export function readWebhookUrl(
  formData: FormData,
): { valid: true; url?: string } | { valid: false } {
  const raw = formData.get('webhook');
  const url = typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
  if (url && !isValidWebhookUrl(url)) return { valid: false };
  return { valid: true, url };
}

/**
 * Read a multipart body, turning a TRUNCATED one into an honest error.
 *
 * `proxy.ts` matches `/api/:path*`, and Next buffers the body in memory when a
 * proxy runs so both it and the handler can read it — capped by
 * `experimental.proxyClientMaxBodySize`. Past that cap Next does not fail the
 * request: it hands the handler the first N bytes, which for a multipart upload is
 * a body with no closing boundary. `formData()` then throws a TypeError, the route
 * wrapper logs an unhandled 500, and the person uploading is told nothing useful.
 *
 * That cap is set from `APP_MAX_STUDY_ZIP_BYTES` (see next.config.mjs), so a body
 * that arrives truncated is by definition over our own limit — 413, with the reason.
 */
export async function readFormData(
  req: Request,
): Promise<{ formData: FormData } | { error: ReturnType<typeof fail> }> {
  try {
    return { formData: await req.formData() };
  } catch (err) {
    const truncated = err instanceof TypeError;
    return {
      error: fail(
        truncated ? ApiErrorCode.PAYLOAD_TOO_LARGE : ApiErrorCode.BAD_REQUEST,
        truncated ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST,
        truncated
          ? {
              message:
                'Upload exceeds the maximum size this server accepts, or was interrupted before it finished.',
            }
          : undefined,
      ),
    };
  }
}

/**
 * Full read for callers that know the organization up front: both size guards
 * plus the parsed form. Keeps the token route's control flow flat.
 *
 * The portal route composes `tooLargeResponse` / `readStudyFile` itself instead,
 * because it has to authorize the organization in between the two guards.
 */
export async function readStudyUpload(
  req: Request,
  organizationId: string,
  log: WarnLogger,
): Promise<{ file: File; formData: FormData } | { error: ReturnType<typeof fail> }> {
  const declaredTooLarge = tooLargeResponse(Number(req.headers.get('content-length') ?? 0), log, {
    organizationId,
  });
  if (declaredTooLarge) return { error: declaredTooLarge };

  const parsed = await readFormData(req);
  if ('error' in parsed) return parsed;
  const study = readStudyFile(parsed.formData);
  if ('error' in study) return study;

  const fileTooLarge = tooLargeResponse(study.file.size, log, { organizationId });
  if (fileTooLarge) return { error: fileTooLarge };

  return { file: study.file, formData: parsed.formData };
}
