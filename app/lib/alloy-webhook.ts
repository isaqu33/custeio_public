// Alloy's order webhook, reduced to what Custeio keeps (docs/features/alloy-api.md,
// "Confirmed webhook payload", captured 2026-10-02). Pure: classifies the event and
// builds a SANITIZED view of the order — customer name, phone, CPF, address,
// coordinates and the iFood customer block are deliberately never copied.

export type PosEventKind = 'new_order' | 'status_change' | 'cancellation' | 'unknown';

// Statuses seen so far (4 = delivered, with `entregue_em` set). The cancelled code is not
// captured yet, so anything else falls into 'other' (and a cancellation is recognised by the
// event name until its code is known).
const STATUS_LABELS: Record<number, string> = {
  1: 'new',
  2: 'accepted',
  3: 'in_transit',
  4: 'delivered',
};

// `id_provedor` on the order: null is the store's own channel, 1 is iFood, 43 is 99Food
// (DiDi). The items of a marketplace order all sit in the category "itens integração ifood",
// even the 99Food ones, so the channel must come from this id and not from the category.
const CHANNELS: Record<number, string> = { 1: 'ifood', 43: 'didifood' };

export type SanitizedModifier = {
  quantity: number;
  price: number;
  codPdv: string;
  name: string;
};

export type SanitizedItem = {
  quantity: number;
  price: number;
  codPdv: string;
  name: string;
  category: string;
  modifiers: SanitizedModifier[];
};

export type SanitizedOrder = {
  ref: string;
  status?: number;
  createdAt?: string;
  acceptedAt?: string;
  inTransitAt?: string;
  total: number;
  deliveryFee: number;
  discount: number;
  totalWithDiscounts: number;
  paymentMethod?: string;
  /** The order number on the marketplace, when it came from one. */
  marketplaceOrderId?: string;
  /** The customer collects it (`retirada: 1`); otherwise it is delivered. */
  pickup: boolean;
  /** Typed in at the counter by someone on the team (`criado_por` set), not placed by the customer. */
  createdByStaff: boolean;
  items: SanitizedItem[];
};

const MASK = '[omitido]';

// Whole blocks that are about the customer, and keys that name one wherever they appear.
const PERSONAL_BLOCKS = new Set(['usuario', 'endereco_de_entrega']);
const PERSONAL_KEY =
  /telefone|phone|cpf|cnpj|e-?mail|endereco|address|coordenada|whatsapp|logradouro|bairro|^cep$|nascimento|sobrenome|url_acompanhamento|mensagem_no_cartao|^data_pedido$/i;
// Free-text fields where the marketplace pastes a phone number or locator.
const FREE_TEXT_KEY = /^(obs|obs_adicional|valor_adicional_obs)$/;

/**
 * The delivery as it arrived, for debugging, with everything about the customer masked: the
 * blocks `usuario` and `endereco_de_entrega`, the marketplace customer data (`ifood_dados.data`,
 * `didi_pedido.data_pedido`), any key that names a phone, CPF, address, e-mail or coordinates,
 * and long digit runs in the free-text notes. Every other field is kept as received — a
 * whitelist would hide exactly the new field someone needs to see when debugging. Never
 * mutates its input.
 */
export function redactAlloyPayload(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactAlloyPayload(entry, parentKey));
  if (!isRecord(value)) return value;
  const out: Raw = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      PERSONAL_BLOCKS.has(key) ||
      PERSONAL_KEY.test(key) ||
      (key === 'data' && parentKey === 'ifood_dados')
    ) {
      out[key] = entry === null || entry === undefined ? entry : MASK;
    } else if (FREE_TEXT_KEY.test(key) && typeof entry === 'string') {
      out[key] = entry.replace(/\d{8,}/g, '***');
    } else {
      out[key] = redactAlloyPayload(entry, key);
    }
  }
  return out;
}

export type ParsedAlloyWebhook = {
  kind: PosEventKind;
  event: string;
  externalStoreId?: string;
  externalOrderId?: string;
  statusCode?: number;
  statusLabel?: string;
  channel: string;
  order?: SanitizedOrder;
  /** The body as received with the customer data masked (see {@link redactAlloyPayload}). */
  payload: unknown;
};

type Raw = Record<string, unknown>;
const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asArray = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const optionalText = (value: unknown): string | undefined => text(value) || undefined;

function sanitizeOrder(order: Raw): SanitizedOrder {
  const ifood = isRecord(order.ifood_dados) ? order.ifood_dados : undefined;
  const didi = isRecord(order.didi_pedido) ? order.didi_pedido : undefined;
  return {
    ref: text(order.ref),
    status: order.status === undefined ? undefined : num(order.status),
    createdAt: optionalText(order.created_at),
    acceptedAt: optionalText(order.aceito_em),
    inTransitAt: optionalText(order.transito_em),
    total: num(order.total),
    deliveryFee: num(order.valor_entrega),
    discount: num(order.valor_desconto),
    totalWithDiscounts: num(order.total_com_descontos),
    paymentMethod: optionalText(order.meio_de_pagamento),
    marketplaceOrderId: optionalText(ifood?.ifood_display_id) ?? optionalText(didi?.pedido_didi_id),
    pickup: num(order.retirada) === 1,
    createdByStaff: order.criado_por !== null && order.criado_por !== undefined,
    items: asArray(order.itens).map((item) => ({
      quantity: num(item.quantidade) || 1,
      price: num(item.valor),
      codPdv: text(item.cod_pdv),
      name: text(item.nome),
      category: text(item.categoria),
      modifiers: asArray(item.complementos).map((modifier) => ({
        quantity: num(modifier.quantidade) || 1,
        price: num(modifier.valor),
        codPdv: text(modifier.cod_pdv),
        name: text(modifier.nome),
      })),
    })),
  };
}

/**
 * `null` for the validation ping Alloy sends when a webhook is created (an empty `{}`) and
 * for anything that is not an object: there is nothing to record.
 */
export function parseAlloyWebhook(body: unknown): ParsedAlloyWebhook | null {
  if (!isRecord(body)) return null;
  const event = text(body.evento);
  // "Novo pedido" keeps the order under `pedido`; the status event under `dados_pedido`.
  const rawOrder = isRecord(body.pedido)
    ? body.pedido
    : isRecord(body.dados_pedido)
      ? body.dados_pedido
      : undefined;
  if (!event && !rawOrder) return null;

  const order = rawOrder ? sanitizeOrder(rawOrder) : undefined;
  const statusCode =
    body.novo_status !== undefined
      ? num(body.novo_status)
      : order?.status !== undefined
        ? order.status
        : undefined;
  const providerId = rawOrder?.id_provedor;
  const channel = (typeof providerId === 'number' && CHANNELS[providerId]) || 'own';

  let kind: PosEventKind = 'unknown';
  if (event.toLowerCase().includes('cancel')) kind = 'cancellation';
  else if (event === 'novo_pedido') kind = 'new_order';
  else if (event === 'alteracao_de_status') kind = 'status_change';

  return {
    kind,
    event,
    externalStoreId: optionalText(body.loja_id),
    externalOrderId: optionalText(body.pedido_ref) ?? optionalText(order?.ref),
    statusCode,
    statusLabel: statusCode === undefined ? undefined : (STATUS_LABELS[statusCode] ?? 'other'),
    channel,
    order,
    payload: redactAlloyPayload(body),
  };
}

/** The key Alloy sends: as `Authorization: Bearer <chave>`, and again as `chave` in the body. */
export function extractWebhookKey(authorization: string | null, body: unknown): string | undefined {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;
  return isRecord(body) ? optionalText(body.chave) : undefined;
}
