import connectDB from '@/app/lib/connect-db';
import JobsDB from '@/app/models/jobs';

/**
 * Appends one step to the job's `logs[]` — the same trail the runner writes
 * ("Worker picked job…") and the job detail view renders, so a job's handler can
 * say what it is doing without owning any of the log plumbing.
 */
export async function appendJobLog(
  jobId: string,
  entry: { step: string; message: string },
): Promise<void> {
  await connectDB();
  await JobsDB.updateOne(
    { _id: jobId },
    {
      $push: {
        logs: {
          jobStatus: 'running',
          examStatus: 'running',
          message: entry.message,
          step: entry.step,
          timestamp: new Date(),
        },
      },
    },
  );
}
