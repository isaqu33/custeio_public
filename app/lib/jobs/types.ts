export type JobKind =
  | 'users.export.csv'
  | 'organizations.export.csv'
  | 'sefaz.nfe.received'
  | 'pos.catalog.sync'
  | 'pos.order.received'
  | 'pos.orders.reprocess'
  | 'nfe.xml.export'
  | 'ai.ingredients.review';

export type JobConfig = {
  attempts?: number;
  backoff?: {
    type?: 'fixed' | 'exponential';
    delay?: number;
  };
  removeOnComplete?: boolean;
  removeOnFail?: number;
};

export type JobPayloadByKind = {
  'users.export.csv': {
    requestedByUserId: string;
    authorizedOrganizationIds: string[];
  };
  'organizations.export.csv': {
    requestedByUserId: string;
    authorizedOrganizationIds: string[];
  };
  'sefaz.nfe.received': {
    requestedByUserId: string;
    storeId: string;
    // Inline content, not a blob reference — these are small (a single NFe
    // XML or DANFE PDF rarely exceeds a few hundred KB) and the Jobs
    // collection already stores arbitrary payload/result JSON, so there is no
    // separate storage layer to add for this first, manual-upload version.
    // `encoding` is 'text' (the default, an NFe XML) or 'base64' (a DANFE
    // PDF's raw bytes — see app/lib/nfe-pdf.ts).
    // Absent in `mode: 'sefaz'`, where the job fetches the documents itself.
    files?: Array<{ fileName: string; content: string; encoding?: 'text' | 'base64' }>;
    mode?: 'upload' | 'sefaz';
  };
  'pos.catalog.sync': JobPayloadCatalogSync;
  'pos.order.received': JobPayloadOrderReceived;
  'pos.orders.reprocess': JobPayloadOrdersReprocess;
  'nfe.xml.export': JobPayloadNfeXmlExport;
  'ai.ingredients.review': JobPayloadIngredientsReview;
};

// The AI looks at the store's unreviewed ingredients (and compares them with the menu). Slow and
// paid per item, so it runs in the worker; `force` redoes the ones already analyzed.
export type JobPayloadIngredientsReview = {
  /** Absent when the system started it (after a note created new drafts). */
  requestedByUserId?: string;
  storeId: string;
  force?: boolean;
};

// One stored note's XML handed to the person who asked ("baixar XML" on the Notas screen). The file
// itself stays in `nfe_documents`; the job is the record of who took what, and of when.
export type JobPayloadNfeXmlExport = {
  requestedByUserId: string;
  storeId: string;
  accessKey: string;
};

// One PDV webhook delivery already recorded in `pos_events`: the job turns it into an order and, once
// accepted, into a stock debit. The webhook answers Alloy in 3 s, so this runs in the worker.
export type JobPayloadOrderReceived = { storeId: string; eventId: string };

// Settles again every debited order of a store that still has lines without a recipe, against the
// recipes as they are now ("Reprocessar incompletos" on the Pedidos screen).
export type JobPayloadOrdersReprocess = { requestedByUserId: string; storeId: string };

export type JobPayloadCatalogSync = { requestedByUserId: string; storeId: string };

export type JobExecutionContext = {
  jobId: string;
  bullJobId: string | number;
  attempt: number;
  maxAttempts: number;
};
