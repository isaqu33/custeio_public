import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// Fiscal idempotency guard: one document per NFe ever ingested, so a re-sent or
// re-uploaded XML is recognized and skipped instead of double-crediting stock.
const ProcessedInvoiceSchema = new Schema(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Stores',
      required: true,
      index: true,
    },
    // The NFe's own 44-digit chave de acesso — globally unique by construction
    // (it encodes issuer CNPJ, series, number and a check digit), so this alone
    // is the guard; no compound key with storeId is needed.
    accessKey: { type: String, required: true, unique: true, trim: true },
    issuedAt: { type: Date, required: true },
    totalValue: { type: Number, required: true },
    // Who sold it and which document it is — so "which invoice is this?" does not
    // need the XML, which is not kept. Optional: invoices captured before these
    // existed do not have them.
    supplierCnpj: { type: String, trim: true, index: true },
    supplierName: { type: String, trim: true },
    number: { type: String, trim: true },
    series: { type: String, trim: true },
    // Σ of the line values, and what the invoice total adds on top (freight, other
    // expenses, IPI/ST, minus discounts) — the part that is spread into line costs.
    itemsValue: { type: Number },
    adjustmentsValue: { type: Number },
    // 'ignored' covers an NFe read but deliberately not applied — e.g. a return or
    // a non-merchandise invoice — kept so re-processing sees it as handled, not
    // missing.
    //
    // 'cancelled': SEFAZ reported the NFe cancelled (event 110111). Its stock was
    // given back if it had been credited, and it is never applied again.
    status: {
      type: String,
      enum: ['processed', 'ignored', 'cancelled'],
      required: true,
      default: 'processed',
    },
    cancelledAt: { type: Date },
    // Hand-typed purchases ("Registrar compra") that look like lines of this invoice — the same
    // ingredient, a close date and a close quantity — flagged when the invoice was captured. The
    // stock was credited twice if both are real; the owner decides (see manual-overlaps.ts).
    manualOverlaps: {
      type: [
        new Schema(
          {
            movementId: { type: Schema.Types.ObjectId, required: true },
            rawIngredientId: { type: Schema.Types.ObjectId, required: true },
            ingredientName: { type: String },
            unit: { type: String, enum: ['g', 'ml', 'un'] },
            supplierName: { type: String },
            occurredAt: { type: Date },
            quantity: { type: Number },
            value: { type: Number },
            status: { type: String, enum: ['open', 'undone', 'kept'], default: 'open' },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
  },
  { timestamps: true, collection: 'processed_invoices' },
);

ProcessedInvoiceSchema.index({ storeId: 1, issuedAt: -1 });

type ProcessedInvoice = InferSchemaType<typeof ProcessedInvoiceSchema>;
const ProcessedInvoices =
  (models.ProcessedInvoices as Model<ProcessedInvoice>) ||
  model<ProcessedInvoice>('ProcessedInvoices', ProcessedInvoiceSchema);
export default ProcessedInvoices;
