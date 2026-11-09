import { z } from 'zod';

import type { JobKind } from '@/app/lib/jobs/types';

export const usersExportCsvPayloadSchema = z.object({
  requestedByUserId: z.string().min(1),
  authorizedOrganizationIds: z.array(z.string().min(1)).min(1),
});

/**
 * Payload schema per job kind — the dispatch table the runner parses with.
 *
 * Keyed by `JobKind`, so a new kind cannot compile until its payload is declared
 * here. The runner branches on kind through this table rather than an if/else
 * chain, so a kind registered in `jobRegistry` and created through the API can
 * never reach the worker without a schema to validate its payload first.
 */
export const sefazNfeReceivedPayloadSchema = z
  .object({
    requestedByUserId: z.string().min(1),
    storeId: z.string().min(1),
    // 'upload': the owner sent XML files. 'sefaz': "Buscar na SEFAZ" — the job
    // pulls documents itself and needs no files.
    mode: z.enum(['upload', 'sefaz']).default('upload'),
    files: z
      .array(
        z.object({
          fileName: z.string().min(1).max(200),
          content: z.string().min(1),
          // 'text' (default) for XML, 'base64' for a DANFE PDF — see nfe-pdf.ts.
          encoding: z.enum(['text', 'base64']).optional(),
        }),
      )
      .max(20)
      .optional(),
  })
  .refine((payload) => payload.mode === 'sefaz' || (payload.files?.length ?? 0) > 0, {
    message: 'files are required in upload mode',
    path: ['files'],
  });

// The whole menu is one Alloy request, so the payload is only who asked and which store.
export const posCatalogSyncPayloadSchema = z.object({
  requestedByUserId: z.string().min(1),
  storeId: z.string().min(1),
});

// A delivery that is already stored: the job only needs to know which one, and for which store.
export const posOrderReceivedPayloadSchema = z.object({
  storeId: z.string().min(1),
  eventId: z.string().min(1),
});

export const posOrdersReprocessPayloadSchema = z.object({
  requestedByUserId: z.string().min(1),
  storeId: z.string().min(1),
});

export const nfeXmlExportPayloadSchema = z.object({
  requestedByUserId: z.string().min(1),
  storeId: z.string().min(1),
  accessKey: z.string().regex(/^\d{44}$/),
});

export const ingredientsReviewPayloadSchema = z.object({
  requestedByUserId: z.string().min(1).optional(),
  storeId: z.string().min(1),
  force: z.boolean().optional(),
});

export const jobPayloadSchemas = {
  'users.export.csv': usersExportCsvPayloadSchema,
  // Scoped the same way: the organizations the requester may see.
  'organizations.export.csv': usersExportCsvPayloadSchema,
  'sefaz.nfe.received': sefazNfeReceivedPayloadSchema,
  'pos.catalog.sync': posCatalogSyncPayloadSchema,
  'pos.order.received': posOrderReceivedPayloadSchema,
  'pos.orders.reprocess': posOrdersReprocessPayloadSchema,
  'nfe.xml.export': nfeXmlExportPayloadSchema,
  'ai.ingredients.review': ingredientsReviewPayloadSchema,
} satisfies Record<JobKind, z.ZodTypeAny>;
