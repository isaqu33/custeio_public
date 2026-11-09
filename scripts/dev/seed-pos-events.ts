/**
 * Fills "Eventos do PDV" with SAMPLE events so the page can be seen before real traffic:
 * orders shaped like the real Alloy deliveries (docs/features/alloy-api.md), with made-up
 * refs, plus one cancellation (its real event was never captured — this one is invented).
 * Every row is flagged `demo` and shows an "Exemplo" badge; `--clear` removes them.
 *
 * Usage:
 *   npx tsx scripts/dev/seed-pos-events.ts --store <storeId> [--clear]
 */
import '../load-env';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { parseAlloyWebhook } from '../../app/lib/alloy-webhook';
import PosEventDB from '../../app/models/pos-events';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

type Mod = [code: string, name: string, price?: number];
const item = (code: string, name: string, price: number, mods: Mod[] = [], quantity = 1) => ({
  quantidade: quantity,
  valor: price,
  cod_pdv: code,
  nome: name,
  categoria: 'Hambúrguer',
  complementos: mods.map(([cod, nome, valor]) => ({
    quantidade: 1,
    valor: valor ?? 0,
    cod_pdv: cod,
    nome,
  })),
});

function order(ref: number, status: number, itens: ReturnType<typeof item>[], extra = {}) {
  const total = itens.reduce(
    (sum, i) => sum + i.valor + i.complementos.reduce((s, c) => s + c.valor, 0),
    0,
  );
  return {
    ref,
    status,
    created_at: '2026-10-02 19:50:00',
    aceito_em: status >= 2 ? '2026-10-02 19:50:09' : null,
    transito_em: status >= 3 ? '2026-10-02 20:20:00' : null,
    valor_entrega: 3,
    total,
    valor_desconto: 0,
    total_com_descontos: total + 3,
    meio_de_pagamento: 'Pix',
    id_provedor: null,
    itens,
    ...extra,
  };
}

const smash = item('283', 'João Smash', 15, [
  ['575', 'Ao Ponto'],
  ['518', 'Molho Verde'],
  ['806', 'Blend Angus (100g)', 6],
]);
const casa = item('218', 'Casa Burguer + Fritas', 27.9, [
  ['575', 'Ao Ponto'],
  ['192', 'Molho da Casa'],
  ['802', 'Fritas Combo'],
]);
const eva = item('265', 'Eva Burguer + Fritas', 33.9, [
  ['574', 'Bem Passado'],
  ['192', 'Molho da Casa'],
  ['802', 'Fritas Combo'],
]);
const coca = item('114', 'Coca-Cola Original 310ml', 6.5);

const BODY = (evento: string, o: ReturnType<typeof order>, status = false, name = evento) =>
  status
    ? { evento: name, loja_id: 18424, dados_pedido: o, pedido_ref: o.ref, novo_status: o.status }
    : { evento: name, loja_id: 18424, pedido: o };

const SAMPLES: Array<{ minutesAgo: number; body: unknown }> = [
  { minutesAgo: 95, body: BODY('novo_pedido', order(9001, 1, [smash, coca])) },
  { minutesAgo: 95, body: BODY('alteracao_de_status', order(9001, 2, [smash, coca]), true) },
  { minutesAgo: 70, body: BODY('alteracao_de_status', order(9001, 3, [smash, coca]), true) },
  { minutesAgo: 62, body: BODY('novo_pedido', order(9002, 1, [casa])) },
  { minutesAgo: 62, body: BODY('alteracao_de_status', order(9002, 2, [casa]), true) },
  {
    minutesAgo: 41,
    body: BODY(
      'novo_pedido',
      order(9003, 2, [eva, coca], { id_provedor: 1, ifood_dados: { ifood_display_id: '6366' } }),
    ),
  },
  {
    minutesAgo: 25,
    body: BODY(
      'alteracao_de_status',
      order(9004, 2, [casa, coca], { id_provedor: 43, didi_pedido: { pedido_didi_id: '5764' } }),
      true,
    ),
  },
  { minutesAgo: 12, body: BODY('novo_pedido', order(9005, 1, [smash, smash], {})) },
  {
    minutesAgo: 9,
    body: BODY('pedido_cancelado', order(9005, 5, [smash, smash]), true, 'pedido_cancelado'),
  },
  { minutesAgo: 6, body: BODY('alteracao_de_status', order(9002, 4, [casa]), true) },
  { minutesAgo: 3, body: { evento: 'evento_desconhecido', loja_id: 18424 } },
];

async function main() {
  const storeId = arg('store');
  if (!storeId) throw new Error('--store <storeId> is required.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  await mongoose.connect(process.env.DATABASE_URL);

  const store = new mongoose.Types.ObjectId(storeId);
  const removed = await PosEventDB.deleteMany({ storeId: store, demo: true });
  console.log(`removed ${removed.deletedCount} previous sample event(s)`);
  if (process.argv.includes('--clear')) return;

  const now = Date.now();
  let created = 0;
  for (const sample of SAMPLES) {
    const parsed = parseAlloyWebhook(sample.body);
    if (!parsed) continue;
    await PosEventDB.create({
      storeId: store,
      kind: parsed.kind,
      event: parsed.event,
      externalStoreId: parsed.externalStoreId,
      externalOrderId: parsed.externalOrderId,
      statusCode: parsed.statusCode,
      statusLabel: parsed.statusLabel,
      channel: parsed.channel,
      order: parsed.order,
      payload: parsed.payload,
      receivedAt: new Date(now - sample.minutesAgo * 60_000),
      dedupeKey: crypto.randomUUID(),
      demo: true,
    });
    created++;
  }
  console.log(`created ${created} sample event(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
