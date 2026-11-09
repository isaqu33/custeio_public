import { cnpj } from 'cpf-cnpj-validator';
import { z } from 'zod';
import { SEFAZ_POLL_MAX_MINUTES, SEFAZ_POLL_MIN_MINUTES } from '@/app/lib/sefaz-sync-gate';

// --- Reusable helpers ---

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');

// Accepts a CNPJ with or without punctuation; rejects strings whose
// 14 digits don't pass the official check-digit algorithm.
export const cnpjString = z
  .string()
  .min(14, 'Invalid CNPJ')
  .max(18, 'Invalid CNPJ')
  .refine((value) => cnpj.isValid(value), 'Invalid CNPJ');

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, z.string().optional());

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const searchQuery = z.object({
  q: z.string().max(200).default(''),
});

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Transforms `q` into regex-safe before using in MongoDB */
export function safeSearchRegex(q: string) {
  return escapeRegex(q.trim());
}

// --- Users ---

/** Shared so localized client-side copy can interpolate the same number. */
export const PASSWORD_MIN_LENGTH = 8;

export const createUser = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
});

// Public: the owner claiming the account a salesperson created for them. Token
// shape is deliberately not checked here — a malformed and an unknown token must
// come back the same way (see `claimInvite` in organization-claim.ts).
export const claimInvite = z.object({
  token: z.string().min(1).max(200),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().trim().email('Invalid email'),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`),
});

export const passwordChange = z
  .object({
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const resetUserPassword = z
  .object({
    userId: objectId,
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const inspectUser = z.object({
  userId: objectId,
});

export const setUserStatus = z.object({
  userId: objectId,
  // `true` deactivates the account (blocks sign-in and cuts open sessions),
  // `false` reactivates it. Explicit rather than a toggle, so a double click
  // or a stale table row cannot flip it the wrong way.
  disabled: z.boolean(),
});

export const updateUser = z.object({
  userId: objectId,
  name: z.string().min(2).max(100).optional(),
  email: z.string().email('Invalid email').optional(),
  // Absent means "leave system access alone". `true` grants the `support`
  // level — the only one this route can ever grant (see
  // `nextSystemLevelForToggle` in the route handler); `false` clears it.
  hasSystemAccess: z.boolean().optional(),
});

export const deleteUser = z.object({
  userId: objectId,
});

// --- Organizations ---

export const createOrganization = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
});

export const updateOrganization = z.object({
  id: objectId,
  name: z.string().min(2).max(100).optional(),
});

export const organizationId = z.object({
  id: objectId,
});

// Manual billing record only — there is no Asaas integration yet (see
// docs/features/organizations.md). `asaasCustomerId` is a free-text field an
// operator fills in by hand once that account exists on Asaas.
export const updateOrganizationBilling = z.object({
  id: objectId,
  billingStatus: z.enum(['up_to_date', 'past_due']).optional(),
  asaasCustomerId: z.preprocess(
    (value) => optionalTrimmedString.parse(value),
    z.string().max(100).optional(),
  ),
});

// Only 'alloy' is actually wired up today; the rest are reserved for planned
// expansion (see `provider` in the Stores model).
export const posProviderValue = z.enum(['alloy', 'consumer', 'saipos', 'grandchef', 'anota_ai']);

export const listStores = z.object({
  organizationId: objectId,
});

// Unlike `listStores` above (System/Support only, one organization mandatory),
// this backs the tenant-facing store picker: `organizationId` is an optional
// narrowing, and its absence means "every organization this session may see".
export const listStoreOptions = z.object({
  organizationId: z.string().optional(),
});

export const createStore = z.object({
  organizationId: objectId,
  cnpj: cnpjString,
  legalName: z.preprocess((value) => optionalTrimmedString.parse(value), z.string().optional()),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  whatsappNumber: z.preprocess(
    (value) => optionalTrimmedString.parse(value),
    z.string().max(20).optional(),
  ),
  provider: posProviderValue,
  externalId: z.string().trim().min(1).max(100),
  apiKey: z.preprocess(
    (value) => optionalTrimmedString.parse(value),
    z.string().max(500).optional(),
  ),
  imageUrl: z.preprocess(
    (value) => optionalTrimmedString.parse(value),
    z.string().url().max(1000).optional(),
  ),
});

export const updateStore = z.object({
  id: objectId,
  legalName: z.preprocess((value) => optionalTrimmedString.parse(value), z.string().optional()),
  name: z.string().min(2).max(100).optional(),
  whatsappNumber: z.preprocess(
    (value) => optionalTrimmedString.parse(value),
    z.string().max(20).optional(),
  ),
  // Write-only: omitted entirely (not just empty) means "leave the stored key
  // as-is" — the current value is never read back to the client.
  apiKey: z.preprocess(
    (value) => optionalTrimmedString.parse(value),
    z.string().max(500).optional(),
  ),
  imageUrl: z.preprocess(
    (value) => optionalTrimmedString.parse(value),
    z.string().url().max(1000).optional(),
  ),
});

export const deleteStore = z.object({
  id: objectId,
});

export const testStoreConnection = z.object({
  id: objectId,
});

// --- Raw Ingredients ---

export const rawIngredientUnit = z.enum(['g', 'ml', 'un']);

export const ingredientKind = z.enum(['food', 'packaging', 'cleaning', 'other']);

export const listRawIngredients = z.object({
  storeId: objectId,
});

// Nicknames, barcodes and the purchase pack of an ingredient (docs: ingredient-identity.ts).
const ingredientIdentity = {
  aliases: z.array(z.string().trim().max(40)).max(10).optional(),
  barcodes: z
    .array(
      z
        .string()
        .trim()
        .regex(/^\d{8,14}$/, 'Barcode must have 8 to 14 digits'),
    )
    .max(5)
    .optional(),
  purchasePack: z
    .object({
      label: z.string().trim().max(40).optional(),
      quantity: z.coerce.number().finite().positive(),
    })
    .nullable()
    .optional(),
};

export const createRawIngredient = z.object({
  storeId: objectId,
  name: z.string().trim().min(1, 'Name is required').max(100),
  unit: rawIngredientUnit,
  kind: ingredientKind.optional(),
  // Made in the kitchen (created from the Preparos page).
  isPreparation: z.boolean().optional(),
  // Manual baseline until the NFe/POS jobs exist to roll these forward —
  // optional because the common case is registering an ingredient before its
  // first purchase is ever processed.
  currentStock: z.coerce.number().finite().optional().default(0),
  averageCost: z.coerce.number().finite().min(0).optional().default(0),
  minAlertStock: z.coerce.number().finite().min(0).optional().default(0),
  ...ingredientIdentity,
});

// Manual-upload capture — see docs/features/sefaz-nfe.md. Capped at 20 files
// per batch (matches the job payload schema) and ~2.8 MB per file — a base64
// PDF is ~4/3 its binary size, so this covers a ~2 MB DANFE, generous for the
// text-based ones this parses (a few hundred KB) while keeping the Jobs
// document — which stores the raw content inline — from growing unbounded.
export const captureNfeInvoices = z.object({
  storeId: objectId,
  files: z
    .array(
      z.object({
        fileName: z.string().min(1).max(200),
        content: z.string().min(1).max(2_800_000),
        // 'text' (the default, omitted by older clients) for an NFe XML;
        // 'base64' for a DANFE PDF's raw bytes — see nfe-pdf.ts and
        // components/capture-nfe-dialog.tsx.
        encoding: z.enum(['text', 'base64']).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const captureNfeStatus = z.object({
  storeId: objectId,
});

// "Buscar na SEFAZ" — the job fetches the documents itself, so only the store is sent.
export const syncNfeSefaz = z.object({
  storeId: objectId,
});

// System > Crons: pause/resume a recurring task or change how often it runs. The
// per-task bounds are checked in the route against the task's definition.
export const updateCronSchema = z
  .object({
    key: z.string().min(1).max(60),
    enabled: z.boolean().optional(),
    intervalMinutes: z
      .number()
      .int()
      .min(1)
      .max(7 * 24 * 60)
      .optional(),
  })
  .refine((v) => v.enabled !== undefined || v.intervalMinutes !== undefined, {
    message: 'Send enabled and/or intervalMinutes.',
  });

// Automatic "Buscar na SEFAZ" for one store.
export const updateStorePollingSchema = z
  .object({
    storeId: objectId,
    enabled: z.boolean().optional(),
    intervalMinutes: z
      .number()
      .int()
      .min(SEFAZ_POLL_MIN_MINUTES)
      .max(SEFAZ_POLL_MAX_MINUTES)
      .optional(),
  })
  .refine((v) => v.enabled !== undefined || v.intervalMinutes !== undefined, {
    message: 'Send enabled and/or intervalMinutes.',
  });

// The purchase history behind one ingredient's balance.
// The stored XML of one note: the store it belongs to and its 44-digit access key.
export const downloadNfeXml = z.object({
  storeId: objectId,
  accessKey: z.string().regex(/^\d{44}$/, 'accessKey must be 44 digits.'),
});

// The owner's answer about a hand-typed purchase an invoice seems to repeat: undo it, or keep both.
export const resolveManualOverlap = z.object({
  storeId: objectId,
  accessKey: z.string().regex(/^\d{44}$/, 'accessKey must be 44 digits.'),
  movementId: objectId,
  action: z.enum(['undo', 'keep']),
});

export const listRawIngredientMovements = z.object({
  ingredientId: objectId,
});

// An inventory count: what the owner found on the shelf. Never negative — a
// negative balance comes from sales outrunning purchases, not from counting.
export const countRawIngredientStock = z.object({
  id: objectId,
  countedStock: z.coerce.number().finite().min(0),
  note: z.string().trim().max(200).optional(),
});

// "Juntar insumos": the ingredients in `sourceIds` are folded into `targetId` (same unit, same store).
export const mergeRawIngredients = z.object({
  targetId: objectId,
  sourceIds: z.array(objectId).min(1).max(20),
  costBasis: z.enum(['average', 'last_purchase']).optional(),
});

// A preparation's recipe: what ONE batch takes and how much it yields, both in the units of the
// ingredients involved. Empty lines clear it.
export const savePreparation = z.object({
  id: objectId,
  yield: z.coerce.number().finite().min(0),
  lines: z
    .array(
      z.object({
        rawIngredientId: objectId,
        quantity: z.coerce.number().finite().positive(),
      }),
    )
    .max(40),
});

// "Registrar lote": the kitchen made `producedQuantity` of a preparation. `requestId` makes a double
// submit count once.
export const registerPreparationBatch = z.object({
  id: objectId,
  producedQuantity: z.coerce.number().finite().positive(),
  requestId: z.string().uuid(),
});

// "Consumo interno": stock that left with no sale (an employee took a meat, a courtesy, a donation).
// Quantities are per STOCK unit (g, ml, un). The person is a label, required when an employee took it.
export const registerInternalUse = z
  .object({
    storeId: objectId,
    requestId: z.string().uuid(),
    reason: z.enum(['employee', 'courtesy', 'donation', 'other']),
    personName: z.string().trim().max(80).optional(),
    note: z.string().trim().max(300).optional(),
    lines: z
      .array(
        z.object({ rawIngredientId: objectId, quantity: z.coerce.number().finite().positive() }),
      )
      .min(1)
      .max(30),
  })
  .refine((value) => value.reason !== 'employee' || Boolean(value.personName), {
    message: 'Inform who took it.',
    path: ['personName'],
  })
  .refine(
    (value) => new Set(value.lines.map((line) => line.rawIngredientId)).size === value.lines.length,
    { message: 'An ingredient is listed twice.', path: ['lines'] },
  );

// "Avaria": stock that spoiled, expired, broke or arrived damaged. Quantities are per STOCK unit.
export const registerWaste = z
  .object({
    storeId: objectId,
    requestId: z.string().uuid(),
    reason: z.enum(['expired', 'breakage', 'receiving_damage', 'other']),
    note: z.string().trim().max(300).optional(),
    lines: z
      .array(
        z.object({ rawIngredientId: objectId, quantity: z.coerce.number().finite().positive() }),
      )
      .min(1)
      .max(30),
  })
  .refine(
    (value) => new Set(value.lines.map((line) => line.rawIngredientId)).size === value.lines.length,
    { message: 'An ingredient is listed twice.', path: ['lines'] },
  );

// "Registrar compra": a purchase typed in by hand. Quantities and costs are per STOCK unit
// (g, ml, un) — the dialog converts from what the owner reads (kg, L, un).
export const registerManualPurchase = z.object({
  storeId: objectId,
  requestId: z.string().uuid(),
  supplierName: z.string().trim().min(1).max(120),
  occurredAt: z.coerce.date(),
  note: z.string().trim().max(200).optional(),
  lines: z
    .array(
      z.object({
        rawIngredientId: objectId,
        quantity: z.coerce.number().finite().positive(),
        unitCost: z.coerce.number().finite().min(0),
      }),
    )
    .min(1)
    .max(60),
});

// "Reprocessar": one order (by its PDV reference) settled again now, or — without a reference — every
// incomplete order of the store, as a background job.
export const reprocessOrders = z.object({
  storeId: objectId,
  externalOrderId: z.string().trim().min(1).max(40).optional(),
});

// "Fora / na operação" in bulk: the picked ids, or every ingredient of a list (the table's filters).
export const setOperationBulk = z
  .object({
    storeId: objectId,
    inOperation: z.boolean(),
    ids: z.array(objectId).min(1).max(500).optional(),
    filters: z
      .object({
        q: z.string().trim().max(100).optional(),
        kind: z.enum(['all', 'food', 'packaging', 'cleaning', 'other']).optional(),
        usage: z.enum(['all', 'used', 'unused']).optional(),
        supplier: z.string().trim().max(20).optional(),
        group: z.enum(['in', 'out', 'review']).optional(),
        variants: z.enum(['hide', 'show']).optional(),
        family: objectId.optional(),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.ids) !== Boolean(value.filters), {
    message: 'Send either ids or filters.',
  });

export const dismissDuplicate = z.object({ id: objectId });

export const reviewIngredients = z.object({
  storeId: objectId,
  force: z.boolean().optional(),
});

export const updateRawIngredient = z.object({
  id: objectId,
  name: z.string().trim().min(1).max(100).optional(),
  unit: rawIngredientUnit.optional(),
  kind: ingredientKind.optional(),
  // The owner's call on whether it is part of the operation (overrides the kind).
  inOperation: z.boolean().optional(),
  // Made in the kitchen: moves it to the Preparos page.
  isPreparation: z.boolean().optional(),
  // The main ingredient it is a variation of; null takes it out of the family.
  familyOf: objectId.nullable().optional(),
  // Grams per ml (0,5 to 3 covers anything in a kitchen); null takes it away.
  gramsPerMl: z.coerce.number().finite().min(0.1).max(5).nullable().optional(),
  costBasis: z.enum(['average', 'last_purchase']).optional(),
  // Manual adjustment. Not min(0): a negative balance is a legitimate
  // discrepancy signal (see docs/features/stock-and-cmv.md), not invalid input.
  currentStock: z.coerce.number().finite().optional(),
  averageCost: z.coerce.number().finite().min(0).optional(),
  minAlertStock: z.coerce.number().finite().min(0).optional(),
  ...ingredientIdentity,
});

// --- Products (the Alloy menu mirrored per store) ---

export const productStatusFilter = z.enum(['active', 'inactive', 'all']);

export const syncCatalog = z.object({
  storeId: objectId,
});

export const catalogSyncStatus = z.object({
  storeId: objectId,
});

const recipeLines = z
  .array(
    z.object({
      rawIngredientId: objectId,
      quantity: z.coerce.number().finite().positive(),
    }),
  )
  .max(60);

// A complement's recipe is saved under its PDV code (shared by every product that offers
// it), so the request names the store and the code rather than a catalog row.
export const updateModifierRecipe = z.object({
  storeId: objectId,
  codPdv: z.string().trim().min(1).max(100),
  recipe: recipeLines,
});

export const updateProductRecipe = z.object({
  id: objectId,
  // Every line is "this much of one ingredient, in the ingredient's own unit".
  recipe: z
    .array(
      z.object({
        rawIngredientId: objectId,
        quantity: z.coerce.number().finite().positive(),
      }),
    )
    .max(60),
});

// The CSV exports mirror the table: the same store, and the same search/status
// the user is looking at.
export const exportProducts = z.object({
  storeId: objectId,
  q: z.string().trim().max(100).optional(),
  status: productStatusFilter.optional(),
});

export const exportRawIngredients = z.object({
  storeId: objectId,
  q: z.string().trim().max(100).optional(),
  kind: z.enum(['all', 'food', 'packaging', 'cleaning', 'other']).optional(),
  usage: z.enum(['all', 'used', 'unused']).optional(),
  supplier: z.string().trim().max(20).optional(),
  group: z.enum(['in', 'out', 'review']).optional(),
});

export const adminAction = z.object({
  organizationId: objectId,
  userId: objectId,
});

export const getJobs = pagination.extend({
  jobId: z.string().min(1, 'jobId is required'),
});

export const getOrganizationsPage = pagination;
