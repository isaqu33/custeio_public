import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// The ledger behind `RawIngredients.currentStock`: one row for every change of
// the balance, so "why is there 5 kg of sugar?" has an answer (which invoice,
// from whom, on what date, at what cost) instead of a bare number.
//
//  - `purchase`   an NFe line credited to stock (sefaz.nfe.received), or a purchase typed in by
//                 hand when the note is not capturable (`source.manualBatchId`, no invoice).
//  - `adjustment` a person set the balance: an inventory count or a manual edit.
//  - `reversal`   a purchase undone because SEFAZ reported the NFe cancelled, or a sale undone
//                 because the PDV cancelled the order; carries the same `source` as what it reverses
//                 and the opposite signs.
//  - `production` a batch of a preparation (Registrar lote): the preparation comes in (positive,
//                 valued at what its ingredients cost) and each ingredient it used goes out
//                 (negative), all rows sharing `source.batchId`.
//  - `internal_use` stock taken out with no sale: an employee took a meat, a courtesy, a donation.
//                 Negative quantity, valued at the ingredient's average cost of that moment (what
//                 the person owes, never the selling price), with a `reason` and, usually, the
//                 `personName`. The rows of one entry share `source.entryId`.
//  - `waste`      an avaria: stock that spoiled, expired, broke or arrived damaged and cannot be used.
//                 Same shape as `internal_use` (negative, valued at the average cost of that moment,
//                 rows of one entry share `source.entryId`) with a `reason` and no person.
//  - `sale`       an order debited by recipe (pos.order.received): negative quantity, valued at the
//                 ingredient's average cost of that moment, with `source.externalOrderId`.
//
// `RawIngredients.currentStock` stays the running balance the rest of the app
// reads; this is the history it was built from.
const SourceSchema = new Schema(
  {
    invoiceAccessKey: { type: String, trim: true },
    invoiceNumber: { type: String, trim: true },
    invoiceSeries: { type: String, trim: true },
    // Digits only, like `SupplierItemMappings.supplierCnpj`.
    supplierCnpj: { type: String, trim: true },
    // The trade name when the supplier has one (what people call it), else the legal name.
    supplierName: { type: String, trim: true },
    supplierItemCode: { type: String, trim: true },
    // The supplier's own description of the line, as typed.
    description: { type: String, trim: true },
    // Position of the line inside its invoice — with the access key, what makes
    // a re-run of a half-applied invoice skip the lines it already credited.
    itemIndex: { type: Number },
    // A purchase typed in by hand (no invoice): the id of that entry, shared by its lines. With
    // `itemIndex` it makes a double submit of the same form credit the stock only once.
    manualBatchId: { type: String, trim: true },
    // A sale (or its reversal): the PDV's reference of the order that used the stock. With the
    // store and the ingredient it makes the debit of an order happen once, however many events
    // (new order, status change…) announce it.
    externalOrderId: { type: String, trim: true },
    // Which pass over that order wrote the row: 1 is the first debit; reprocessing the order after
    // a recipe was added (or cancelling it) writes only the DIFFERENCE under the next revision.
    orderRevision: { type: Number },
    // A batch of a preparation: the id of that entry, shared by its rows. With the ingredient it
    // makes a double submit of "Registrar lote" count once.
    batchId: { type: String, trim: true },
    // An internal-use entry (Consumo interno): the id of that entry, shared by its rows. With the
    // store and the ingredient it makes a double submit of the form count once.
    entryId: { type: String, trim: true },
  },
  { _id: false },
);

const StockMovementSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Stores', required: true, index: true },
    rawIngredientId: { type: Schema.Types.ObjectId, ref: 'RawIngredients', required: true },
    type: {
      type: String,
      enum: ['purchase', 'reversal', 'adjustment', 'sale', 'production', 'internal_use', 'waste'],
      required: true,
    },
    // When it happened: the invoice's issue date for a purchase, now for an adjustment.
    occurredAt: { type: Date, required: true },
    // Signed change of the balance, in the ingredient's own unit (g, ml, un).
    quantity: { type: Number, required: true },
    // Purchase only. `unitCost` is the landed cost (freight, other expenses and
    // discounts spread in) per stock unit; `value` is that landed cost of the line.
    unitCost: { type: Number },
    value: { type: Number },
    // Adjustment only: the balance before and after, and why.
    balanceBefore: { type: Number },
    balanceAfter: { type: Number },
    note: { type: String, trim: true },
    // Internal use only: why it left, and who took it (a label, not a user or an account).
    reason: {
      type: String,
      enum: [
        'employee',
        'courtesy',
        'donation',
        'other',
        'expired',
        'breakage',
        'receiving_damage',
      ],
    },
    personName: { type: String, trim: true },
    createdByUserId: { type: String },
    source: { type: SourceSchema },
  },
  { timestamps: true, collection: 'stock_movements' },
);

// The history of one ingredient, newest first.
StockMovementSchema.index({ storeId: 1, rawIngredientId: 1, occurredAt: -1 });

// One movement per invoice line, ever: what makes a purchase idempotent even
// when a run dies between two lines of the same invoice (the invoice itself is
// only marked processed at the end).
StockMovementSchema.index(
  { 'source.invoiceAccessKey': 1, 'source.itemIndex': 1 },
  {
    unique: true,
    partialFilterExpression: { type: 'purchase', 'source.invoiceAccessKey': { $exists: true } },
  },
);

// ...and one movement per line of a hand-typed purchase (`manualBatchId` is the entry's id).
StockMovementSchema.index(
  { 'source.manualBatchId': 1, 'source.itemIndex': 1 },
  {
    name: 'manual_purchase_once_per_line',
    unique: true,
    partialFilterExpression: { type: 'purchase', 'source.manualBatchId': { $exists: true } },
  },
);

// One debit and one reversal per ingredient, order and revision: what keeps a re-run (or the same
// order announced by two events) from taking the stock out twice.
StockMovementSchema.index(
  { storeId: 1, 'source.externalOrderId': 1, rawIngredientId: 1, 'source.orderRevision': 1 },
  {
    name: 'order_sale_once_per_ingredient_revision',
    unique: true,
    partialFilterExpression: { type: 'sale', 'source.externalOrderId': { $exists: true } },
  },
);
StockMovementSchema.index(
  { storeId: 1, 'source.externalOrderId': 1, rawIngredientId: 1, 'source.orderRevision': 1 },
  {
    name: 'order_reversal_once_per_ingredient_revision',
    unique: true,
    partialFilterExpression: { type: 'reversal', 'source.externalOrderId': { $exists: true } },
  },
);

// One row per ingredient and batch, however many times the same batch is submitted.
StockMovementSchema.index(
  { storeId: 1, 'source.batchId': 1, rawIngredientId: 1 },
  {
    name: 'production_once_per_ingredient_batch',
    unique: true,
    partialFilterExpression: { type: 'production', 'source.batchId': { $exists: true } },
  },
);

// One row per ingredient and internal-use entry, however many times the same entry is submitted.
StockMovementSchema.index(
  { storeId: 1, 'source.entryId': 1, rawIngredientId: 1 },
  {
    name: 'internal_use_once_per_ingredient_entry',
    unique: true,
    partialFilterExpression: { type: 'internal_use', 'source.entryId': { $exists: true } },
  },
);

// One row per ingredient and avaria entry, however many times the same entry is submitted.
StockMovementSchema.index(
  { storeId: 1, 'source.entryId': 1, rawIngredientId: 1 },
  {
    name: 'waste_once_per_ingredient_entry',
    unique: true,
    partialFilterExpression: { type: 'waste', 'source.entryId': { $exists: true } },
  },
);

// Who took what, in a period: the "Consumo interno" summary.
StockMovementSchema.index({ storeId: 1, type: 1, occurredAt: -1 });

// ...and one reversal per line of a hand-typed purchase (undone because an invoice replaced it).
StockMovementSchema.index(
  { 'source.manualBatchId': 1, 'source.itemIndex': 1 },
  {
    name: 'manual_reversal_once_per_line',
    unique: true,
    partialFilterExpression: { type: 'reversal', 'source.manualBatchId': { $exists: true } },
  },
);

// ...and one reversal per invoice line, so a cancellation event delivered twice
// (or a half-applied one that is re-run) never gives the stock back twice.
StockMovementSchema.index(
  { 'source.invoiceAccessKey': 1, 'source.itemIndex': 1 },
  {
    name: 'reversal_once_per_invoice_line',
    unique: true,
    partialFilterExpression: { type: 'reversal', 'source.invoiceAccessKey': { $exists: true } },
  },
);

type StockMovement = InferSchemaType<typeof StockMovementSchema>;
const StockMovements =
  (models.StockMovements as Model<StockMovement>) ||
  model<StockMovement>('StockMovements', StockMovementSchema);
export default StockMovements;
