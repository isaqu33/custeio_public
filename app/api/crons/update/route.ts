import { NextResponse } from 'next/server';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireSystemAccess } from '@/app/lib/authorization';
import { getCronDefinitions, isCronKey } from '@/app/lib/crons/definitions';
import { BadRequestError, NotFoundError, requireAuth } from '@/app/lib/errors';
import { AppFeature } from '@/app/lib/features';
import { HttpStatus } from '@/app/lib/http-status';
import { withObservability } from '@/app/lib/observability';
import { updateCron } from '@/app/lib/services/crons';
import { updateCronSchema } from '@/app/lib/validations';

/** Pauses/resumes a worker cron or changes how often it runs. Takes effect on the worker's next tick. */
export const POST = withObservability<{}>(AppFeature.CRONS_UPDATE, async (req, _ctx, { log }) => {
  const session = await requireAuth();
  await requireSystemAccess(session);
  const { key, enabled, intervalMinutes } = await parseRouteInput(req, updateCronSchema);

  if (!isCronKey(key)) throw new NotFoundError('Unknown cron.');
  const definition = getCronDefinitions().find((d) => d.key === key);
  if (
    definition &&
    intervalMinutes !== undefined &&
    (intervalMinutes < definition.minIntervalMinutes ||
      intervalMinutes > definition.maxIntervalMinutes)
  ) {
    throw new BadRequestError(
      `Interval must be between ${definition.minIntervalMinutes} and ${definition.maxIntervalMinutes} minutes.`,
    );
  }

  const updated = await updateCron(key, { enabled, intervalMinutes }, session.user?.id);
  if (!updated) throw new NotFoundError('Unknown cron.');
  log.info({ cron: key, enabled, intervalMinutes }, 'cron updated');

  return NextResponse.json(
    { done: true, data: updated, message: 'Cron updated.' },
    { status: HttpStatus.OK },
  );
});
