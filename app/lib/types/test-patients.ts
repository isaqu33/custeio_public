import type { JobStatus } from '@/app/lib/types/jobs';

// One row in the Chat Tester table. Pure types only (no server imports) so both
// the server service and the client table can share them.
export type TestPatientListItem = {
  _id: string;
  name: string;
  age: number;
  organizationId: string;
  organizationName: string;
  jobId: string;
  webhookReceived: boolean;
  lastSentAt: string | null;
  // Live status of the analysis job this patient last triggered (null when none
  // has been sent yet, or the job document no longer exists).
  jobStatus: JobStatus | null;
  // Convenience flag for the UI: the analysis finished and a transcript exists.
  resultReady: boolean;
};

export type TestPatientsListSuccess = {
  done: true;
  data: TestPatientListItem[];
  total: number;
  page: number;
  totalPages: number;
};

export type OrganizationOption = {
  _id: string;
  name: string;
};
