// Chat attachment vocabulary shared by the upload route, the chat service and the
// clients. Pure helpers only — no Node, no Mongo, no blob SDK — so the browser
// bundle and the unit tests can import them freely. The side-effecting half
// (DICOM conversion, PDF text extraction, blob IO) lives in
// `app/lib/services/chat-attachments.ts`.

// What we do with a file the doctor attaches mid-conversation:
// - `image` goes to the provider as an image, verbatim;
// - `dicom` is rendered to a JPEG first, then goes as an image;
// - `pdf` is read for its text, which is quoted into the prompt (we deliberately
//   do NOT rasterize pages — that would need Poppler in the runtime image);
// - `unsupported` is refused at the door.
export type ChatAttachmentKind = 'image' | 'dicom' | 'pdf' | 'unsupported';

// One attachment as it is stored on the message and echoed back to the client.
// `url` is the blob PATH inside the organization's container, never a public URL
// and never the bytes — same rule the analysis pipeline follows for its JPEGs.
export type ChatAttachment = {
  name: string;
  type: string;
  size: number;
  url: string;
  // Text pulled out of the file (PDF), quoted into the prompt on the turn it was
  // sent and on every later turn that still shows it in the raw window.
  content?: string;
  // Per-file processing failure, kept so the transcript explains itself instead
  // of silently dropping an attachment the doctor believes the model saw.
  error?: string;
  // A caveat about a file that DID reach the model — today, that only the first
  // frame of a multi-frame instance was sent. Distinct from `error` on purpose:
  // one says "the model never saw this", the other "the model saw less than you
  // think". Both belong in the prompt and on screen; only `error` disqualifies the
  // file from being sent as an image.
  note?: string;
};

// Kinds that reach the provider as image input.
export const IMAGE_ATTACHMENT_KINDS: ReadonlySet<ChatAttachmentKind> = new Set<ChatAttachmentKind>([
  'image',
  'dicom',
]);

const IMAGE_MIME_PREFIX = 'image/';
// Formats every provider we support accepts as image input. A TIFF or a BMP is a
// legitimate image the model would reject, so it is refused here with a clear
// message rather than at the provider with an opaque 400.
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function classifyChatAttachment(fileName: string, mimeType: string): ChatAttachmentKind {
  const name = fileName.toLowerCase();
  const type = mimeType.toLowerCase();
  // Extension first for DICOM: browsers routinely send `.dcm` as
  // application/octet-stream, so the mime type alone would misclassify it.
  if (type.includes('dicom') || name.endsWith('.dcm') || name.endsWith('.dicom')) return 'dicom';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith(IMAGE_MIME_PREFIX)) {
    return ACCEPTED_IMAGE_TYPES.includes(type) ? 'image' : 'unsupported';
  }
  return 'unsupported';
}

// Blob layout for a chat attachment, inside the organization's own container
// (`new AzuriteBlobAdapter(organizationId)`) exactly like the pipeline's JPEGs.
// Keying the folder on the jobId is what lets the read routes authorize a path
// by string comparison instead of a second database round trip.
export function chatAttachmentFolder(jobId: string): string {
  return `chat/${jobId}`;
}

/** Prefix every conversation's folder shares, so a whole container can be listed. */
export const CHAT_FOLDER_PREFIX = 'chat/';

/**
 * Which conversation a stored blob belongs to, read back from its path.
 *
 * The housekeeping sweep works from what storage holds rather than from what the
 * database remembers — it has to, since a conversation removed by the TTL index
 * leaves its folder behind — so the path is the only thing left that says which job
 * a file was for. Anything not shaped like `chat/<jobId>/<file>` returns null and is
 * left alone: an unrecognized blob is not ours to delete.
 */
export function jobIdFromChatBlobPath(path: string): string | null {
  if (!path.startsWith(CHAT_FOLDER_PREFIX)) return null;
  const [jobId, ...rest] = path.slice(CHAT_FOLDER_PREFIX.length).split('/');
  return jobId && rest.length > 0 ? jobId : null;
}

export function chatAttachmentBlobPath(jobId: string, id: string, fileName: string): string {
  return `${chatAttachmentFolder(jobId)}/${id}-${fileName}`;
}

// Sidecar holding the authoritative description of an attachment (display name,
// type, extracted text, processing error). The client only ever hands us blob
// PATHS; everything else about a file is read back from here, so a tampered
// payload cannot rename a file, fake its size, or inject text as if we had
// extracted it from a document.
export function chatAttachmentMetaPath(blobPath: string): string {
  return `${blobPath}.meta.json`;
}

// True when `path` is a blob this job's conversation may read. The caller has
// already proven the organization owns the job, so containment in the job's
// folder is the whole check — plus the traversal guard, because the path arrives
// from the client. Sidecars are excluded: they are an internal detail, resolved
// server-side from the file path, never addressable directly.
export function isChatAttachmentPath(path: string, jobId: string): boolean {
  if (!path || !jobId) return false;
  if (path.includes('..') || path.startsWith('/')) return false;
  if (path.endsWith('.meta.json')) return false;
  return path.startsWith(`${chatAttachmentFolder(jobId)}/`);
}

// Content type for a stored attachment, derived from its name. We control those
// names (sanitized on upload, and a converted DICOM is renamed to `.jpg`), so the
// extension is reliable — and an unknown one falls back to a type no browser will
// execute. Anything not an image is served as a download rather than inline,
// which keeps a PDF from ever being rendered in our own origin.
const ATTACHMENT_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
};

export function chatAttachmentContentType(path: string): string {
  const extension = path.toLowerCase().split('.').pop() ?? '';
  return ATTACHMENT_CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

export function isInlineAttachmentType(contentType: string): boolean {
  return contentType.startsWith(IMAGE_MIME_PREFIX);
}

// How the attachments on a turn are described to the model. Images ride along as
// real image input, so they only need naming; a PDF has no visual channel here,
// so its extracted text is quoted in full. Rendered on every turn that is still
// in the raw window, which is why it lives in this pure module.
export function renderAttachmentsForPrompt(files: ChatAttachment[] | undefined): string {
  if (!files?.length) return '';
  /* cspell:disable */
  const lines = files.map((file) => {
    if (file.error) return `- ${file.name}: não foi possível processar (${file.error})`;
    const caveat = file.note ? ` — ${file.note}` : '';
    if (file.content) return `- ${file.name} (texto extraído)${caveat}:\n${file.content}`;
    return `- ${file.name}: enviado como imagem${caveat}`;
  });
  return `\n\nArquivos anexados a esta mensagem:\n${lines.join('\n')}`;
  /* cspell:enable */
}
