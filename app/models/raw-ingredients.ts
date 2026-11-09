import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// What is physically on the shelf or in the fridge, per loja. `currentStock`
// is the running balance — jobs.pos.order.received debits it per recipe, and
// jobs.sefaz.nfe.received credits it (and rolls averageCost forward) on purchase.
const RawIngredientSchema = new Schema(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Stores',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    // Every ingredient's stock and every recipe line reads in one of these three
    // — a purchase or a recipe in any other unit is converted at the boundary
    // (SupplierItemMappings.conversionFactor for purchases) rather than stored here.
    unit: { type: String, enum: ['g', 'ml', 'un'], required: true },
    currentStock: { type: Number, required: true, default: 0 },
    // Weighted average cost per unit, rolled forward on each purchase
    // (sefaz.nfe.received) — this, not the invoice's line price, is what a sale's
    // CMV is costed against.
    averageCost: { type: Number, required: true, default: 0 },
    // Which cost recipes and sales are valued at. `average`: the weighted average of what is on
    // hand. `last_purchase`: the unit cost of the newest purchase, whichever supplier it came from
    // — for an ingredient bought from more than one place ("Bacon"), where yesterday's price is
    // what the next one costs. Either way it is stored in `averageCost`, the one field the rest of
    // the app reads (see creditRawIngredientPurchase).
    costBasis: { type: String, enum: ['average', 'last_purchase'], default: 'average' },
    // Set on what the kitchen makes itself ("Molho da Casa", "cebola caramelizada"): the recipe
    // of ONE batch and how much that batch yields, in this ingredient's own unit. "Registrar lote"
    // takes the lines out of stock and puts the yield in, at the cost of what went in.
    preparation: {
      type: new Schema(
        {
          yield: { type: Number, required: true, min: 0 },
          lines: {
            type: [
              new Schema(
                {
                  rawIngredientId: {
                    type: Schema.Types.ObjectId,
                    ref: 'RawIngredients',
                    required: true,
                  },
                  quantity: { type: Number, required: true, min: 0 },
                },
                { _id: false },
              ),
            ],
            default: [],
          },
        },
        { _id: false },
      ),
    },
    // How the team calls it besides `name` ("carne", "blend"), so a free-text message finds it.
    aliases: { type: [String], default: [] },
    // EAN/GTIN printed on the product and on the receipt line: a stable key that does not depend on
    // the supplier's own code. A barcode belongs to one ingredient per store (checked in the service).
    barcodes: { type: [String], default: [] },
    // The pack it is bought in, in this ingredient's own unit ("Fardo 12 un" = 12, "Bag 1,6 kg" = 1600).
    purchasePack: {
      type: new Schema(
        { label: { type: String, trim: true }, quantity: { type: Number, required: true, min: 0 } },
        { _id: false },
      ),
    },
    // Grams per ml, so a recipe can say "15 g" of something stocked in ml (or the reverse). `manual` is the
    // owner's, `derived` comes from the preparation's own recipe, `estimate` is a guess to confirm.
    density: {
      type: new Schema(
        {
          gramsPerMl: { type: Number, required: true, min: 0.01 },
          source: { type: String, enum: ['manual', 'derived', 'estimate'], required: true },
        },
        { _id: false },
      ),
    },
    // Below this, the WhatsApp low-stock alert fires. 0 (the default) means "never
    // alert" rather than "always alert" — an ingredient added without a threshold
    // set shouldn't page anyone.
    minAlertStock: { type: Number, required: true, default: 0 },
    // Set when sefaz.nfe.received (Tier 1) auto-creates this ingredient from an
    // NFe line with no existing SupplierItemMappings entry — the owner reviews
    // the guessed name/unit instead of typing one from scratch. Cleared the
    // first time the record is edited and saved by hand (see
    // updateRawIngredient), which is what "confirming" the draft means; a
    // manually created ingredient never has this set.
    isDraft: { type: Boolean, required: true, default: false },
    // What it is, so the things a store buys that are not part of what it sells
    // (cleaning products, a razor, a receipt roll) can be told apart and left out
    // of stock alerts and CMV. Suggested from the NFe description by keyword
    // (app/lib/ingredient-naming.ts); the owner corrects it by editing.
    kind: {
      type: String,
      enum: ['food', 'packaging', 'cleaning', 'other'],
      required: true,
      default: 'food',
    },
    // Whether this is part of what the store sells or serves, when someone decided
    // it explicitly (the owner, or the owner accepting an AI review). Absent means
    // "follow `kind`" (see isInOperation in app/lib/ingredient-naming.ts). It never
    // removes the ingredient: a mamão bought at the supermarket stays registered,
    // it just stays out of stock alerts and the stock value.
    inOperation: { type: Boolean },
    // Made in the kitchen rather than bought, whether or not its recipe is written yet. With a recipe
    // (`preparation`) it is a preparation anyway; this is for the ones still waiting for theirs.
    isPreparation: { type: Boolean },
    // The main ingredient this one is a variation of ("Bacon" for "Bacon Sadia 1kg"). Only groups the
    // lists: cost, stock and recipes stay per ingredient. The main one is never a variation itself.
    familyOf: { type: Schema.Types.ObjectId, ref: 'RawIngredients' },
    // When the AI last looked at where this belongs in a family; it looks once, so the owner's later
    // choice (including "no family") is not undone.
    familyAiCheckedAt: { type: Date },
    // What the AI said about this ingredient, kept so the screen can show it was
    // analyzed and why. A proposal only: nothing here changes the ingredient.
    aiReview: {
      type: new Schema(
        {
          analyzedAt: { type: Date, required: true },
          model: { type: String, required: true },
          usedByRestaurant: { type: Boolean, required: true },
          kind: { type: String, enum: ['food', 'packaging', 'cleaning', 'other'], required: true },
          cleanName: { type: String },
          aliases: { type: [String], default: [] },
          pack: { type: new Schema({ quantity: Number, unit: String }, { _id: false }) },
          mergeInto: { type: String },
          confidence: { type: String, enum: ['high', 'medium', 'low'], required: true },
          note: { type: String },
          // Whether the Alloy menu was part of the evidence for this call.
          comparedWithMenu: { type: Boolean, default: false },
        },
        { _id: false },
      ),
    },
    // The most recent purchase applied to this ingredient — copied here from the
    // ledger (`stock_movements`) so the table can show and sort by it without a
    // join. Only ever moves forward in time: a backfilled older invoice does not
    // replace a newer one.
    lastPurchase: {
      type: new Schema(
        {
          at: { type: Date },
          supplierCnpj: { type: String },
          supplierName: { type: String },
          invoiceNumber: { type: String },
          quantity: { type: Number },
          // Landed cost per stock unit of that purchase.
          unitCost: { type: Number },
        },
        { _id: false },
      ),
    },
  },
  { timestamps: true, collection: 'raw_ingredients' },
);

// One name per loja — the catalog a manager sees when mapping an NFe line
// or building a recipe.
RawIngredientSchema.index({ storeId: 1, name: 1 }, { unique: true });
// Finding an ingredient by barcode (a receipt line, a scan).
RawIngredientSchema.index({ storeId: 1, barcodes: 1 });

type RawIngredient = InferSchemaType<typeof RawIngredientSchema>;
const RawIngredients =
  (models.RawIngredients as Model<RawIngredient>) ||
  model<RawIngredient>('RawIngredients', RawIngredientSchema);
export default RawIngredients;
