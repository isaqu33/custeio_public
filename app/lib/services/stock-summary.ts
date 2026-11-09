import connectDB from '@/app/lib/connect-db';
import { OPERATIONAL_KINDS } from '@/app/lib/ingredient-naming';
import { getIngredientIdsInRecipes } from '@/app/lib/services/ingredient-usage';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import ProcessedInvoiceDB from '@/app/models/processed-invoices';
import RawIngredientDB from '@/app/models/raw-ingredients';
import SupplierItemMappingDB from '@/app/models/supplier-item-mappings';

export type StockSummary = {
  ingredients: number;
  /** Ingredients auto-created from an NFe that nobody has reviewed yet. */
  drafts: number;
  /** Cleaning products, a razor, a receipt roll: bought by the store but not part of what it sells. */
  nonOperational: number;
  /** Σ currentStock × averageCost over what is part of the operation. A negative
   * balance counts as 0: a discrepancy is not stock the store holds. */
  stockValue: number;
  /** Operational only. Below (or at) its own minimum alert threshold; 0 means "no alert set". */
  lowStock: number;
  /** Operational only. */
  outOfStock: number;
  /** Distinct suppliers among the captured invoices. */
  suppliers: number;
  invoices: number;
  invoicesTotalValue: number;
  /** Issue date of the most recent captured invoice. */
  lastInvoiceAt?: string;
  /** Supplier item → ingredient links (`SupplierItemMappings`). */
  mappedItems: number;
};

type IngredientTotals = {
  ingredients: number;
  drafts: number;
  nonOperational: number;
  stockValue: number;
  lowStock: number;
  outOfStock: number;
};

type InvoiceTotals = { invoices: number; totalValue: number; lastIssuedAt?: Date };

const NO_INGREDIENTS: IngredientTotals = {
  ingredients: 0,
  drafts: 0,
  nonOperational: 0,
  stockValue: 0,
  lowStock: 0,
  outOfStock: 0,
};
const NO_INVOICES: InvoiceTotals = { invoices: 0, totalValue: 0 };

const flag = (condition: Record<string, unknown>) => ({ $sum: { $cond: [condition, 1, 0] } });

/**
 * Store-wide numbers for the Estoque header cards. Computed over the whole
 * store, not the page or the search the table is showing — a filter should not
 * change what the store is worth.
 */
export async function getStockSummaryForStore(storeId: string): Promise<StockSummary> {
  await connectDB();
  const store = toObjectId(storeId);

  // Rows written before `kind` existed have none: they are food.
  // The same rule as `operationState`: an explicit `inOperation` wins; otherwise the kind decides, and
  // an invoice draft nobody reviewed only counts once a recipe uses it.
  const usedIds = toObjectIds([...(await getIngredientIdsInRecipes(storeId))]);
  const operational = {
    $cond: [
      { $eq: [{ $type: '$inOperation' }, 'bool'] },
      '$inOperation',
      {
        $and: [
          { $in: [{ $ifNull: ['$kind', 'food'] }, OPERATIONAL_KINDS] },
          { $or: [{ $ne: ['$isDraft', true] }, { $in: ['$_id', usedIds] }] },
        ],
      },
    ],
  };

  const [ingredientRows, invoiceRows, mappedItems, suppliers] = await Promise.all([
    RawIngredientDB.aggregate<IngredientTotals>([
      { $match: { storeId: store } },
      {
        $group: {
          _id: null,
          ingredients: { $sum: 1 },
          drafts: flag({ $eq: ['$isDraft', true] }),
          nonOperational: flag({ $not: [operational] }),
          stockValue: {
            $sum: {
              $cond: [
                operational,
                { $multiply: [{ $max: [0, '$currentStock'] }, '$averageCost'] },
                0,
              ],
            },
          },
          lowStock: flag({
            $and: [
              operational,
              { $gt: ['$minAlertStock', 0] },
              { $lte: ['$currentStock', '$minAlertStock'] },
            ],
          }),
          outOfStock: flag({ $and: [operational, { $lte: ['$currentStock', 0] }] }),
        },
      },
    ]),
    ProcessedInvoiceDB.aggregate<InvoiceTotals>([
      { $match: { storeId: store, status: 'processed' } },
      {
        $group: {
          _id: null,
          invoices: { $sum: 1 },
          totalValue: { $sum: '$totalValue' },
          lastIssuedAt: { $max: '$issuedAt' },
        },
      },
    ]),
    SupplierItemMappingDB.countDocuments({ storeId: store }),
    // Invoices captured before the supplier was kept have none: they are not counted.
    ProcessedInvoiceDB.distinct('supplierCnpj', { storeId: store, status: 'processed' }),
  ]);

  const ingredients = ingredientRows[0] ?? NO_INGREDIENTS;
  const invoices = invoiceRows[0] ?? NO_INVOICES;
  return {
    ingredients: ingredients.ingredients,
    drafts: ingredients.drafts,
    nonOperational: ingredients.nonOperational,
    stockValue: ingredients.stockValue,
    lowStock: ingredients.lowStock,
    outOfStock: ingredients.outOfStock,
    suppliers: suppliers.length,
    invoices: invoices.invoices,
    invoicesTotalValue: invoices.totalValue,
    lastInvoiceAt: invoices.lastIssuedAt?.toISOString(),
    mappedItems,
  };
}
