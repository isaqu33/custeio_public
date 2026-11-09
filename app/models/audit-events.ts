import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// Organization-scoped trail of who did what. Separate from `Jobs.logs` on
// purpose: those record what the pipeline did to one job, this records what a
// *person* did to the tenant's configuration and data. The two answer different
// questions ("why did this job fail?" vs "who disabled that token?").
//
// Writes are best-effort (see logAuditEvent) — an audit failure must never take
// down the action being audited.
const AuditEventSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organizations',
      required: true,
      index: true,
    },
    // Null when the actor is not a signed-in user — a worker or a token-authed
    // ingestion call. Events raised outside a human session carry no actor, so the absence is modelled directly and the UI
    // renders it as "System".
    actorUserId: { type: Schema.Types.ObjectId, ref: 'Users', default: null },
    // Dotted verb, e.g. 'token.create'. Free-form on purpose: an enum here would
    // need a migration every time a route starts auditing something.
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: String },
    source: {
      type: String,
      enum: ['ui', 'api', 'external-api', 'worker', 'system'],
      required: true,
    },
    outcome: { type: String, enum: ['success', 'failure'], default: 'success' },
    message: { type: String, default: '' },
    // Never put a secret or patient-identifying value here — this collection is
    // readable by every admin of the organization.
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true, collection: 'audit_events' },
);

// Listing is always "one organization (or the set the session may see), newest
// first"; `_id` breaks ties so pagination is stable within the same millisecond.
AuditEventSchema.index({ organizationId: 1, createdAt: -1, _id: -1 });
AuditEventSchema.index({ organizationId: 1, action: 1, createdAt: -1 });
AuditEventSchema.index({ actorUserId: 1, createdAt: -1 });

type AuditEvent = InferSchemaType<typeof AuditEventSchema>;

const AuditEvents =
  (models.AuditEvents as Model<AuditEvent>) || model<AuditEvent>('AuditEvents', AuditEventSchema);

export default AuditEvents;
