import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// One row per call that SEFAZ actually answered (`NFeDistribuicaoDFe`). The
// 20-queries/hour ceiling is per CNPJ and a `656` blocks it for an hour
// (docs/features/sefaz-nfe.md), so the only honest "how much have we used"
// number is a count of real calls over a sliding hour — kept here, not guessed.
const SefazRequestSchema = new Schema(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Stores',
      required: true,
    },
    // 1 production / 2 homologação — separate SEFAZ environments, counted apart.
    tpAmb: { type: Number, enum: [1, 2], required: true },
    cStat: { type: String, required: true, trim: true },
    xMotivo: { type: String, trim: true },
    ultNSU: { type: String, trim: true },
    maxNSU: { type: String, trim: true },
    documentsCount: { type: Number, required: true, default: 0 },
    // Set on `cStat 656`: when the 1h block ends. Retrying before resets it.
    blockedUntil: { type: Date },
    // A call recorded after the fact (made before this log existed) — its
    // timestamp is approximate and some fields (e.g. maxNSU) may be missing.
    retroactive: { type: Boolean, required: true, default: false },
    // Served by the simulated source (no real SEFAZ call) — logged for the audit
    // trail but never counted toward the 20/h ceiling.
    simulated: { type: Boolean, required: true, default: false },
    at: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, collection: 'sefaz_requests' },
);

SefazRequestSchema.index({ storeId: 1, tpAmb: 1, at: -1 });

type SefazRequest = InferSchemaType<typeof SefazRequestSchema>;
const SefazRequests =
  (models.SefazRequests as Model<SefazRequest>) ||
  model<SefazRequest>('SefazRequests', SefazRequestSchema);
export default SefazRequests;
