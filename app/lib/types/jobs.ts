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
};

export type JobsListSuccess = Result<{
  data: JobListItem[];
  total: number;
  page: number;
  totalPages: number;
}>;

// --- Job detail (single job) ---

// When the run started and stopped. `startedAt` is when the WORKER picked the
// job, not when it was queued — the two differ by the queue wait.
export type JobTimings = {
  startedAt?: string | Date;
  finishedAt?: string | Date;
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
  timings?: JobTimings;
};

export type JobStepLog = {
  jobStatus?: string;
  message?: string;
  step?: string;
  timestamp?: string | Date;
};

// `code` is a stable slug for WHY it failed, stored alongside the untranslatable
// provider text so the UI can label the failure in the reader's language.
export type JobErrorLog = {
  message?: string;
  code?: string;
  attempt?: number;
  timestamp?: string | Date;
};

export type JobDetail = {
  _id: string;
  examId: string;
  // Ties this job to the HTTP request that created it: the route puts its
  // requestId here and the worker logs every line under the same value, so
  // support can go from a job on screen to its logs.
  correlationId?: string;
  organizationId: string;
  kind?: string;
  type: string;
  status: JobStatus;
  createdAt: string | Date;
  updatedAt?: string | Date;
  progress?: JobProgress;
  logs: JobStepLog[];
  errorLogs: JobErrorLog[];
  result?: Record<string, unknown>;
};

export type JobDetailSuccess = Result<{ data: JobDetail }>;
