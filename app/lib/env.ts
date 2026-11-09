import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  APP_LOG_FORMAT: z.enum(['pretty', 'json']).optional(),
  APP_SERVICE_NAME: z.string().min(1).default('custeio'),
  // Public base URL of the app, used to build absolute callback URLs.
  APP_BASE_URL_FRONT: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  APP_TOKEN_PEPPER: z.string().optional(),
  // Encrypts secrets stored at rest that the app must later decrypt to use
  // (e.g. a Store's Alloy `apiKey` — unlike a password, it can't be a one-way
  // hash, since the worker needs the real value to call the provider). A
  // 32-byte key, base64-encoded: generate with `openssl rand -base64 32`.
  // See app/lib/secret-encryption.ts. Rotating it makes every previously
  // encrypted secret undecryptable.
  APP_SECRETS_ENCRYPTION_KEY: z.string().optional(),
  // NextAuth reads this straight from process.env for the session cookie; it is
  // declared here because the Inspect User token is signed with the same secret,
  // so rotating it invalidates outstanding inspection tokens along with sessions.
  AUTH_SECRET: z.string().optional(),
  // The bootstrap platform account (see app/lib/protected-account.ts). Declared
  // here because the app now reads it at runtime to keep that account out of the
  // user listings, not just the seed scripts.
  // Emails of the platform bootstrap accounts. Read by app/lib/protected-account.ts
  // to keep them out of the Users screen; unset simply means no protected account.
  APP_USER_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  // Alloy developer credentials — see docs/features/alloy-api.md. One value for the
  // whole Custeio install (not per-store): unlike the per-loja
  // `apiKey`/`externalId` on `Stores`, this identifies Custeio itself
  // as an integrator with the Alloy platform. ALLOY_API_HOST is the `{{host}}`
  // from the Postman collections, only known once the developer panel is reached.
  ALLOY_INTEGRATOR_TOKEN: z.string().min(1).optional(),
  ALLOY_API_HOST: z.string().min(1).optional(),
  // Connection string of the webhook bridge's MongoDB (custeio-webhook-bridge, on Vercel + Atlas):
  // the always-on receiver that keeps Alloy's deliveries while this machine is off. Unset → the
  // `bridge.pull` cron stays off. See docs/features/webhook-bridge.md.
  BRIDGE_MONGODB_URI: z.string().min(1).optional(),
  BRIDGE_MONGODB_DB: z.string().min(1).default('bridge'),
  // Where "Buscar na SEFAZ" gets its documents. `simulated` replays the XML files
  // in SEFAZ_SIMULATED_DIR (named `<NSU>-<schema>.xml`, as scripts/dev/sefaz-dist-nsu.ts
  // saves them) so the capture flow can be exercised without spending the real
  // 20/h quota. `live` (the real NFeDistribuicaoDFe call) is not wired to a
  // certificate yet — custody is undecided, see docs/features/sefaz-nfe.md.
  SEFAZ_SOURCE: z.enum(['simulated', 'live']).default('simulated'),
  SEFAZ_SIMULATED_DIR: z.string().min(1).optional(),
  // Minimum gap between two "Buscar na SEFAZ" per Store. 60 is the safe value
  // while the "wait ~1h after cStat 137" rule is unconfirmed; lower it in dev.
  SEFAZ_SYNC_COOLDOWN_MINUTES: z.coerce.number().min(0).default(60),
  // How often the worker looks for stores whose SEFAZ sync stopped with documents
  // still waiting and resumes the ones whose quota has reopened. 0 turns it off.
  SEFAZ_RESUME_INTERVAL_MINUTES: z.coerce.number().min(0).default(5),
  // Failed Bull jobs older than this are removed by the `queue.cleanup` cron, which
  // runs this often by default. Both are only seeds: System > Crons overrides the run interval.
  APP_BULL_FAILED_JOB_TTL_DAYS: z.coerce.number().min(1).default(7),
  APP_BULL_CLEANUP_INTERVAL_HOURS: z.coerce.number().min(1).default(6),
  // Minimum gap between two "Sincronizar cardápio" per Store. A sync is one
  // `getproducts` request of the store's 2/minute Alloy quota, so this only has
  // to stop the button being mashed, not protect a scarce resource.
  ALLOY_CATALOG_SYNC_COOLDOWN_MINUTES: z.coerce.number().min(0).default(10),
  // The platform's AI provider key, shared by every organization. Stored in the env
  // (never per-org, never in the DB), so no decryption. All optional: unset simply resolves to no AI config, which the
  // callers report as "no provider configured".
  PLATFORM_AI_PROVIDER: z.enum(['gemini', 'claude', 'openai']).optional(),
  PLATFORM_AI_MODEL: z.string().min(1).optional(),
  PLATFORM_AI_API_KEY: z.string().min(1).optional(),
  // Optional platform fallback provider (used when the primary platform call fails).
  PLATFORM_AI_FALLBACK_PROVIDER: z.enum(['gemini', 'claude', 'openai']).optional(),
  PLATFORM_AI_FALLBACK_MODEL: z.string().min(1).optional(),
  PLATFORM_AI_FALLBACK_API_KEY: z.string().min(1).optional(),
  // Billing knobs. Margin = markup over raw provider cost (1.30 = +30%).
  // USD→BRL rate to present the bill in BRL (fixed for the demo; a real
  // deployment would pull a live rate). Both optional — code defaults apply.
  PLATFORM_AI_MARGIN: z.coerce.number().positive().optional(),
  PLATFORM_AI_USD_BRL: z.coerce.number().positive().optional(),
  // Claude API key (Anthropic Console). Server-side only, optional: nothing calls the model without it.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  APP_AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  // Shared blob container for every asset the app proxies through
  // /api/assets/[...blobPath] — user profile avatars today (see
  // app/api/users/profile/route.ts); branding used to be the other consumer
  // before its admin page was removed.
  APP_SYSTEM_ASSETS_CONTAINER: z.string().default('custeio-assets'),
  APP_BULL_KEEP_FAILED_JOBS: z.coerce.number().int().positive().default(1000),
  // How many jobs one worker processes at once. This is the outermost multiplier of
  // the worker's peak memory (see the mem_limit note in docker-compose.prod.yml):
  // each concurrent job independently holds a batch of image base64. Raise only in
  // step with the memory ceiling. Was read straight off process.env before — kept
  // here so it is validated and visible with the rest of the knobs.
  APP_BULL_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  // How often the worker samples Bull's job counts into the log. This is the only
  // queue-depth signal we have (there is no metrics backend yet), so it doubles as
  // the time series an operator greps to see a backlog forming. 0 disables it.
  APP_WORKER_QUEUE_STATS_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),
  // Attempts per job, and the base delay of the exponential backoff between them
  // (delay, 2×, 4×, …). These must span a real provider outage: at 3 attempts /
  // 5s the retries were exhausted ~15s in, so a one-minute outage failed the job
  // permanently while the provider was already back. 6 / 15s spans ~8min.
  // Not set higher because Bull v4 has no "unrecoverable error": a genuinely
  // broken payload also burns every attempt.
  APP_BULL_JOB_ATTEMPTS: z.coerce.number().int().positive().default(6),
  APP_BULL_BACKOFF_DELAY_MS: z.coerce.number().int().positive().default(15_000),
  // How many times the Azure blob download stream auto-resumes after a dropped
  // socket before giving up.
  APP_BLOB_DOWNLOAD_MAX_RETRIES: z.coerce.number().int().min(0).default(5),
  // Hard ceiling on an uploaded file (NF-e XML/PDF batches). It is also the body
  // size Next buffers in memory per upload: next.config.mjs reads this same
  // variable for `proxyClientMaxBodySize`, because a body our limit accepts and
  // Next truncates arrives as a corrupt multipart. Raising it raises the web
  // container's peak memory per upload in flight, so it is not a free number.
  APP_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1_048_576),

  APP_RATE_LIMIT_HEALTH_PER_MIN: z.coerce.number().int().positive().default(600),
  APP_RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(120),
  APP_RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().positive().default(10),
  // Invite claim is a public, unauthenticated write that creates an account, so it
  // is held to the same tight per-IP budget as sign-in.
  APP_RATE_LIMIT_CLAIM_PER_MIN: z.coerce.number().int().positive().default(10),
  APP_HEALTHCHECK_PING_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  APP_RATE_LIMIT_DEFAULT_PER_MIN: z.coerce.number().int().positive().default(120),
});

// A declared-but-empty variable (`FOO=` — how a .env documents an optional
// setting that is currently off) arrives as ''. Treat it as absent: otherwise
// every optional field with an enum or min-length check rejects it and the whole
// app refuses to boot over a setting nobody turned on. Empty means "not set",
// which is what the file is saying.
const declaredEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== ''),
);

const parsed = envSchema.safeParse(declaredEnv);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.issues[0]?.message}`);
}

export const env = parsed.data;
