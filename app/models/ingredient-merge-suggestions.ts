import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// "These ingredients look like the same thing" — what the AI found among a store's ingredients, kept
// until the owner merges them (the suggestion then disappears on its own: its ingredients are gone) or
// dismisses it (kept as `dismissed`, so the next analysis does not ask again). Never applied by itself.
const IngredientMergeSuggestionSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Stores', required: true, index: true },
    // The ingredient that stays, and the ones folded into it.
    keepId: { type: Schema.Types.ObjectId, ref: 'RawIngredients', required: true },
    mergeIds: { type: [Schema.Types.ObjectId], ref: 'RawIngredients', required: true },
    // The sorted ids of the whole group: the same group is never stored twice.
    signature: { type: String, required: true },
    confidence: { type: String, enum: ['high', 'medium'], required: true },
    reason: { type: String, default: '' },
    // Set when it cannot be merged as is (different units, or "un" packs of different sizes).
    convertFirst: { type: String },
    status: { type: String, enum: ['pending', 'dismissed'], default: 'pending' },
    model: { type: String },
  },
  { timestamps: true, collection: 'ingredient_merge_suggestions' },
);

IngredientMergeSuggestionSchema.index({ storeId: 1, signature: 1 }, { unique: true });

type IngredientMergeSuggestion = InferSchemaType<typeof IngredientMergeSuggestionSchema>;
const IngredientMergeSuggestions =
  (models.IngredientMergeSuggestions as Model<IngredientMergeSuggestion>) ||
  model<IngredientMergeSuggestion>('IngredientMergeSuggestions', IngredientMergeSuggestionSchema);
export default IngredientMergeSuggestions;
