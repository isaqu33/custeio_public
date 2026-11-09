import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

const SystemSettingsSchema = new Schema(
  {
    gatewayUpdateEnabled: { type: Boolean, default: false },
    gatewayUpdateVersion: { type: String, default: '' },
    gatewayUpdateUrl: { type: String, default: '' },
    gatewayUpdateSha256: { type: String, default: '' },
    gatewayUpdateSignature: { type: String, default: '' },
    gatewayUpdateRequired: { type: Boolean, default: true },
    // PLATFORM BILLING (Phase 2) — the editable rate card. Absent means "use the
    // shipped table and the PLATFORM_AI_* env values"; a stored row overrides the
    // one in `app/lib/ai/pricing.ts` for that exact provider+model. Kept here, and
    // not in env, because a provider price change must not need a redeploy — and
    // because who changed a billing rate, and when, has to be answerable.
    aiPricing: {
      models: {
        type: [
          new Schema(
            {
              provider: { type: String, required: true },
              model: { type: String, required: true },
              // USD per 1,000,000 tokens.
              input: { type: Number, required: true, min: 0 },
              output: { type: Number, required: true, min: 0 },
            },
            { _id: false },
          ),
        ],
        default: undefined,
      },
      margin: { type: Number, min: 0 },
      usdToBrl: { type: Number, min: 0 },
      updatedAt: { type: Date },
      updatedBy: { type: Schema.Types.ObjectId, ref: 'Users' },
    },
    // PLATFORM BILLING — what the CLIENT pays, which is a different question from
    // what the AI costs us (`aiPricing` above). Clients are billed per exam in
    // bands of image count: they do not think in tokens, and per-exam is the
    // market convention. The token meter stays as our internal cost ruler.
    //
    // Bands are ordered by `maxImages`, each covering everything above the
    // previous one up to and including its own bound. The last band may carry a
    // null bound, meaning "and anything larger" — without one, an exam bigger
    // than every band has no price, which the billing surfaces as unpriced rather
    // than as free.
    examPricing: {
      bands: {
        type: [
          new Schema(
            {
              // Upper bound, inclusive. Null = open-ended (the last band).
              maxImages: { type: Number, min: 1, default: null },
              // BRL per exam. 0 means "not priced yet" and is reported as such —
              // never as a free exam.
              priceBrl: { type: Number, required: true, min: 0 },
            },
            { _id: false },
          ),
        ],
        default: undefined,
      },
      updatedAt: { type: Date },
      updatedBy: { type: Schema.Types.ObjectId, ref: 'Users' },
    },
    // EXAM SCOPE — leftover from the RayAI/radiology domain (a DICOM modality
    // allowlist). The per-organization override this described was removed
    // from Organizations in the KairosFlow pivot; this platform-default block
    // is now dead weight too and a candidate for its own cleanup pass.
    examModalities: {
      rules: {
        type: [
          new Schema(
            {
              // The literal value of DICOM tag (0008,0060), uppercase.
              modality: { type: String, required: true, uppercase: true, trim: true },
              // Most images of this modality one study may carry. Null = no
              // ceiling, which is what ships: see DEFAULT_MODALITY_RULES.
              maxImages: { type: Number, min: 1, default: null },
            },
            { _id: false },
          ),
        ],
        default: undefined,
      },
      updatedAt: { type: Date },
      updatedBy: { type: Schema.Types.ObjectId, ref: 'Users' },
    },
    // PROMPTS — what an admin CHANGED, never the whole prompt set. A field that
    // is absent falls back to the text shipped in `app/lib/ai/prompts.ts`, which
    // is what makes "restore the default" possible and what keeps an
    // installation that never customized a prompt from being frozen on the
    // wording of the release it was installed under: it follows ours.
    //
    // Stored here rather than in env because a prompt is edited by a person
    // reading a report that came out wrong, and that person must not need a
    // deploy — and because who changed the instructions a diagnosis was written
    // under, and when, has to be answerable.
    aiPrompts: {
      // The four free-text prompts. Undefined = shipped default.
      leaf: { type: String },
      merge: { type: String },
      finalReport: { type: String },
      chat: { type: String },
      // Per-modality report templates, matched to a shipped family by `key`.
      // The modality CODES are not stored: which codes a template covers stays
      // in code, because two families both claiming `MG` would make the
      // template chosen for a study undefined.
      families: {
        type: [
          new Schema(
            {
              key: { type: String, required: true, trim: true },
              reportTitle: { type: String },
              standard: { type: String },
              observe: { type: [String] },
              analysis: { type: [String] },
              conclusion: { type: String },
            },
            { _id: false },
          ),
        ],
        default: undefined,
      },
      updatedAt: { type: Date },
      updatedBy: { type: Schema.Types.ObjectId, ref: 'Users' },
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Users' },
  },
  { timestamps: true, collection: 'system_settings' },
);

SystemSettingsSchema.index({ updatedBy: 1 });

type SystemSettings = InferSchemaType<typeof SystemSettingsSchema>;
const Settings =
  (models.SystemSettings as Model<SystemSettings>) ||
  model<SystemSettings>('SystemSettings', SystemSettingsSchema);
export default Settings;
