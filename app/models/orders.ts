import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// One sale from the Alloy webhook: the idempotency guard against a re-sent event
// (pos.order.received upserts on storeId+externalOrderId rather than
// debiting stock twice), and the historical CMV record the daily executive
// briefing and the dashboard aggregate from.
// What the PDV reported for one add-on of an item ("Blend Angus (100g)", "Ao Ponto").
// `externalCode` is the PDV's own code (Alloy's `cod_pdv`), shared across products — the
// key a complement recipe is looked up by. A zero price does not mean no consumption.
const OrderItemModifierSchema = new Schema(
  {
    externalCode: { type: String, default: '', trim: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    // As the PDV reported it (Alloy's `valor`).
    price: { type: Number, default: 0 },
  },
  { _id: false },
);

// One line sold. `externalCode` is the PDV's product code (Alloy's `cod_pdv`), NOT the
// catalog row id: it repeats across catalog copies of the same product (one per channel),
// which makes it the identity of the product a recipe hangs on. The name is kept as sold.
const OrderItemSchema = new Schema(
  {
    // Empty when the PDV sends the product with no code (some promotions do): it can then only
    // be matched by name.
    externalCode: { type: String, default: '', trim: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    // As the PDV reported it (Alloy's `valor`).
    price: { type: Number, default: 0 },
    modifiers: { type: [OrderItemModifierSchema], default: [] },
  },
  { _id: false },
);

const OrderSchema = new Schema(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Stores',
      required: true,
      index: true,
    },
    externalOrderId: { type: String, required: true },
    // Where the sale was made, in Custeio's own terms rather than the PDV's, so the
    // same shape serves other PDVs later. Alloy's `id_provedor` null = the store's
    // own channel; 1 = iFood.
    channel: { type: String, default: 'own' },
    // The PDV's raw status code (Alloy `status`/`novo_status`); not yet mapped.
    externalStatus: { type: Number },
    // When the sale happened at the PDV (Alloy `created_at`), not when we stored it.
    placedAt: { type: Date },
    // What was sold, with add-ons: the input of expected consumption.
    items: { type: [OrderItemSchema], default: [] },
    // Where the stock debit of this order stands: 'pending' until an event says it was accepted,
    // 'debited' once its recipes were taken out of stock, 'reversed' when the PDV cancelled it.
    stockStatus: { type: String, enum: ['pending', 'debited', 'reversed'], default: 'pending' },
    stockDebitedAt: { type: Date },
    // How many times the stock of this order was settled: 1 after the first debit, +1 for each
    // reprocess (a recipe added later) or cancellation. Guards two runs from settling it at once.
    stockRevision: { type: Number, default: 1 },
    // What could not be debited for lack of a recipe (a product or complement without a ficha
    // técnica): the order's cost is then a floor, never a precise number.
    incompleteLines: {
      type: [
        new Schema(
          {
            kind: { type: String, enum: ['product', 'modifier'], required: true },
            codPdv: { type: String, default: '' },
            name: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    deliveryFee: { type: Number, default: 0 },
    // Rows made by `scripts/dev/seed-orders.ts` to show the Pedidos screen; never from a PDV.
    demo: { type: Boolean, default: false },
    discountValue: { type: Number, default: 0 },
    totalValue: { type: Number, required: true },
    // The real ingredient cost at the moment of sale — recipe quantities priced
    // against each RawIngredient.averageCost as it stood then, not as it stands
    // now, so a later purchase never rewrites a past sale's margin.
    calculatedCost: { type: Number, required: true, default: 0 },
    // Fraction, not percentage: 0.42 means 42%. (totalValue - calculatedCost) /
    // totalValue, computed once at write time rather than derived on every read.
    profitMargin: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: 'orders' },
);

// The webhook's own idempotency lookup, and the shape every daily/period
// aggregation queries against.
OrderSchema.index({ storeId: 1, externalOrderId: 1 }, { unique: true });
OrderSchema.index({ storeId: 1, createdAt: -1 });
OrderSchema.index({ storeId: 1, placedAt: -1 });

type Order = InferSchemaType<typeof OrderSchema>;
const Orders = (models.Orders as Model<Order>) || model<Order>('Orders', OrderSchema);
export default Orders;
