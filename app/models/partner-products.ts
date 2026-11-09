import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// One line of a recipe: this much of one ingredient, in the ingredient's own unit.
// `_id: false` — a recipe line has no identity of its own outside its parent
// product/modifier, so it doesn't need one.
const RecipeLineSchema = new Schema(
  {
    rawIngredientId: { type: Schema.Types.ObjectId, ref: 'RawIngredients', required: true },
    quantity: { type: Number, required: true },
  },
  { _id: false },
);

// A cardápio add-on (e.g. "+ Bacon") — its own external id from Alloy, its own
// price impact there, and its own micro-recipe debited on top of the product's.
// Alloy copies every complement per item (the same "Ao ponto" has one id under
// each burger), so these are per product, not shared.
const ModifierSchema = new Schema(
  {
    externalId: { type: String, required: true },
    name: { type: String, required: true },
    // The complement group it sits in ("Qual o ponto?"); price and status as Alloy has them.
    group: { type: String, default: '' },
    price: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    // The PDV's code for the complement (Alloy `cod_pdv`): shared across products and
    // carried by the complements of an order, unlike `externalId`.
    codPdv: { type: String, trim: true },
    recipe: { type: [RecipeLineSchema], default: [] },
  },
  { _id: false },
);

// The Alloy cardápio, mirrored locally with the recipe embedded — pos.catalog.sync
// writes name/sellingPrice/modifiers from Alloy's catalog on every sync but never
// touches `recipe`, which only a person sets (Alloy has no concept of a recipe).
// pos.order.received reads this to know what a sold item actually debits.
const PartnerProductSchema = new Schema(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Stores',
      required: true,
      index: true,
    },
    // Alloy's own item id. NOT `cod_pdv`: that one repeats across items.
    externalId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    categoryName: { type: String, default: '', trim: true },
    // Where the item comes from, derived from its category at sync time (alloy-catalog.ts).
    channel: { type: String, enum: ['own', 'ifood', 'didifood'], default: 'own' },
    codPdv: { type: String, trim: true },
    sellingPrice: { type: Number, required: true, default: 0 },
    // Set only while Alloy has the promotion on; margins use it when present.
    promotionalPrice: { type: Number },
    // Sold today: the item, its category and the category's visibility all say
    // so. False also covers an item that disappeared from the menu — kept, not
    // deleted, because recipes and past orders point at it.
    isActive: { type: Boolean, default: true },
    // Stamped on every product a sync sees; anything older was dropped from Alloy.
    lastSeenAt: { type: Date },
    recipe: { type: [RecipeLineSchema], default: [] },
    modifiers: { type: [ModifierSchema], default: [] },
  },
  { timestamps: true, collection: 'partner_products' },
);

// The lookup key for both pos.catalog.sync (upsert by Alloy's own id) and
// pos.order.received (resolve a sold line item back to its recipe).
PartnerProductSchema.index({ storeId: 1, externalId: 1 }, { unique: true });

type PartnerProduct = InferSchemaType<typeof PartnerProductSchema>;
const PartnerProducts =
  (models.PartnerProducts as Model<PartnerProduct>) ||
  model<PartnerProduct>('PartnerProducts', PartnerProductSchema);
export default PartnerProducts;
