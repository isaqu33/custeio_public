import type { ChatAttachment } from '@/app/lib/chat-attachments';
import type { Result } from './result';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';

export type JobListItem = {
  _id: string;
  examId: string;
  organizationId: string;
  kind?: string;
  type: string;
  status: JobStatus;
  createdAt: string | Date;
  result?: {
    csvBase64?: string;
    fileName?: string;
    mimeType?: string;
    container?: string;
    blobPath?: string;
    [key: string]: unknown;
  };
  params?: unknown;
  logs?: unknown[];
  errors?: unknown[];
  errorLogs?: unknown[];
  // Whether the submitted DICOM zip is still in storage, and the name to offer it
  // under. The blob path itself stays server-side.
  hasStudy?: boolean;
  studyFileName?: string;
};

export type JobsListSuccess = Result<{
  data: JobListItem[];
  total: number;
  page: number;
  totalPages: number;
}>;

// --- Job detail (single job + its conversation) ---

// One pipeline phase's clock. Stored as the two timestamps rather than a
// duration so a resumed job can reopen a phase, and every reader derives the
// span the same way (see `app/lib/jobs/estimate.ts`).
export type JobPhaseSpan = {
  startedAt?: string | Date;
  endedAt?: string | Date;
};

// When the run started and stopped, plus where its time went. `startedAt` is
// when the WORKER picked the job, not when it was queued — the two differ by the
// queue wait, which is not the pipeline's time.
export type JobTimings = {
  startedAt?: string | Date;
  finishedAt?: string | Date;
  converting?: JobPhaseSpan;
  analyzing?: JobPhaseSpan;
  synthesizing?: JobPhaseSpan;
};

// Live counters of a SEFAZ-sync run (`sefaz.nfe.received`) — see app/models/jobs.ts.
export type NfeSyncProgress = {
  phase?: 'fetching' | 'processing' | 'done' | 'blocked' | 'paused';
  source?: 'simulated' | 'live';
  docsTotal?: number;
  docsDone?: number;
  invoicesProcessed?: number;
  invoicesDuplicate?: number;
  invoicesFailed?: number;
  // NFes SEFAZ reported cancelled, and the stock value given back for them (R$).
  invoicesCancelled?: number;
  cancelledValue?: number;
  docsIgnored?: number;
  // resNFe previews kept for the Notas screen (no items, so nothing is applied to stock).
  summariesRecorded?: number;
  itemsMatched?: number;
  itemsDrafted?: number;
  batchesDone?: number;
  batchesMax?: number;
  ultNsu?: string;
  maxNsu?: string;
  // Set when documents are still waiting: when the resume cron may continue.
  resumeAt?: string;
  // Why: documents still waiting (continues as soon as the gate allows) or the
  // store's next scheduled check (polling on, nothing waiting).
  resumeKind?: 'backlog' | 'poll';
};

export type JobProgress = {
  nfe?: NfeSyncProgress;
  phase?: string;
  conversionComplete?: boolean;
  instanceCount?: number;
  // Files converted so far in the RUNNING conversion. The study is streamed, so
  // the total is unknown until the last entry is read — this is a live counter,
  // not a fraction, and it is what a study that spends 12 minutes converting has
  // to show for itself.
  convertedFiles?: number;
  timings?: JobTimings;
  failedFiles?: number;
  batchesTotal?: number;
  batchesDone?: number;
  analysisFailedBatches?: number;
  // Which provider/model answered how many image batches, and whether that was
  // the fallback rather than the organization's primary configuration. `usage` is
  // that model's own token count, so a job split across two providers can be
  // costed per provider; the rows sum to `usage` below.
  aiAttribution?: Array<{
    provider?: string;
    model?: string;
    batches?: number;
    fallback?: boolean;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  }>;
  aiSynthesis?: { provider?: string; model?: string; fallback?: boolean };
  multiFrameInstances?: number;
  /** Every DICOM instance the walk reached: converted + failed + out of scope. */
  filesSeen?: number;
  /** EXAM SCOPE — images read and not analyzed, and what the study held. */
  skippedByModality?: number;
  modalityBreakdown?: Array<{ modality?: string; accepted?: number; skipped?: number }>;
  /** False marks a completed study that must not be invoiced. */
  billable?: boolean;
  notBillableReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

export type JobWebhookOutcome = {
  delivered?: boolean;
  attempts?: number;
  lastStatus?: string;
  deliveredAt?: string | Date;
};

export type JobStepLog = {
  jobStatus?: string;
  examStatus?: string;
  message?: string;
  step?: string;
  timestamp?: string | Date;
};

// `code` is a stable slug for WHY it failed (an AiFailureCode today), stored
// alongside the untranslatable provider text so the UI can label the failure in
// the reader's language instead of showing raw English prose only.
export type JobErrorLog = {
  message?: string;
  code?: string;
  attempt?: number;
  timestamp?: string | Date;
};

// One conversation turn — `role` is who sent it (user = human, assistant = AI),
// `status: 'failed'` marks a message that wasn't delivered/answered (with `error`).
export type JobMessage = {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'ok' | 'failed';
  error?: string;
  // Files attached to this turn. `url` is a blob path, read back through the
  // per-surface attachment route — never a direct storage URL.
  files?: ChatAttachment[];
  timestamp: string | Date;
};

// One image the conversion could not read, with the reason DCMTK gave. Sampled
// (not the full list) — a study where 400 files failed needs the cause and a
// count, not 400 rows.
export type JobFailedImage = {
  fileName: string;
  error?: string;
  batchIndex?: number;
};

// Measurements taken from the job's own durable records: per-file conversion
// time (DicomResults), per-batch AI time (AnalysisPartials), and the runtime
// knobs that shaped them. Analysis jobs only.
// PLATFORM BILLING — what one model in this job cost. A study can be answered by
// more than one model (a fallback covers batches the primary rejected, or writes
// the report), and "what did this exam cost" then has to be answered per model,
// not as one number. Priced by the rate card in force at read time: an analysis
// job is not an invoice, so unlike a closed billing period it re-prices whenever
// the table changes.
export type JobCostRow = {
  provider: string;
  model: string;
  /** Image batches this model answered. Zero when it only wrote the report. */
  batches: number;
  fallback: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** What the provider charges us for these tokens. */
  providerUsd: number;
  /** After margin and FX — what the organization is billed for them. */
  billedBrl: number;
  /** List price applied, USD per 1M tokens. */
  priceInputUsd: number;
  priceOutputUsd: number;
  /**
   * True when this exact model has no row in the rate card and was billed at the
   * provider's default rate. The amount is then an approximation, and the UI has
   * to say so rather than present it as a quote.
   */
  priceIsFallback: boolean;
};

export type JobCost = {
  rows: JobCostRow[];
  providerUsd: number;
  billedBrl: number;
  margin: number;
  usdToBrl: number;
  /**
   * Tokens the rows account for, against the job's own total. They should match;
   * when they do not, some usage was never attributed to a model (an older job
   * written before per-model counters existed) and the cost shown is a floor, not
   * the whole bill. Surfaced rather than hidden — a number that silently omits
   * part of itself is worse than one that admits the gap.
   */
  attributedTokens: number;
  totalTokens: number;
};

export type JobMetrics = {
  /** Average DICOM → JPEG time per file, in ms. */
  msPerImage?: number;
  /** Average AI call time for one image batch, in ms. */
  msPerBatch?: number;
  /** Wall-clock of the whole synthesis tree-reduce, in ms. */
  synthesisMs?: number;
  failedImages: JobFailedImage[];
  failedImagesTotal: number;
  pipeline: {
    batchSize: number;
    leafConcurrency: number;
    synthesisFanout: number;
    /** `APP_MAX_STUDY_INSTANCES` — the size a study is refused above. */
    maxInstances: number;
  };
  /** Undefined until at least one model has answered and been attributed. */
  cost?: JobCost;
};

export type JobDetail = {
  _id: string;
  examId: string;
  // Ties this job to the HTTP request that created it: the ingestion route puts
  // its requestId here and the worker logs every line under the same value, so
  // support can go from a job on screen to the pipeline logs.
  correlationId?: string;
  organizationId: string;
  kind?: string;
  type: string;
  status: JobStatus;
  createdAt: string | Date;
  updatedAt?: string | Date;
  progress?: JobProgress;
  /**
   * Which door an analysis came through: `'portal'` is a person uploading from
   * the New Analysis page, `'integration'` a token-authenticated client script.
   * Undefined for every other job kind.
   */
  source?: 'portal' | 'integration';
  metrics?: JobMetrics;
  webhook?: JobWebhookOutcome;
  logs: JobStepLog[];
  errorLogs: JobErrorLog[];
  result?: Record<string, unknown>;
  messages: JobMessage[];
};

export type JobDetailSuccess = Result<{ data: JobDetail }>;
