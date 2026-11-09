import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// The "ficha técnica" of something the PDV sells, keyed by the PDV's own code
// (Alloy's `cod_pdv`) instead of by a catalog row. The catalog repeats the same
// product once per channel (the iFood copies) and the same complement once per
// product, all with the same `cod_pdv` — and an order arrives carrying only that
// code — so one recipe per (store, code) serves every copy. `pos.catalog.sync`
// never touches this collection, which is what keeps a recipe across re-syncs.
const RecipeLineSchema = new Schema(
  {
    rawIngredientId: { type: Schema.Types.ObjectId, ref: 'RawIngredients', required: true },
    // In the ingredient's own unit (g, ml or un).
    quantity: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ProductRecipeSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Stores', required: true, index: true },
    // A product (a line sold) or a modifier (an add-on / complement of a line).
    kind: { type: String, enum: ['product', 'modifier'], required: true },
    codPdv: { type: String, required: true, trim: true },
    recipe: { type: [RecipeLineSchema], default: [] },
  },
  { timestamps: true, collection: 'product_recipes' },
);

ProductRecipeSchema.index({ storeId: 1, kind: 1, codPdv: 1 }, { unique: true });

type ProductRecipe = InferSchemaType<typeof ProductRecipeSchema>;
const ProductRecipes =
  (models.ProductRecipes as Model<ProductRecipe>) ||
  model<ProductRecipe>('ProductRecipes', ProductRecipeSchema);
export default ProductRecipes;
