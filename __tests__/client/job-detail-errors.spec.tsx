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
    status: 'failed',
    createdAt: new Date('2026-08-25T12:00:00Z'),
    logs: [],
    errorLogs: [],
    ...overrides,
  } as JobDetail;
}

// A failed job's error list is read under pressure, and the queue fills it with
// copies: three attempts of the same rejection, plus whatever failed before
// someone fixed it. What matters is that the LAST failure is on top and each
// distinct one is legible.
describe('JobDetailBody error list', () => {
  it('shows the most recent failure first', () => {
    render(
      <JobDetailBody
        detail={job({
          errorLogs: [
            { message: 'older storage failure', timestamp: '2026-08-25T19:35:00Z', attempt: 1 },
            { message: 'newest model failure', timestamp: '2026-08-25T22:05:00Z', attempt: 1 },
          ],
        })}
      />,
    );

    const items = screen.getAllByRole('listitem').map((el) => el.textContent ?? '');
    const newest = items.findIndex((text) => text.includes('newest model failure'));
    const older = items.findIndex((text) => text.includes('older storage failure'));
    expect(newest).toBeGreaterThanOrEqual(0);
    expect(newest).toBeLessThan(older);
  });

  it('collapses the same failure repeated across attempts into one entry', () => {
    render(
      <JobDetailBody
        detail={job({
          errorLogs: [
            { message: 'model gone', attempt: 1, timestamp: '2026-08-25T22:00:00Z' },
            { message: 'model gone', attempt: 2, timestamp: '2026-08-25T22:01:00Z' },
            { message: 'model gone', attempt: 3, timestamp: '2026-08-25T22:02:00Z' },
          ],
        })}
      />,
    );

    expect(screen.getAllByText('model gone')).toHaveLength(1);
    expect(screen.getByText('3×')).toBeInTheDocument();
    expect(screen.getByText(/tentativas 1, 2, 3/)).toBeInTheDocument();
  });

  // Azure stamps every error with its own RequestId and Time, which used to make
  // six copies of one outage look like six separate problems.
  it('collapses provider errors that differ only by their per-call identifiers', () => {
    const azure = (requestId: string, time: string) =>
      `The specified container does not exist.\nRequestId:${requestId}\nTime:${time}`;
    render(
      <JobDetailBody
        detail={job({
          errorLogs: [
            {
              message: azure('f6bd4e8c-001e-001e-11c8-34900a000000', '2026-08-25T19:35:28.390Z'),
              attempt: 1,
              timestamp: '2026-08-25T19:35:28Z',
            },
            {
              message: azure('f6bd5c25-001e-001e-57c8-34900a000000', '2026-08-25T19:35:33.627Z'),
              attempt: 2,
              timestamp: '2026-08-25T19:35:33Z',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('2×')).toBeInTheDocument();
    // The identifiers shown are the newest ones — the copy worth pasting into a
    // provider support ticket.
    expect(screen.getByText(/f6bd5c25-001e-001e-57c8-34900a000000/)).toBeInTheDocument();
    expect(screen.queryByText(/f6bd4e8c-001e-001e-11c8-34900a000000/)).not.toBeInTheDocument();
  });

  it('labels a known failure code in the reader language', () => {
    render(
      <JobDetailBody
        detail={job({
          errorLogs: [{ message: 'HTTP 404', code: 'model_unavailable', attempt: 1 }],
        })}
      />,
    );

    expect(screen.getByText('Modelo indisponível')).toBeInTheDocument();
  });

  it('renders an older entry with no code exactly as before', () => {
    render(<JobDetailBody detail={job({ errorLogs: [{ message: 'plain failure' }] })} />);

    expect(screen.getByText('plain failure')).toBeInTheDocument();
    expect(screen.queryByText('Modelo indisponível')).not.toBeInTheDocument();
  });
});

// The step log repeats the same lines once per attempt, so the same collapsing
// applies — with the newest first, since the Pipeline card already tells the
// story forwards.
describe('JobDetailBody step list', () => {
  it('collapses a run of identical steps and shows the newest first', () => {
    render(
      <JobDetailBody
        detail={job({
          logs: [
            {
              message: 'Worker picked job',
              step: 'worker-fetch',
              timestamp: '2026-08-25T19:00:00Z',
            },
            {
              message: 'Worker picked job',
              step: 'worker-fetch',
              timestamp: '2026-08-25T19:01:00Z',
            },
            {
              message: 'Reused 1 converted image',
              step: 'conversion-skip',
              timestamp: '2026-08-25T19:02:00Z',
            },
          ],
        })}
      />,
    );

    expect(screen.getAllByText('Worker picked job')).toHaveLength(1);
    expect(screen.getByText(/2×/)).toBeInTheDocument();
    // The Pipeline card renders list items too, so look only at the step rows.
    const steps = screen
      .getAllByRole('listitem')
      .map((el) => el.textContent ?? '')
      .filter((text) => text.includes('Worker picked job') || text.includes('Reused 1'));
    expect(steps[0]).toContain('Reused 1 converted image');
  });
});
