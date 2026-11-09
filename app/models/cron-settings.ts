import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// One row per recurring task the worker runs (see app/lib/crons/definitions.ts).
// The worker ticks once a minute and reads these, so pausing a cron or changing
// its interval takes effect without a restart. Seeded on first read with the
// defaults; the row is the source of truth after that.
const CronSettingSchema = new Schema(
  {
    key: { type: String, required: true, trim: true },
    enabled: { type: Boolean, required: true, default: true },
    intervalMinutes: { type: Number, required: true },
    // When the last run was CLAIMED (atomically, so replicas do not both run it).
    lastRunAt: { type: Date },
    lastDurationMs: { type: Number },
    // One-line outcome of the last run, or why it failed. Cleared on a good run.
    lastResult: { type: String },
    lastError: { type: String },
    updatedByUserId: { type: String },
  },
  { timestamps: true, collection: 'cron_settings' },
);

// One row per task: also what the scheduler's upsert-on-first-read relies on.
CronSettingSchema.index({ key: 1 }, { unique: true });

type CronSetting = InferSchemaType<typeof CronSettingSchema>;
const CronSettings =
  (models.CronSettings as Model<CronSetting>) ||
  model<CronSetting>('CronSettings', CronSettingSchema);
export default CronSettings;
