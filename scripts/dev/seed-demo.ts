/**
 * Fills an EMPTY local database with a fictional restaurant ("Casa Burguer") so the app can be
 * explored — and screenshotted — without any real data.
 *
 * It goes through the same services the product uses, so what you see is what the product computes:
 *
 *   purchases ──registerManualPurchase──▶ stock + average cost
 *   sales     ──processPosEvent─────────▶ order, recipe debit, cost and margin
 *
 * Usage:
 *   npm run demo:data            # dry run: says what it would do
 *   npm run demo:data -- --confirm
 *
 * Safety: refuses to run in production, and refuses when the database already holds an organization
 * that is not the demo one — it must never mix fictional rows into real data.
 *
 * Logins (local demo only, never reuse these anywhere else):
 *   dono@custeio.example  / Demo-Custeio-2026!   restaurant owner (one organization)
 *   demo@custeio.example  / Demo-Custeio-2026!   platform admin (System menu)
 */
import '../load-env';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import connectDB from '../../app/lib/connect-db';
import { processPosEvent } from '../../app/lib/services/order-stock';
import { registerManualPurchase } from '../../app/lib/services/manual-purchase';
import OrganizationDB from '../../app/models/organizations';
import PartnerProductDB from '../../app/models/partner-products';
import PosEventDB from '../../app/models/pos-events';
import ProductRecipeDB from '../../app/models/product-recipes';
import RawIngredientDB from '../../app/models/raw-ingredients';
import StoreDB from '../../app/models/stores';
import UserDB from '../../app/models/users';

const ORG_NAME = 'Casa Burguer (demo)';
const PASSWORD = 'Demo-Custeio-2026!';
const DAYS = 14;

// Small deterministic PRNG: the same demo every time, so screenshots are reproducible.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261109);
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const pad = (n: number) => String(n).padStart(2, '0');
const localStamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

type Unit = 'g' | 'ml' | 'un';
// name, unit, unit cost (R$ per g/ml/un), quantity bought on day 0 (own unit)
const INGREDIENTS: Array<[string, Unit, number, number]> = [
  ['Blend bovino 150 g', 'g', 0.042, 260_000],
  ['Pão brioche', 'un', 1.6, 1_700],
  ['Queijo cheddar', 'g', 0.045, 40_000],
  ['Bacon', 'g', 0.055, 18_000],
  ['Alface', 'g', 0.012, 12_000],
  ['Tomate', 'g', 0.009, 14_000],
  ['Maionese da casa', 'g', 0.02, 14_000],
  ['Batata congelada', 'g', 0.018, 110_000],
  ['Óleo de soja', 'ml', 0.009, 24_000],
  ['Refrigerante lata', 'un', 3.2, 700],
];

// code, name, price, recipe [ingredient name, quantity]
const PRODUCTS: Array<[string, string, number, Array<[string, number]>]> = [
  [
    '101',
    'X-Burguer',
    28,
    [
      ['Blend bovino 150 g', 150],
      ['Pão brioche', 1],
      ['Queijo cheddar', 20],
      ['Alface', 15],
      ['Tomate', 20],
      ['Maionese da casa', 15],
    ],
  ],
  [
    '102',
    'X-Bacon',
    34,
    [
      ['Blend bovino 150 g', 150],
      ['Pão brioche', 1],
      ['Queijo cheddar', 20],
      ['Bacon', 30],
      ['Alface', 15],
      ['Maionese da casa', 15],
    ],
  ],
  [
    '103',
    'Smash Duplo',
    38,
    [
      ['Blend bovino 150 g', 200],
      ['Pão brioche', 1],
      ['Queijo cheddar', 40],
      ['Maionese da casa', 15],
    ],
  ],
  [
    '104',
    'Batata Frita',
    18,
    [
      ['Batata congelada', 250],
      ['Óleo de soja', 20],
    ],
  ],
  ['105', 'Refrigerante lata', 7, [['Refrigerante lata', 1]]],
  // Deliberately WITHOUT a recipe: shows how an incomplete sale is flagged, never hidden.
  ['199', 'Combo Família', 89, []],
];

const WEIGHTS: Record<string, number> = {
  '101': 30,
  '102': 26,
  '103': 18,
  '104': 34,
  '105': 30,
  '199': 2,
};

function pickProduct(): (typeof PRODUCTS)[number] {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (const product of PRODUCTS) {
    roll -= WEIGHTS[product[0]] ?? 0;
    if (roll <= 0) return product;
  }
  return PRODUCTS[0]!;
}

async function main() {
  const confirm = process.argv.includes('--confirm');

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data with NODE_ENV=production.');
  }

  await connectDB();

  const others = await OrganizationDB.countDocuments({ name: { $ne: ORG_NAME } });
  if (others > 0) {
    throw new Error(
      `The database already has ${others} organization(s) that are not the demo one. ` +
        'Point DATABASE_URL at an empty database: demo rows must never mix with real data.',
    );
  }
  if (await OrganizationDB.exists({ name: ORG_NAME })) {
    console.log('Demo organization already exists — nothing to do.');
    return;
  }

  console.log(
    `Will create: 1 organization, 1 store, 2 users, ${INGREDIENTS.length} ingredients, ` +
      `${PRODUCTS.length} products, 2 purchase rounds and ~${DAYS * 25} orders over ${DAYS} days.`,
  );
  if (!confirm) {
    console.log('Dry run. Add --confirm to write.');
    return;
  }

  const organization = await OrganizationDB.create({ name: ORG_NAME, status: 'active' });
  const store = await StoreDB.create({
    organizationId: organization._id,
    cnpj: '11.111.111/0001-91',
    legalName: 'Casa Burguer Demonstração LTDA',
    name: 'Casa Burguer',
    provider: 'alloy',
    externalId: 'demo-001',
    status: 'disconnected',
  });
  const storeId = String(store._id);

  const hash = await bcrypt.hash(PASSWORD, 10);
  await UserDB.create([
    {
      name: 'Dona Casa (demo)',
      email: 'dono@custeio.example',
      password: hash,
      organizationIds: [organization._id],
      mustChangePassword: false,
      language: 'pt-BR',
    },
    {
      name: 'Admin da plataforma (demo)',
      email: 'demo@custeio.example',
      password: hash,
      organizationIds: [],
      systemLevel: ['system'],
      mustChangePassword: false,
      language: 'pt-BR',
    },
  ]);

  // Ingredients start empty; purchases below fill them the way the product does.
  const ids = new Map<string, string>();
  for (const [name, unit] of INGREDIENTS) {
    const doc = await RawIngredientDB.create({
      storeId: store._id,
      name,
      unit,
      currentStock: 0,
      averageCost: 0,
    });
    ids.set(name, String(doc._id));
  }

  // Two purchase rounds: the second one is pricier, so average cost and price history have a story.
  const now = new Date();
  const daysAgo = (n: number, hour = 9) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  await registerManualPurchase({
    storeId,
    requestId: 'demo-purchase-1',
    supplierName: 'Frigorífico Boa Carne (demo)',
    occurredAt: daysAgo(DAYS),
    lines: INGREDIENTS.map(([name, , cost, qty]) => ({
      rawIngredientId: ids.get(name)!,
      quantity: Math.round(qty * 0.6),
      unitCost: cost,
    })),
  });
  await registerManualPurchase({
    storeId,
    requestId: 'demo-purchase-2',
    supplierName: 'Frigorífico Boa Carne (demo)',
    occurredAt: daysAgo(Math.floor(DAYS / 2)),
    lines: INGREDIENTS.map(([name, , cost, qty]) => ({
      rawIngredientId: ids.get(name)!,
      quantity: Math.round(qty * 0.4),
      unitCost: Number((cost * (name.startsWith('Blend') ? 1.12 : 1.03)).toFixed(4)),
    })),
  });

  // Catalog + shared recipes (by PDV code, like the real catalog sync + recipe editor).
  for (const [code, name, price, recipe] of PRODUCTS) {
    await PartnerProductDB.create({
      storeId: store._id,
      externalId: `demo-item-${code}`,
      name,
      codPdv: code,
      sellingPrice: price,
      categoryName: code === '104' || code === '105' ? 'Acompanhamentos' : 'Hambúrgueres',
      isActive: true,
      lastSeenAt: now,
    });
    if (recipe.length > 0) {
      await ProductRecipeDB.create({
        storeId: store._id,
        kind: 'product',
        codPdv: code,
        recipe: recipe.map(([ingredient, quantity]) => ({
          rawIngredientId: new mongoose.Types.ObjectId(ids.get(ingredient)!),
          quantity,
        })),
      });
    }
  }

  // Sales: each one is a PDV event that goes through the real order → stock → cost pipeline.
  let orderNumber = 5000;
  let processed = 0;
  let cancelled = 0;
  for (let day = DAYS; day >= 0; day--) {
    const date = daysAgo(day, 0);
    const weekend = date.getDay() === 5 || date.getDay() === 6 || date.getDay() === 0;
    const orders = between(weekend ? 26 : 16, weekend ? 38 : 24);
    for (let i = 0; i < orders; i++) {
      const placed = new Date(date);
      placed.setHours(between(11, 22), between(0, 59), 0, 0);
      if (placed > now) continue;
      const items = Array.from({ length: between(1, 3) }, () => {
        const [code, name, price] = pickProduct();
        return { codPdv: code, name, price, quantity: random() > 0.85 ? 2 : 1 };
      });
      orderNumber += 1;
      const ref = String(orderNumber);
      const base = {
        storeId: store._id,
        provider: 'alloy',
        externalOrderId: ref,
        channel: random() > 0.75 ? 'ifood' : 'own',
        demo: true,
        order: { createdAt: localStamp(placed), items },
        receivedAt: placed,
      };
      const accepted = await PosEventDB.create({
        ...base,
        kind: 'new_order',
        event: 'novo_pedido',
        statusCode: 2,
        dedupeKey: `demo-${ref}-accepted`,
      });
      await processPosEvent(String(accepted._id));
      processed++;
      // ~4% are cancelled afterwards: the stock goes back.
      if (random() < 0.04) {
        const cancel = await PosEventDB.create({
          ...base,
          kind: 'cancellation',
          event: 'alteracao_de_status',
          statusCode: 5,
          dedupeKey: `demo-${ref}-cancelled`,
        });
        await processPosEvent(String(cancel._id));
        cancelled++;
      }
    }
  }

  console.log(`Done: ${processed} orders (${cancelled} cancelled) over ${DAYS + 1} days.`);
  console.log('Login: dono@custeio.example / ' + PASSWORD);
  console.log('Admin: demo@custeio.example / ' + PASSWORD);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
