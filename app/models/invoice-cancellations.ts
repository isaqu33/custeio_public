import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// A cancellation SEFAZ reported for an NFe this store had not captured yet (the
// event can be distributed before the invoice is read, or the invoice may only
// ever arrive as a manual upload). Kept so that capturing it later records it as
// cancelled instead of crediting stock for an invoice that no longer exists.
const InvoiceCancellationSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Stores', required: true, index: true },
    accessKey: { type: String, required: true, trim: true },
    cancelledAt: { type: Date, required: true },
    // The NSU that carried the event, when it came through the distribution service.
    nsu: { type: String, trim: true },
  },
  { timestamps: true, collection: 'invoice_cancellations' },
);

// One per invoice per store; the access key is globally unique but the same store
// is the only reader, so the pair keeps the lookup cheap and tenant-scoped.
InvoiceCancellationSchema.index({ storeId: 1, accessKey: 1 }, { unique: true });

type InvoiceCancellation = InferSchemaType<typeof InvoiceCancellationSchema>;
const InvoiceCancellations =
  (models.InvoiceCancellations as Model<InvoiceCancellation>) ||
  model<InvoiceCancellation>('InvoiceCancellations', InvoiceCancellationSchema);
export default InvoiceCancellations;
