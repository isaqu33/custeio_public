import { type InferSchemaType, type Model, Schema, model, models } from 'mongoose';

// One Loja: one CNPJ, one Alloy (or other PDV) account — 1:1, not N per CNPJ.
// One Organization (Cliente) has many Stores, e.g. a client running two physical
// restaurants under two different CNPJs, each with its own Alloy connection.
// All domain data (RawIngredients, PartnerProducts, Orders, SupplierItemMappings,
// ProcessedInvoices) is scoped by storeId, not organizationId, since stock/menu/
// sales are per physical loja. See docs/features/alloy-api.md and
// docs/features/stores.md.
const StoreSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organizations',
      required: true,
    },
    // The sole uniqueness guard: one CNPJ can only ever back one Loja/Alloy account.
    cnpj: { type: String, required: true, unique: true, trim: true },
    legalName: { type: String, trim: true },
    // Nome fantasia — the loja's primary display name across the UI.
    name: { type: String, required: true, trim: true },
    // Manager's number for WhatsApp (Meta Cloud API) stock/CMV alerts, per loja.
    whatsappNumber: { type: String, trim: true },

    // Mirrors posProviderValue in validations.ts — kept in sync by hand until a
    // second provider is actually wired up.
    provider: {
      type: String,
      enum: ['alloy', 'consumer', 'saipos', 'grandchef', 'anota_ai'],
      required: true,
      default: 'alloy',
    },
    // The provider's own store id (Alloy's `loja_id`). Immutable after creation —
    // identity fields don't change without effectively becoming a different loja.
    externalId: { type: String, required: true, trim: true },
    // The "Token da loja" (Bearer) for this specific store. Write-only: never
    // selected back for a list/client response.
    apiKey: { type: String },
    // SHA-256 of the "Chave" the PDV sends with every webhook delivery (Alloy: Authorization:
    // Bearer <chave>). Only the hash is kept — the app never needs the key back, it just
    // recognises it — and it is how a delivery finds its Store. Not selected by default.
    webhookKeyHash: { type: String, select: false },
    // No Alloy endpoint returns a store logo/photo (checked every catalog/delivery/
    // atendimento/fidelidade endpoint — only item and category-cover images exist).
    // Set by hand in Custeio until/unless Alloy exposes one.
    imageUrl: { type: String, trim: true },
    // Set by a health check hitting the provider API, not by the operator.
    status: {
      type: String,
      enum: ['connected', 'error', 'disconnected'],
      required: true,
      default: 'disconnected',
    },
    lastHealthCheckAt: { type: Date },
    // Populated with the provider's error message on the last failed health check
    // or sync; cleared on the next success.
    lastError: { type: String },
    lastSyncAt: { type: Date },
    // Read straight off Alloy's own `x-ratelimit-*` response headers on the last
    // health check (see app/lib/alloy-client.ts) — not a counter Custeio
    // maintains itself, so it can never drift from what Alloy actually enforces.
    // Absent until the first check ever runs.
    alloyRateLimitLimit: { type: Number },
    alloyRateLimitRemaining: { type: Number },
    // SEFAZ NFeDistribuicaoDFe cursor: the last NSU already processed for this
    // Store's CNPJ (docs/features/sefaz-nfe.md). Persisted after every batch so a
    // second sync — or a job that died halfway — continues instead of re-reading
    // everything. Absent means "never synced" (start from NSU 0).
    sefazUltNsu: { type: String, trim: true },
    // When the last "Sincronizar cardápio" was claimed. Drives the cooldown that
    // keeps an owner from spending the store's 2 Alloy requests/minute on the
    // catalog; claimed atomically at enqueue time, like `sefazLastSyncAt`.
    catalogLastSyncAt: { type: Date },
    // When the last "Buscar na SEFAZ" was claimed. Drives the cooldown that stops
    // an owner mashing the button into the 20/h-per-CNPJ ceiling (a 656 blocks
    // the CNPJ for an hour). Claimed atomically at enqueue time.
    sefazLastSyncAt: { type: Date },
    // Set when a run ends with documents still waiting on SEFAZ (it paused for the
    // hourly quota or hit its per-run batch cap): the moment the resume cron may
    // start the next run, from the saved cursor. Absent = nothing to resume. The
    // cron clears it when it claims the store, so a run that crashes is NOT
    // retried on its own — a persistent failure would otherwise burn the quota.
    //
    // It is also the "next scheduled poll" of a store with `sefazPollEnabled`: a run
    // that ends with nothing left schedules the next check at now + poll interval.
    sefazResumeAt: { type: Date },
    // True while the last run stopped with documents still waiting on SEFAZ. Tells a
    // backlog (always continued by the resume cron) apart from a scheduled poll
    // (only while polling is on).
    sefazBacklog: { type: Boolean, default: false },
    // Periodic "Buscar na SEFAZ" for a store with no backlog. Off until someone turns
    // it on (System > Crons): nothing polls SEFAZ for a store nobody asked about.
    sefazPollEnabled: { type: Boolean, default: false },
    sefazPollIntervalMinutes: { type: Number, default: 60 },
    // Why the last automatic run failed; cleared by the next one that completes.
    sefazLastError: { type: String },
    sefazLastErrorAt: { type: Date },
    // Highest NSU SEFAZ reported when the run stopped; shows how much is left.
    sefazBacklogMaxNsu: { type: String, trim: true },
  },
  { timestamps: true, collection: 'stores' },
);

StoreSchema.index({ organizationId: 1 });

type Store = InferSchemaType<typeof StoreSchema>;
const Stores = (models.Stores as Model<Store>) || model<Store>('Stores', StoreSchema);
export default Stores;
