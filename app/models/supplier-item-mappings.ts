import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// The De/Para: translates one supplier's line on one NFe into a stock movement.
// sefaz.nfe.received looks up (storeId, supplierCnpj, supplierItemCode) for
// every line it reads; a miss is what triggers Tier 1 auto-drafting instead of
// silently dropping the line — see app/lib/services/nfe-capture.ts and
// docs/features/sefaz-nfe.md. No AI/LLM involved for now (that was Tier 4,
// explicitly deferred).
const SupplierItemMappingSchema = new Schema(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Stores',
      required: true,
      index: true,
    },
    // Digits only, no formatting — the NFe XML's own `emit/CNPJ` is unformatted,
    // so storing it the same way keeps the lookup a plain equality match.
    supplierCnpj: { type: String, required: true, trim: true },
    // The `cProd` from the NFe's `det/prod` — the supplier's own SKU, not ours.
    supplierItemCode: { type: String, required: true, trim: true },
    rawIngredientId: { type: Schema.Types.ObjectId, ref: 'RawIngredients', required: true },
    // Multiplies the NFe line's commercial quantity into RawIngredient.unit — e.g.
    // 1 fardo (the invoice's `uCom`) -> 12 (the stock unit's count). Never 0: a
    // mapping that resolves to no stock movement is a data-entry mistake, not a
    // valid "ignore this line" — CLAUDE.md scopes that to worker-side logic.
    conversionFactor: { type: Number, required: true, default: 1 },
  },
  { timestamps: true, collection: 'supplier_item_mappings' },
);

// The exact lookup key the ingestion worker queries on for every NFe line, and the
// natural uniqueness constraint: one supplier's SKU maps to exactly one ingredient.
SupplierItemMappingSchema.index(
  { storeId: 1, supplierCnpj: 1, supplierItemCode: 1 },
  { unique: true },
);

type SupplierItemMapping = InferSchemaType<typeof SupplierItemMappingSchema>;
const SupplierItemMappings =
  (models.SupplierItemMappings as Model<SupplierItemMapping>) ||
  model<SupplierItemMapping>('SupplierItemMappings', SupplierItemMappingSchema);
export default SupplierItemMappings;
