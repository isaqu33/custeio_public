import { AppFeature } from '@/app/lib/features';
import { parseRouteInput } from '@/app/lib/api-route';
import { requireOrganizationAccess } from '@/app/lib/authorization';
import { csvFileName, csvResponse, toCsv } from '@/app/lib/csv';
import { displayUnit, toDisplayQuantity } from '@/app/lib/quantity-format';
import { NotFoundError, requireAuth } from '@/app/lib/errors';
import { withObservability } from '@/app/lib/observability';
import { logAuditEvent } from '@/app/lib/services/audit-events';
import { getAllRawIngredientsForStore } from '@/app/lib/services/raw-ingredients';
import { getStoreOrganizationId } from '@/app/lib/services/stores';
import { exportRawIngredients } from '@/app/lib/validations';

const HEADER = [
  'Insumo',
  'Tipo',
  'Unidade',
  'Estoque estimado',
  'Custo médio (R$ por unidade)',
  'Valor em estoque (R$)',
  'Alerta mínimo',
  'Última compra',
  'Fornecedor (última compra)',
  'Nota (última compra)',
  'Custo da última compra (R$ por unidade)',
  'Usado em (produtos)',
  'Rascunho',
];

const KIND_LABEL = {
  food: 'Alimento',
  packaging: 'Embalagem',
  cleaning: 'Limpeza',
  other: 'Outro',
} as const;

/** Day of the invoice in São Paulo time (an NFe's date is a Brazilian civil date). */
function invoiceDay(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
}

/**
 * The Estoque table as a spreadsheet: the whole store (or what the search
 * narrows it to), not just the page on screen. A plain GET so the button is a
 * download link; same storeId → organization check as every other route here.
 */
export const GET = withObservability<{}>(AppFeature.RAW_INGREDIENTS_EXPORT_CSV, async (req) => {
  const session = await requireAuth();
  const { storeId, q, kind, usage, supplier, group } = await parseRouteInput(
    req,
    exportRawIngredients,
  );

  const organizationId = await getStoreOrganizationId(storeId);
  if (!organizationId) throw new NotFoundError('Store not found.');
  await requireOrganizationAccess(session, organizationId);

  const ingredients = await getAllRawIngredientsForStore(storeId, {
    q,
    kind,
    usage,
    supplier,
    group,
  });
  // Quantities and costs in the unit people read (kg, L, un), like the screen: the
  // "Unidade" column says which. A cost per gram would print as 0,0025.
  const csv = toCsv(
    HEADER,
    ingredients.map((ingredient) => {
      const { label, factor } = displayUnit(ingredient.unit);
      const last = ingredient.lastPurchase;
      return [
        ingredient.name,
        KIND_LABEL[ingredient.kind],
        label,
        toDisplayQuantity(ingredient.currentStock, ingredient.unit),
        ingredient.averageCost * factor,
        Math.max(0, ingredient.currentStock) * ingredient.averageCost,
        toDisplayQuantity(ingredient.minAlertStock, ingredient.unit),
        invoiceDay(last?.at),
        last?.supplierName,
        last?.invoiceNumber,
        last?.unitCost !== undefined ? last.unitCost * factor : undefined,
        ingredient.usedInProducts ?? 0,
        ingredient.isDraft,
      ];
    }),
  );

  await logAuditEvent({
    organizationId,
    actorUserId: session.user?.id,
    action: 'raw_ingredients.export',
    resourceType: 'store',
    resourceId: storeId,
    source: 'ui',
    metadata: {
      rows: ingredients.length,
      search: q ?? '',
      kind: kind ?? 'all',
      usage: usage ?? 'all',
      supplier: supplier ?? 'all',
    },
  });

  return csvResponse(csv, csvFileName('insumos'));
});
