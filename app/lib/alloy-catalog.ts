// Alloy's `GET /api/catalog/getproducts`, reduced to what KairosFlow keeps
// (docs/features/alloy-api.md). The payload's `produtos` are actually
// CATEGORIES; each carries its `items`, and each item its complement groups
// (`categorias_de_complemento`) and complements — the whole menu in one call,
// which is what lets `pos.catalog.sync` fit the 2 requests/minute store quota.
//
// Shape verified against a real store on 2026-09-26. Prices arrive as strings
// ("59.50"), booleans as 0/1, and `cod_pdv` is NOT unique (several items share
// one, e.g. the iFood copies), so an item's own `id` is the key.

export type CatalogModifier = {
  externalId: string;
  name: string;
  /** The complement group it belongs to ("Qual o molho?"). */
  group: string;
  price: number;
  isActive: boolean;
  /**
   * The PDV's own code for the complement (`cod_pdv`). Unlike `externalId`, which is
   * copied per item, it is shared across products ("Ao Ponto" is the same code under
   * every burger) and is what an order's complement carries — the key a complement
   * recipe is looked up by.
   */
  codPdv?: string;
};

/** Where an item comes from: the store's own menu, or one Alloy created for a marketplace. */
export type ProductChannel = 'own' | 'ifood' | 'didifood';

/**
 * Alloy has no per-item "platform" field. For items a marketplace sent that the menu did
 * not know, it creates the categories "itens integração ifood" / "itens integração
 * didifood" itself, so the category name is where the origin shows (checked 2026-10-02).
 */
export function channelOfCategory(categoryName: string): ProductChannel {
  const name = categoryName.toLowerCase();
  if (name.includes('didi')) return 'didifood';
  if (name.includes('ifood')) return 'ifood';
  return 'own';
}

export type CatalogProduct = {
  externalId: string;
  name: string;
  categoryName: string;
  channel: ProductChannel;
  codPdv?: string;
  price: number;
  /** Only while Alloy has the promotion switched on. */
  promotionalPrice?: number;
  /** Sold today: the item, its category and the category's visibility all say so. */
  isActive: boolean;
  modifiers: CatalogModifier[];
};

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asArray = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter(isRecord) : []);

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function money(value: unknown): number {
  const parsed = Number(text(value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const flag = (value: unknown) => Number(value) === 1 || value === true;

function parseModifiers(item: Raw): CatalogModifier[] {
  return asArray(item.categorias_de_complemento).flatMap((group) =>
    asArray(group.complementos).map((complement) => ({
      externalId: text(complement.id),
      name: text(complement.nome),
      group: text(group.nome),
      price: money(complement.preco),
      isActive: flag(group.status) && flag(complement.status),
      ...(text(complement.cod_pdv) && { codPdv: text(complement.cod_pdv) }),
    })),
  );
}

/**
 * Flattens the categories → items tree into products. Anything without an id
 * or a name is skipped rather than guessed at, and an item listed twice keeps
 * its first appearance.
 */
export function parseAlloyCatalog(body: unknown): CatalogProduct[] {
  const categories = isRecord(body) ? asArray(body.produtos) : [];
  const products = new Map<string, CatalogProduct>();

  for (const category of categories) {
    const categoryVisible = flag(category.status) && !flag(category.is_hidden);
    for (const item of asArray(category.items)) {
      const externalId = text(item.id);
      const name = text(item.nome);
      if (!externalId || !name || products.has(externalId)) continue;

      const promotional = money(item.preco_promocional);
      products.set(externalId, {
        externalId,
        name,
        categoryName: text(category.nome),
        channel: channelOfCategory(text(category.nome)),
        codPdv: text(item.cod_pdv) || undefined,
        price: money(item.preco),
        promotionalPrice: flag(item.status_promocao) && promotional > 0 ? promotional : undefined,
        isActive: categoryVisible && flag(item.status),
        modifiers: parseModifiers(item).filter((modifier) => modifier.externalId && modifier.name),
      });
    }
  }
  return [...products.values()];
}
