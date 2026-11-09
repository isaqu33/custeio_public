import { XMLParser } from 'fast-xml-parser';

// Plain `Error`s and no `./errors`, for the same reason as `nfe-xml.ts`: the Bull
// worker reaches this module and cannot load next-auth.

/** `tpEvento` of a cancellation ("Cancelamento"). */
export const CANCELLATION_EVENT_TYPE = '110111';

export type NfeEvent = {
  accessKey: string; // chNFe — the invoice the event is about
  eventType: string; // tpEvento
  isCancellation: boolean;
  occurredAt?: Date; // dhEvento / dhRegEvento when present
};

// cStat of a processed event (`retEvento`): 135 = registered and linked to the
// NFe, 155 = cancellation registered after the deadline. Anything else was
// rejected, so the invoice is NOT cancelled.
const APPROVED_EVENT_STATUS = new Set(['135', '155']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

type Tree = Record<string, unknown>;

const isTree = (value: unknown): value is Tree =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** First value stored under `key` anywhere in the tree (depth-first). The same
 * data sits at different depths in `resEvento` and `procEventoNFe`. */
function find(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, key);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (!isTree(node)) return undefined;
  if (key in node) return node[key];
  for (const child of Object.values(node)) {
    const hit = find(child, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;

function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Parses a `resEvento` (summary) or `procEventoNFe` (processed event) from
 * `NFeDistribuicaoDFe`. Returns `null` for a rejected event or one that is not
 * about an NFe we can identify; throws only on XML that does not parse at all.
 */
export function parseNfeEvent(xml: string): NfeEvent | null {
  let doc: Tree;
  try {
    doc = parser.parse(xml) as Tree;
  } catch {
    throw new Error('This event is not valid XML.');
  }

  const accessKey = asText(find(doc, 'chNFe'))?.replace(/\D/g, '');
  const eventType = asText(find(doc, 'tpEvento'));
  if (!accessKey || accessKey.length !== 44 || !eventType) return null;

  // Only `procEventoNFe` carries the authority's answer (`retEvento`); a
  // `resEvento` is already the distributed, accepted summary.
  const retEvento = find(doc, 'retEvento');
  if (retEvento !== undefined) {
    const status = asText(find(retEvento, 'cStat'));
    if (!status || !APPROVED_EVENT_STATUS.has(status)) return null;
  }

  return {
    accessKey,
    eventType,
    isCancellation: eventType === CANCELLATION_EVENT_TYPE,
    occurredAt: toDate(asText(find(doc, 'dhRegEvento')) ?? asText(find(doc, 'dhEvento'))),
  };
}
