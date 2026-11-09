import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';
import { env } from '@/app/lib/env';

const JobLogSchema = new Schema(
  {
    jobStatus: { type: String },
    message: { type: String },
    timestamp: { type: Date, default: Date.now },
    step: { type: String },
  },
  { _id: false },
);

const JobsSchema = new Schema(
  {
    kind: { type: String, index: true },
    handler: { type: String },
    payload: { type: Schema.Types.Mixed },
    // Defaults come from the env knobs, never from literals here: a job created
    // without an explicit config used to inherit 3 attempts / 5s — shorter than
    // the AI breaker's cooldown, so a provider blip failed the study for good.
    // One place decides the retry policy, and it is `APP_BULL_*`.
    config: {
      attempts: { type: Number, default: () => env.APP_BULL_JOB_ATTEMPTS },
      backoff: {
        type: { type: String, default: 'exponential' },
        delay: { type: Number, default: () => env.APP_BULL_BACKOFF_DELAY_MS },
      },
      removeOnComplete: { type: Boolean, default: true },
      removeOnFail: { type: Number, default: 1000 },
    },
    queue: {
      provider: { type: String, default: 'bull' },
      queueName: { type: String, default: 'custeio-jobs' },
      queueJobId: { type: String },
    },
    reference: { type: String, required: true, index: true },
    // Absent on platform jobs: the runs of a cron (kind `cron.*`) belong to no organization, only
    // System/Support see them (system-only-kinds.ts).
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organizations',
      index: true,
    },
    type: { type: String, required: true },

    // Finer-grained stages live in `progress.phase` — do not overload `status`.
    status: {
      type: String,
      enum: ['queued', 'running', 'done', 'failed', 'canceled'],
      default: 'queued',
    },
    params: {
      retry: {
        retries: { type: Number, default: 3 },
        wait: { type: Number, default: 5000 },
        backoff: { type: String, default: 'exponential' },
      },
      payloadOriginal: { type: Object },
      userLoggedId: { type: String },
    },
    result: { type: Schema.Types.Mixed },
    // Durable progress for the support jobs view (where a job is / where it
    // stopped), written as the run goes rather than only at the end.
    progress: {
      phase: { type: String },
      // Where the time went; durations are derived from the timestamps, never stored.
      timings: {
        startedAt: { type: Date },
        finishedAt: { type: Date },
      },
      // `sefaz.nfe.received` in SEFAZ-sync mode: live counters written as the run
      // goes. `docsTotal` is a real denominator (NSUs pending, capped by the
      // per-run batch budget), so percent/ETA are computed, not guessed.
      nfe: {
        phase: { type: String }, // 'fetching' | 'processing' | 'done' | 'blocked' | 'paused'
        source: { type: String }, // 'simulated' | 'live'
        docsTotal: { type: Number },
        docsDone: { type: Number },
        invoicesProcessed: { type: Number },
        invoicesDuplicate: { type: Number },
        invoicesFailed: { type: Number },
        invoicesCancelled: { type: Number },
        cancelledValue: { type: Number },
        docsIgnored: { type: Number },
        // resNFe previews kept for the Notas screen (no items, nothing applied to stock).
        summariesRecorded: { type: Number },
        itemsMatched: { type: Number },
        itemsDrafted: { type: Number },
        batchesDone: { type: Number },
        batchesMax: { type: Number },
        ultNsu: { type: String },
        maxNsu: { type: String },
        resumeAt: { type: String },
        resumeKind: { type: String }, // 'backlog' | 'poll'
      },
    },
    errorLogs: { type: Array, default: [] },
    logs: [JobLogSchema],
  },
  {
    timestamps: true,
    collection: 'jobs',
  },
);

JobsSchema.index({ reference: 1, organizationId: 1 }, { unique: true });
JobsSchema.index({ organizationId: 1, createdAt: -1 });
JobsSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
JobsSchema.index({ kind: 1, status: 1, createdAt: -1 });

type Job = InferSchemaType<typeof JobsSchema>;
const Jobs = (models.Jobs as Model<Job>) || model<Job>('Jobs', JobsSchema);
export default Jobs;
