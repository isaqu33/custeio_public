import { render, screen } from '@testing-library/react';
import { JobDetailBody } from '@/components/job-detail';
import type { JobDetail } from '@/app/lib/types/jobs';

jest.mock('@/app/lib/i18n/client', () => ({
  // English copy on purpose: the assertions below are about what renders, and the
  // pt-BR strings would be the only Portuguese in the spellchecked test tree.
  useCopy: () => jest.requireActual('@/app/lib/i18n/dictionary').DICTIONARIES['en-US'],
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

const NOW = new Date('2026-08-28T12:00:00Z');

function at(offsetMs: number): string {
  return new Date(NOW.getTime() + offsetMs).toISOString();
}

function job(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    _id: '6a88f78ffb2d5627260ec7ed',
    reference: 'job-abc',
    organizationId: 'org-1',
    kind: 'sefaz.nfe.received',
    type: 'nfe-capture',
    status: 'done',
    createdAt: at(-3_600_000),
    updatedAt: at(-60_000),
    logs: [],
    errorLogs: [],
    ...overrides,
  } as JobDetail;
}

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

// The retry button next to a green "done" badge reads as an action the reader is
// expected to take; on a failed job it is the whole point of opening the modal.
describe('retry availability', () => {
  it('is offered on a failed job', () => {
    render(<JobDetailBody detail={job({ status: 'failed' })} />);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('is not offered on a completed job', () => {
    render(<JobDetailBody detail={job({ status: 'done' })} />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
