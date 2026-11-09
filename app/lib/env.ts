import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  APP_LOG_FORMAT: z.enum(['pretty', 'json']).optional(),
  APP_SERVICE_NAME: z.string().min(1).default('rayai'),
  // Public base URL of the app, used to build absolute callback URLs (e.g. the
  // Chat Tester completion webhook). Optional — undefined falls back to polling.
  APP_BASE_URL_FRONT: z.string().optional(),
  // Space-separated customer origins allowed to embed the `/chat-widget` iframe,
  // appended to `'self'` in its frame-ancestors CSP (see next.config.mjs, which
  // reads process.env directly). Empty → only same-origin embedding (our test
  // viewer). Example: "https://clinicA.com https://clinicB.com".
  APP_WIDGET_FRAME_ANCESTORS: z.string().optional(),
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
  // whole KairosFlow install (not per-store): unlike the per-loja
  // `apiKey`/`externalId` on `Stores`, this identifies KairosFlow itself
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
  // The RayPilot provider key that runs EVERY organization's analyses and chat
  // turns. Stored plaintext in the env (never per-org, never in the DB), so no
  // decryption. All optional: unset simply resolves to no AI config, which the
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
  APP_SYSTEM_ASSETS_CONTAINER: z.string().default('radiologistaicompanionblob'),
  APP_BULL_KEEP_FAILED_JOBS: z.coerce.number().int().positive().default(1000),
  // How many jobs one worker processes at once. This is the outermost multiplier of
  // the worker's peak memory (see the mem_limit note in docker-compose.prod.yml):
  // each concurrent job independently holds a batch of image base64. Raise only in
  // step with the memory ceiling. Was read straight off process.env before — kept
  // here so it is validated and visible with the rest of the knobs.
  APP_BULL_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  // Soft budget (MiB) the worker's projected peak RSS is checked against at boot.
  // Purely a guard: if WORKER_CONCURRENCY × LEAF_CONCURRENCY × BATCH_SIZE × an
  // assumed per-image cost exceeds this, the worker logs a loud warning so a
  // misconfiguration surfaces before a container OOM. Match it to mem_limit.
  APP_WORKER_MEM_BUDGET_MB: z.coerce.number().int().positive().default(768),
  // How often the worker samples Bull's job counts into the log. This is the only
  // queue-depth signal we have (there is no metrics backend yet), so it doubles as
  // the time series an operator greps to see a backlog forming. 0 disables it.
  APP_WORKER_QUEUE_STATS_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),
  // Hard cap on DICOM instances analyzed per study. Bounds worst-case memory, AI
  // token spend and wall-clock against a pathological (or hostile) study with tens
  // of thousands of slices. Exceeding it fails the job with a clear error rather
  // than silently melting the worker. Generous — a large CT is ~1–2k slices.
  APP_MAX_STUDY_INSTANCES: z.coerce.number().int().positive().default(5000),
  // Attempts per job, and the base delay of the exponential backoff between them
  // (delay, 2×, 4×, …). These must span a real provider outage: at 3 attempts /
  // 5s the retries were exhausted ~15s in, so a one-minute AI outage failed the
  // study permanently while the provider was already back. 6 / 15s spans ~8min.
  // Not set higher because Bull v4 has no "unrecoverable error": a genuinely
  // broken study (corrupt zip) also burns every attempt, re-streaming each time.
  APP_BULL_JOB_ATTEMPTS: z.coerce.number().int().positive().default(6),
  APP_BULL_BACKOFF_DELAY_MS: z.coerce.number().int().positive().default(15_000),
  APP_ADD_ORDER_IDEMPOTENCY_TTL_SEC: z.coerce.number().int().positive().default(300),
  // Outbound completion-webhook signing secret. When set, each webhook carries an
  // HMAC-SHA256 signature header so receivers can verify it genuinely came from us.
  APP_WEBHOOK_SIGNING_SECRET: z.string().min(16).optional(),
  // How many times to retry delivering a completion webhook on transient failure
  // (timeout / network / 5xx / 429). 0 disables retries (single attempt).
  APP_WEBHOOK_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  // DICOM analysis pipeline (worker): DCMTK binaries + conversion tuning.
  // How many times the Azure blob download stream auto-resumes after a dropped
  // socket before giving up (keeps long study-zip streams resilient).
  APP_BLOB_DOWNLOAD_MAX_RETRIES: z.coerce.number().int().min(0).default(5),
  // Bounded concurrency for re-reading a batch's JPEGs back from blob storage
  // before sending them to the AI (caps simultaneous blob downloads).
  APP_BLOB_READ_CONCURRENCY: z.coerce.number().int().positive().default(8),
  // Images per AI request (map-reduce batch size). Smaller = better per-image
  // attention and less context pressure, at the cost of more calls. The legacy
  // value was 80 (Gemini-tuned); 20 is a safer default across providers.
  APP_AI_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  // How many image batches are analyzed concurrently. Batches are independent, so
  // this is pure wall-clock: a 100-batch study is otherwise ~100 sequential
  // provider round-trips. The ceiling is the provider's rate limit, not our CPU —
  // too high and every batch lands in the 429 retry path and ends up slower than
  // serial. 4 is conservative; raise it per-org only with rate-limit headroom.
  APP_AI_LEAF_CONCURRENCY: z.coerce.number().int().positive().default(4),
  // Fan-out of the tree-reduce synthesis: how many partial reports each synthesis
  // call merges per level. Smaller = more levels but each call stays well within
  // attention/output limits (avoids "lost in the middle" on many partials).
  APP_AI_SYNTHESIS_FANOUT: z.coerce.number().int().min(2).default(5),
  APP_DICOM_JPEG_QUALITY: z.coerce.number().int().min(1).max(100).default(90),
  // Cap (in px) the longest side of each rendered JPEG before it goes to the AI.
  // Image token cost scales with pixel area, so this is the main cost lever for a
  // large study. Only ever downscales (never upscales); 0 disables and keeps
  // the DICOM's native resolution.
  APP_DICOM_JPEG_MAX_DIM: z.coerce.number().int().min(0).default(1024),
  APP_DCM2IMG_BIN: z.string().min(1).default('dcm2img'),
  APP_DCMDUMP_BIN: z.string().min(1).default('dcmdump'),
  APP_MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1_048_576),
  // Hard ceiling on an uploaded study zip, rejected at ingestion (by Content-Length,
  // before the body is even read). Deliberately generous — real studies range from a
  // few MB to a couple of GB — so this only stops an absurd/hostile upload, not a
  // legitimate large study. (APP_MAX_FILE_SIZE_BYTES above is a different, much
  // smaller cap and does not apply to study zips.)
  // Also the size of the body Next buffers in memory for an upload — next.config.mjs
  // reads this same variable for `proxyClientMaxBodySize`, because a study that our
  // limit accepts and Next truncates arrives as a corrupt multipart. Raising it
  // raises the web container's peak memory per upload in flight, so it is not a free
  // number; 256 MB covers a compressed study comfortably.
  APP_MAX_STUDY_ZIP_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(256 * 1_048_576),
  // Per-file ceiling for something attached inside a conversation (a loose image,
  // a single DICOM instance, a previous report as PDF). Generous enough for an
  // uncompressed CT slice, far below the study-zip cap: this file is converted
  // synchronously in the web process, not streamed by the worker.
  APP_CHAT_ATTACHMENT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1_048_576),
  // How many attachments one turn may carry. Each image is billed by area, so
  // this is a cost lever as much as a UX one.
  APP_CHAT_ATTACHMENTS_PER_MESSAGE: z.coerce.number().int().positive().default(4),
  // Hard ceilings that together keep a conversation inside MongoDB's 16 MB document
  // limit. A conversation is ONE document holding every turn, and the failure past
  // that limit is not graceful degradation — every write to it starts failing, so
  // the chat for that study breaks permanently and cannot even record why.
  //
  // Worst case with the defaults below:
  //   200 turns x (8 k of text + 4 attachments x 8 k of extracted text) ~= 8 MB.
  // Change one and re-do that arithmetic; the four caps are load-bearing together,
  // not individually.
  APP_CHAT_MESSAGE_MAX_CHARS: z.coerce.number().int().positive().default(8_000),
  APP_CHAT_MAX_TURNS: z.coerce.number().int().positive().default(200),
  // Cap on the text lifted out of an attached PDF. Two reasons, both real: a
  // 200-page scan-to-text would dominate the prompt for every later turn in the raw
  // window, and it is stored on the message, so it counts against the document
  // ceiling above.
  APP_CHAT_PDF_TEXT_MAX_CHARS: z.coerce.number().int().positive().default(8_000),
  // How long a streaming answer may go without a single chunk before we give up on
  // it. The AI transport's own timeout guards reaching the FIRST byte and nothing
  // after it (see ai/http.ts), deliberately — a long answer legitimately outlasts
  // any request timeout. That leaves a provider which simply stops mid-answer: the
  // SSE stays open, our server holds the connection, and the doctor watches a cursor
  // blink forever. This bounds that gap. Whatever text had arrived is kept and
  // metered, exactly as when the doctor presses stop. 0 disables the watchdog.
  APP_CHAT_STREAM_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(60_000),
  // Retention, in days, per collection — 0 keeps forever, which is the default for
  // anything clinical. These drive the TTL indexes through `services/retention.ts`;
  // the schemas no longer carry `expireAfterSeconds` of their own, so this file is
  // the only place a medical record's lifetime is decided. Shortening one deletes
  // data on the next Mongo TTL pass, with no undo: see docs/operations/retention.md.
  APP_RETENTION_CONVERSATION_DAYS: z.coerce.number().int().min(0).default(0),
  APP_RETENTION_DICOM_RESULTS_DAYS: z.coerce.number().int().min(0).default(0),
  // Resume checkpoints for a running analysis — worthless once it finished, so this
  // one keeps a short default.
  APP_RETENTION_ANALYSIS_PARTIALS_DAYS: z.coerce.number().int().min(0).default(30),

  // What counts as "the pipeline is broken", for `/api/health/pipeline` and for the
  // worker's own alerting loop. Generous by design: an alert that cries wolf during
  // a normal burst of uploads gets muted, and a muted alert is worth nothing.
  //
  // The worker beats every APP_WORKER_HEARTBEAT_INTERVAL_MS (15s), so three missed
  // beats is a worker that is genuinely gone rather than one mid-garbage-collection.
  APP_HEALTH_WORKER_SILENT_MS: z.coerce.number().int().positive().default(60_000),
  // A backlog only matters when nothing is being worked on — see pipeline-health.ts.
  APP_HEALTH_QUEUE_BACKLOG_MAX: z.coerce.number().int().min(0).default(20),
  APP_HEALTH_QUEUE_FAILED_MAX: z.coerce.number().int().min(0).default(10),
  // Where to shout when the pipeline stops. Any URL that accepts a JSON POST —
  // Slack/Discord/Teams incoming webhook, or something homegrown. Unset = the check
  // still answers over HTTP, but nothing pushes to anyone.
  APP_ALERT_WEBHOOK_URL: z.string().url().optional(),
  // How long to stay quiet after shouting, so one dead worker is one message rather
  // than one every sampling interval.
  APP_ALERT_REPEAT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 60_000),
  // How often the web process asks whether the pipeline is moving. 0 disables the
  // watchdog and leaves `/api/health/pipeline` as the only way to find out.
  APP_PIPELINE_WATCHDOG_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
  APP_MAX_BULK_SIZE: z.coerce.number().int().positive().default(500),
  APP_MAX_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  APP_RATE_LIMIT_HEALTH_PER_MIN: z.coerce.number().int().positive().default(600),
  APP_RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(120),
  APP_RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().positive().default(10),
  // Invite claim is a public, unauthenticated write that creates an account, so it
  // is held to the same tight per-IP budget as sign-in.
  APP_RATE_LIMIT_CLAIM_PER_MIN: z.coerce.number().int().positive().default(10),
  APP_HEALTHCHECK_PING_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  APP_RATE_LIMIT_DEFAULT_PER_MIN: z.coerce.number().int().positive().default(120),
  // Chat turns and attachment uploads one ORGANIZATION may start per minute.
  //
  // The per-IP limit on these routes bounds one browser; it does nothing about a
  // leaked widget token driven from many addresses, which is the shape abuse
  // actually takes. The monthly token ceiling bounds the money that ends up spent,
  // but only after the fact — this bounds the rate. Generous for real use: a clinic
  // with several doctors mid-consultation is nowhere near a message a second.
  APP_RATE_LIMIT_CHAT_PER_ORG_PER_MIN: z.coerce.number().int().positive().default(60),
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
