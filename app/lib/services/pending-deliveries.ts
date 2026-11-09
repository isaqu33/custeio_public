import connectDB from '@/app/lib/connect-db';
import { toObjectId, toObjectIds } from '@/app/lib/mongo-id';
import NfeDocumentDB from '@/app/models/nfe-documents';
import StockMovementDB from '@/app/models/stock-movements';

/** A preview older than this is no longer "the delivery that just arrived". */
const WINDOW_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PendingDelivery = {
  accessKey: string;
  supplierName: string;
  issuedAt: string;
  totalValue: number;
};

/**
 * The goods arrive the day the invoice is issued, but the invoice reaches SEFAZ later: until its
 * items are read, what was sold from that delivery takes the stock below zero. Only the preview
 * (`resNFe`: supplier, date and total, no items) is known meanwhile — enough to say WHY a balance
 * may be wrong, not to fix it. For each ingredient with a negative balance, returns the newest
 * recent preview whose supplier has sold that ingredient before. A hint, never a stock change.
 */
export async function getPendingDeliveries(
  storeId: string,
  negativeIngredientIds: string[],
): Promise<Map<string, PendingDelivery>> {
  const result = new Map<string, PendingDelivery>();
  if (negativeIngredientIds.length === 0) return result;
  await connectDB();
  const store = toObjectId(storeId);

  const previews = await NfeDocumentDB.find({
    storeId: store,
    level: 'summary',
    issuedAt: { $gte: new Date(Date.now() - WINDOW_DAYS * DAY_MS) },
  })
    .sort({ issuedAt: -1 })
    .select('accessKey supplierCnpj supplierName issuedAt totalValue')
    .lean<
      Array<{
        accessKey: string;
        supplierCnpj?: string;
        supplierName?: string;
        issuedAt: Date;
        totalValue: number;
      }>
    >();
  if (previews.length === 0) return result;

  const suppliers = await StockMovementDB.aggregate<{ _id: unknown; cnpjs: string[] }>([
    {
      $match: {
        storeId: store,
        rawIngredientId: { $in: toObjectIds(negativeIngredientIds) },
        type: 'purchase',
        'source.supplierCnpj': { $exists: true, $ne: '' },
      },
    },
    { $group: { _id: '$rawIngredientId', cnpjs: { $addToSet: '$source.supplierCnpj' } } },
  ]);

  for (const row of suppliers) {
    const preview = previews.find(
      (item) => item.supplierCnpj && row.cnpjs.includes(item.supplierCnpj),
    );
    if (!preview) continue;
    result.set(String(row._id), {
      accessKey: preview.accessKey,
      supplierName: preview.supplierName ?? '',
      issuedAt: preview.issuedAt.toISOString(),
      totalValue: Number(preview.totalValue ?? 0),
    });
  }
  return result;
}
