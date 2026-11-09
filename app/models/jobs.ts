import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';
import { env } from '@/app/lib/env';

const JobLogSchema = new Schema(
  {
    jobStatus: { type: String },
    examStatus: { type: String },
    message: { type: String },
    timestamp: { type: Date, default: Date.now },
    step: { type: String },
  },
  { _id: false },
);

// Start/end of one pipeline phase. Timestamps, not durations: a resumed job can
// reopen a phase, and every reader derives the span the same way.
const PhaseSpanSchema = new Schema(
  {
    startedAt: { type: Date },
    endedAt: { type: Date },
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
    examId: { type: String, required: true, index: true },
    // Absent on platform jobs: the runs of a cron (kind `cron.*`) belong to no organization, only
    // System/Support see them (system-only-kinds.ts).
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organizations',
      index: true,
    },
    type: { type: String, required: true },

    // Analysis-specific stages (converting/analyzing/synthesizing) live in
    // `progress.phase` — do not overload `status` with them.
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
    // Durable pipeline progress for the support jobs view (where a job is / where
    // it stopped) and for resume: `conversionComplete` lets a restarted analysis
    // job skip re-converting the whole study and reuse DicomResults instead.
    progress: {
      // 'converting' | 'converted' | 'analyzing' | 'synthesizing' | 'done'
      phase: { type: String },
      conversionComplete: { type: Boolean, default: false },
      instanceCount: { type: Number },
      // Files converted so far in the RUNNING conversion, written as it goes.
      // The study is streamed (bounded memory), so its total file count is
      // unknown until the last entry — this counter is the only thing a study
      // that spends twelve minutes converting has to show for itself.
      //
      // WHILE RUNNING this counts every DICOM the walk has dealt with, because
      // that is what makes the bar move; when the walk ends it is rewritten to
      // the number that were actually CONVERTED. The difference matters beyond
      // display: the exam billing falls back to this field when it cannot find
      // an instance count, and a study that skipped 300 out-of-scope slices
      // would otherwise be invoiced for them.
      convertedFiles: { type: Number },
      // Every DICOM instance the walk reached: converted + failed + out of
      // scope. The denominator that makes the other counters reconcile, and the
      // only record of how big the upload actually was — non-DICOM entries and
      // duplicates are not counted, since they were never candidates.
      filesSeen: { type: Number },
      // Where the time went. The support view answers "it took 40 minutes" with
      // "conversion 12, analysis 26, report 2" only because these are recorded;
      // durations are derived from the timestamps, never stored.
      timings: {
        startedAt: { type: Date },
        finishedAt: { type: Date },
        converting: { type: PhaseSpanSchema },
        analyzing: { type: PhaseSpanSchema },
        synthesizing: { type: PhaseSpanSchema },
      },
      failedFiles: { type: Number },
      // `sefaz.nfe.received` in SEFAZ-sync mode: live counters written as the run
      // goes (the analysis pipeline's pattern — durable progress, not just a
      // result at the end). `docsTotal` is a real denominator (NSUs pending, capped
      // by the per-run batch budget), so percent/ETA are computed, not guessed.
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
        itemsMatched: { type: Number },
        itemsDrafted: { type: Number },
        batchesDone: { type: Number },
        batchesMax: { type: Number },
        ultNsu: { type: String },
        maxNsu: { type: String },
        resumeAt: { type: String },
        resumeKind: { type: String }, // 'backlog' | 'poll'
      },
      batchesTotal: { type: Number },
      batchesDone: { type: Number },
      // Image batches the provider permanently rejected and that were dropped
      // from the laudo (partial analysis). Distinct from failedFiles, which is
      // DICOM→JPEG conversion failures.
      analysisFailedBatches: { type: Number },
      // Converted instances that were multi-frame (only the first frame analyzed).
      multiFrameInstances: { type: Number },
      // EXAM SCOPE — instances dropped because their modality is not on the
      // organization's allowlist (v1 reads plain film / mammography / ultrasound;
      // CT and MR wait for v2). Distinct from BOTH `failedFiles` (conversion
      // broke) and `analysisFailedBatches` (the provider rejected a batch):
      // nothing went wrong here, the images were simply out of scope.
      skippedByModality: { type: Number },
      // What the study actually held, per modality — the answer to "why did my
      // 400-image study come back as 12 images?" without opening a single file.
      modalityBreakdown: [
        new Schema(
          { modality: { type: String }, accepted: { type: Number }, skipped: { type: Number } },
          { _id: false },
        ),
      ],
      // BILLING — false marks a completed job that must NOT be invoiced. A study
      // whose every image was out of scope still reaches `status: 'done'` (it is
      // not an error; we processed it and told the client it is out of scope),
      // and the exam billing counts completed studies. Without this flag the
      // client would be charged for a report that says "we did not read this".
      // Absent means billable, so every job that predates the flag is unaffected.
      billable: { type: Boolean },
      notBillableReason: { type: String },
      // Who actually answered, per model: the org config records who was ASKED,
      // which stops being the same thing the moment a fallback answers.
      aiAttribution: [
        new Schema(
          {
            provider: { type: String },
            model: { type: String },
            batches: { type: Number },
            fallback: { type: Boolean },
            // Tokens this model alone accounted for. Present so a job that used
            // two providers can be costed per provider; the rows sum to
            // `progress.usage`. A field missing from this schema is silently
            // DROPPED by Mongoose on a dot-notation write — that is how
            // `analysisFailedBatches` was lost once. Do not add one without it.
            usage: {
              promptTokens: { type: Number },
              completionTokens: { type: Number },
              totalTokens: { type: Number },
            },
          },
          { _id: false },
        ),
      ],
      // Who wrote the final report (the laudo), which can differ from the model
      // that read the images.
      aiSynthesis: {
        provider: { type: String },
        model: { type: String },
        fallback: { type: Boolean },
      },
      // Total AI token usage for the analysis (image batches + synthesis).
      usage: {
        promptTokens: { type: Number },
        completionTokens: { type: Number },
        totalTokens: { type: Number },
      },
    },
    // Outcome of the completion-webhook delivery (shown in the support jobs view).
    webhook: {
      delivered: { type: Boolean },
      attempts: { type: Number },
      lastStatus: { type: String },
      deliveredAt: { type: Date },
    },
    errorLogs: { type: Array, default: [] },
    logs: [JobLogSchema],
  },
  {
    timestamps: true,
    collection: 'jobs',
  },
);

JobsSchema.index({ examId: 1, organizationId: 1 }, { unique: true });
JobsSchema.index({ organizationId: 1, createdAt: -1 });
JobsSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
JobsSchema.index({ kind: 1, status: 1, createdAt: -1 });

type Job = InferSchemaType<typeof JobsSchema>;
const Jobs = (models.Jobs as Model<Job>) || model<Job>('Jobs', JobsSchema);
export default Jobs;
