// A job failure a retry cannot fix: the payload or the configuration is wrong,
// not the world. The runner discards the queue's remaining attempts for these, so
// the job fails ONCE with one clear reason instead of re-recording the same
// rejection until the attempt budget runs out.
//
// Deliberately narrow — when in doubt a failure is transient, because the retry
// with the checkpoint is what rides out a provider outage. Support can always
// re-run the job by hand (that enqueues a fresh one) after fixing the cause.
export class PermanentJobError extends Error {
  // Stable slug for why it failed (see AiFailureCode), persisted on the job's
  // error log so the UI can label the cause in the reader's language.
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PermanentJobError';
  }
}
