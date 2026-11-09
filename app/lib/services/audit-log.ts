import connectDB from '@/app/lib/connect-db';
import { logger } from '@/app/lib/logger';
import { toObjectId } from '@/app/lib/mongo-id';
import AuditEventsDB from '@/app/models/audit-events';

// Writing an audit row, on its own — deliberately apart from the query side in
// `audit-events.ts`, which needs the session and the authorization stack to decide
// what a viewer may see. Writers are the opposite: a worker, or a service answering
// a token-authenticated request, has no session and must not have to import one to
// leave a trace. (Concretely: pulling `authorization.ts` in here would drag NextAuth
// into every service that records an event.)

export type AuditEventSource = 'ui' | 'api' | 'external-api' | 'worker' | 'system';
export type AuditEventOutcome = 'success' | 'failure';

export type AuditEventInput = {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string;
  source: AuditEventSource;
  outcome?: AuditEventOutcome;
  message?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Records an organization-scoped audit event.
 *
 * Deliberately swallows its own failures: the caller is in the middle of a real
 * product action (creating a token, disabling an organization), and losing an
 * audit row is far better than failing that action. Failures are logged so the
 * gap is still visible in the structured logs.
 */
export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    await connectDB();
    await AuditEventsDB.create({
      organizationId: toObjectId(input.organizationId),
      actorUserId: input.actorUserId ? toObjectId(input.actorUserId) : null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      source: input.source,
      outcome: input.outcome ?? 'success',
      message: input.message ?? '',
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    logger.warn({ err, action: input.action }, 'audit event write failed');
  }
}
