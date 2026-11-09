import { render, screen } from '@testing-library/react';
import { JobDetailBody } from '@/components/job-detail';
import type { JobDetail } from '@/app/lib/types/jobs';

jest.mock('@/app/lib/i18n/client', () => ({
  useCopy: () => jest.requireActual('@/app/lib/i18n/dictionary').DICTIONARIES['pt-BR'],
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

function job(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    _id: '6a88f78ffb2d5627260ec7ed',
    reference: 'job-abc',
    organizationId: 'org-1',
    kind: 'sefaz.nfe.received',
    type: 'nfe-capture',
    status: 'done',
    createdAt: new Date('2026-08-22T12:00:00Z'),
    logs: [],
    errorLogs: [],
    ...overrides,
  } as JobDetail;
}

// The correlation id is the bridge between a job on screen and its lines in the
// worker log. It is support's entry point when a customer reports a bad
// analysis, so it has to be visible — and absent (not "undefined") on the older
// jobs that never carried one.
describe('JobDetailBody correlation id', () => {
  it('shows the correlation id when the job carries one', () => {
    render(<JobDetailBody detail={job({ correlationId: 'req-123' })} />);
    expect(screen.getByText('req-123')).toBeInTheDocument();
  });

  it('renders nothing in its place when the job has none', () => {
    render(<JobDetailBody detail={job()} />);
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });
});
