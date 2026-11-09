import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// What a PDV sent us by webhook, one row per distinct delivery — the history the
// "Eventos do PDV" page shows and the audit trail for the stock debit that will hang
// on it. Only a SANITIZED view of the order is kept (see alloy-webhook.ts): the raw
// payload carries the customer's name, phone, CPF and address, which Custeio does not
// need and should not hold.
const PosEventSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Stores', required: true },
    provider: { type: String, default: 'alloy' },
    receivedAt: { type: Date, required: true, default: () => new Date() },
    // How Custeio classifies it, independent of the PDV's own vocabulary.
    kind: {
      type: String,
      enum: ['new_order', 'status_change', 'cancellation', 'unknown'],
      required: true,
    },
    // The PDV's own event name ("novo_pedido", "alteracao_de_status") and the store id
    // it declared (Alloy's `loja_id`), kept as received.
    event: { type: String, default: '' },
    externalStoreId: { type: String },
    externalOrderId: { type: String },
    // The PDV's raw status code and its meaning to us ('new', 'accepted', 'in_transit'…).
    statusCode: { type: Number },
    statusLabel: { type: String },
    // 'own' for the store's channel, 'ifood', 'didifood'…
    channel: { type: String, default: 'own' },
    // Sanitized order: totals, payment, items with their complements. No customer data.
    order: { type: Schema.Types.Mixed },
    // The delivery as received, customer data masked (alloy-webhook.ts `redactAlloyPayload`):
    // what to read when a client reports a problem with an order.
    payload: { type: Schema.Types.Mixed },
    // Hash of the raw body: Alloy re-sends after 5 minutes when it gets no valid answer,
    // and the same delivery must not be recorded twice.
    dedupeKey: { type: String, required: true },
    // Rows made by `scripts/dev/seed-pos-events.ts` to show the page; never from a PDV.
    demo: { type: Boolean, default: false },
  },
  { timestamps: false, collection: 'pos_events' },
);

PosEventSchema.index({ storeId: 1, receivedAt: -1 });
PosEventSchema.index({ storeId: 1, kind: 1, receivedAt: -1 });
PosEventSchema.index({ storeId: 1, dedupeKey: 1 }, { unique: true });

type PosEvent = InferSchemaType<typeof PosEventSchema>;
const PosEvents =
  (models.PosEvents as Model<PosEvent>) || model<PosEvent>('PosEvents', PosEventSchema);
export default PosEvents;
