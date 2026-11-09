/**
 * The wire contract for a study upload, shared by the browser and the server.
 *
 * Its own module on purpose: the server-side guards live in
 * `analysis-upload-request.ts`, which pulls in `env` and `next/server`. A client
 * component importing the field name from there would drag both into the browser
 * bundle, so the parts a form legitimately needs sit here instead.
 */

/** Form field carrying the study zip. Same name on both ingestion surfaces. */
export const STUDY_FILE_FIELD = 'exam';

/** Form field naming the organization charged for a portal upload. */
export const STUDY_ORGANIZATION_FIELD = 'organizationId';
