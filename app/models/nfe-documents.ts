import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// What SEFAZ (or an upload) handed us for one NFe, per store: the summary (`resNFe`, no items) as
// soon as it exists, upgraded to the full XML once it arrives. `processed_invoices` stays the
// idempotency guard of what was applied to stock; this one answers "what do we hold of this
// note, and can I download it?" — including notes whose items were not captured yet.
const NfeDocumentSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Stores', required: true },
    accessKey: { type: String, required: true, trim: true },
    // 'summary': only the preview (supplier, value, date). 'full': the whole NFe was read; the XML is
    // kept when it came as XML (a DANFE PDF has none).
    level: { type: String, enum: ['summary', 'full'], required: true },
    supplierCnpj: { type: String, trim: true },
    supplierName: { type: String, trim: true },
    number: { type: String, trim: true },
    series: { type: String, trim: true },
    issuedAt: { type: Date, required: true },
    totalValue: { type: Number, required: true },
    // Where the data came from and, for SEFAZ, the NSU of the latest document received.
    source: { type: String, enum: ['sefaz', 'upload'], required: true },
    nsu: { type: String },
    // Heavy (10–40 kB): never loaded by the list, only by the download.
    xml: { type: String, select: false },
    hasXml: { type: Boolean, default: false },
    summaryAt: { type: Date },
    fullAt: { type: Date },
  },
  { timestamps: true, collection: 'nfe_documents' },
);

NfeDocumentSchema.index({ storeId: 1, accessKey: 1 }, { unique: true });
NfeDocumentSchema.index({ storeId: 1, issuedAt: -1 });

type NfeDocument = InferSchemaType<typeof NfeDocumentSchema>;
const NfeDocuments =
  (models.NfeDocuments as Model<NfeDocument>) ||
  model<NfeDocument>('NfeDocuments', NfeDocumentSchema);
export default NfeDocuments;
