/**
 * Fills the Pedidos screen with SAMPLE orders (refs 9101+), already settled, some with lines that had no
 * recipe — so the screen and its "Falta cadastrar" list can be seen before real traffic. Writes only
 * `orders` rows flagged `demo`: no stock movement, no ingredient is touched. `--clear` removes them.
 *
 * Usage:
 *   npx tsx scripts/dev/seed-orders.ts --store <storeId> [--clear]
 */
import '../load-env';
import mongoose from 'mongoose';
import OrderDB from '../../app/models/orders';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

type Mod = [code: string, name: string, price?: number];
const line = (code: string, name: string, price: number, mods: Mod[] = [], quantity = 1) => ({
  externalCode: code,
  name,
  quantity,
  price,
  modifiers: mods.map(([externalCode, modName, modPrice]) => ({
    externalCode,
    name: modName,
    quantity: 1,
    price: modPrice ?? 0,
  })),
});

const missing = {
  barbecue: { kind: 'modifier' as const, codPdv: '147', name: 'Molho Barbecue Extra' },
  fries: { kind: 'modifier' as const, codPdv: '802', name: 'Fritas Combo' },
  adao: { kind: 'product' as const, codPdv: '999', name: 'Adão Burguer + Fritas' },
};

const SAMPLES = [
  {
    minutesAgo: 20,
    status: 'debited',
    cost: 15.5,
    items: [
      line(
        '218',
        'Casa Burguer + Fritas',
        37.9,
        [
          ['575', 'Ao Ponto'],
          ['802', 'Fritas Combo'],
        ],
        2,
      ),
    ],
    incomplete: [],
  },
  {
    minutesAgo: 55,
    status: 'debited',
    cost: 7.5,
    items: [
      line('218', 'Casa Burguer + Fritas', 37.9, [
        ['575', 'Ao Ponto'],
        ['802', 'Fritas Combo'],
        ['147', 'Molho Barbecue Extra', 2],
      ]),
    ],
    incomplete: [missing.fries, missing.barbecue],
  },
  {
    minutesAgo: 90,
    status: 'debited',
    cost: 0,
    items: [line('999', 'Adão Burguer + Fritas', 28.9, [['575', 'Ao Ponto']])],
    incomplete: [missing.adao],
  },
  {
    minutesAgo: 140,
    status: 'debited',
    cost: 9.2,
    items: [
      line('283', 'João Smash', 15, [
        ['806', 'Blend Angus (100g)', 6],
        ['147', 'Molho Barbecue Extra', 2],
      ]),
    ],
    incomplete: [missing.barbecue],
  },
  {
    minutesAgo: 200,
    status: 'pending',
    cost: 0,
    items: [line('265', 'Eva Burguer + Fritas', 33.9, [['574', 'Bem Passado']])],
    incomplete: [],
  },
  {
    minutesAgo: 260,
    status: 'reversed',
    cost: 0,
    items: [line('267', 'Sansão Burguer + Fritas', 47.9, [['518', 'Molho Verde']])],
    incomplete: [],
  },
] as const;

async function main() {
  const storeId = arg('store');
  if (!storeId) throw new Error('--store <storeId> is required.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  await mongoose.connect(process.env.DATABASE_URL);

  const store = new mongoose.Types.ObjectId(storeId);
  const removed = await OrderDB.deleteMany({ storeId: store, demo: true });
  console.log(`removed ${removed.deletedCount} previous sample order(s)`);
  if (process.argv.includes('--clear')) return;

  const now = Date.now();
  let ref = 9100;
  for (const sample of SAMPLES) {
    const items = sample.items.map((item) => ({ ...item, modifiers: [...item.modifiers] }));
    const revenue = items.reduce(
      (sum, i) =>
        sum + i.quantity * (i.price + i.modifiers.reduce((s, m) => s + m.price * m.quantity, 0)),
      0,
    );
    await OrderDB.create({
      storeId: store,
      externalOrderId: String(++ref),
      channel: ref % 3 === 0 ? 'ifood' : 'own',
      placedAt: new Date(now - sample.minutesAgo * 60_000),
      items,
      totalValue: Number(revenue.toFixed(2)),
      calculatedCost: sample.cost,
      profitMargin: revenue > 0 ? Number(((revenue - sample.cost) / revenue).toFixed(4)) : 0,
      stockStatus: sample.status,
      stockRevision: 1,
      incompleteLines: [...sample.incomplete],
      demo: true,
    });
  }
  console.log(`created ${SAMPLES.length} sample order(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
