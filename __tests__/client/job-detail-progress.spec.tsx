import { render, screen, within } from '@testing-library/react';
import { JobDetailBody } from '@/components/job-detail';
import type { JobDetail, JobMetrics } from '@/app/lib/types/jobs';

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

function metrics(overrides: Partial<JobMetrics> = {}): JobMetrics {
  return {
    msPerImage: 108,
    msPerBatch: 75_000,
    synthesisMs: 40_000,
    failedImages: [],
    failedImagesTotal: 0,
    pipeline: {
      batchSize: 20,
      leafConcurrency: 4,
      synthesisFanout: 5,
      maxInstances: 5_000,
    },
    ...overrides,
  };
}

function job(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    _id: '6a88f78ffb2d5627260ec7ed',
    examId: 'study-abc',
    organizationId: 'org-1',
    kind: 'analysis.process.received',
    type: 'RayPilot',
    status: 'done',
    createdAt: at(-3_600_000),
    updatedAt: at(-60_000),
    logs: [],
    errorLogs: [],
    messages: [],
    metrics: metrics(),
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

describe('progress and timing', () => {
  it('shows a percentage and what is left while the analysis runs', () => {
    render(
      <JobDetailBody
        detail={job({
          status: 'running',
          progress: {
            phase: 'analyzing',
            conversionComplete: true,
            instanceCount: 390,
            batchesTotal: 20,
            batchesDone: 10,
            timings: {
              startedAt: at(-1_240_000),
              converting: { startedAt: at(-1_240_000), endedAt: at(-1_200_000) },
              analyzing: { startedAt: at(-1_200_000) },
            },
          },
        })}
      />,
    );

    // 10 of 20 batches in 20 minutes → about 20 minutes still to go.
    expect(screen.getByText(/left/i)).toBeInTheDocument();
    // Conversion is done and half the batches have landed: a shade under half
    // the projected run, since the report is still ahead of it.
    expect(screen.getByText('Overall').parentElement).toHaveTextContent('50%');
  });

  it('reports a streaming conversion as unmeasurable instead of inventing a fraction', () => {
    render(
      <JobDetailBody
        detail={job({
          status: 'running',
          progress: {
            phase: 'converting',
            convertedFiles: 120,
            timings: { startedAt: at(-60_000), converting: { startedAt: at(-60_000) } },
          },
        })}
      />,
    );

    expect(screen.getByText(/120 images so far/i)).toBeInTheDocument();
    expect(screen.queryByText(/left/i)).not.toBeInTheDocument();
  });

  it('breaks the finished run down by stage', () => {
    render(
      <JobDetailBody
        detail={job({
          progress: {
            phase: 'done',
            conversionComplete: true,
            instanceCount: 390,
            batchesTotal: 20,
            batchesDone: 20,
            timings: {
              startedAt: at(-1_800_000),
              finishedAt: at(-60_000),
              converting: { startedAt: at(-1_800_000), endedAt: at(-1_740_000) },
              analyzing: { startedAt: at(-1_740_000), endedAt: at(-120_000) },
              synthesizing: { startedAt: at(-120_000), endedAt: at(-60_000) },
            },
          },
        })}
      />,
    );

    const card = screen.getByText('Time per stage').closest('div[class*="rounded"]');
    expect(card).not.toBeNull();
    // Analysis took 27 of the 29 accounted minutes — the share is the point.
    expect(within(card as HTMLElement).getByText('93%')).toBeInTheDocument();
  });
});

describe('projection', () => {
  it('prices bigger studies from the measured pace and flags the ones that are refused', () => {
    render(
      <JobDetailBody
        detail={job({ progress: { instanceCount: 390, batchesTotal: 20, batchesDone: 20 } })}
      />,
    );

    expect(screen.getByText(/what a bigger study would take/i)).toBeInTheDocument();
    expect(screen.getByText(/this study/i)).toBeInTheDocument();
    expect(screen.getByText(/own measured pace/i)).toBeInTheDocument();
    expect(screen.getByText(/over the 5,000-image ceiling/i)).toBeInTheDocument();
  });
});

describe('failed images', () => {
  it('names the file and repeats the reason the conversion gave', () => {
    render(
      <JobDetailBody
        detail={job({
          metrics: metrics({
            failedImages: [
              {
                fileName: 'IM-0002-0031.dcm',
                error: 'unsupported transfer syntax',
                batchIndex: 30,
              },
            ],
            failedImagesTotal: 4,
          }),
        })}
      />,
    );

    expect(screen.getByText('IM-0002-0031.dcm')).toBeInTheDocument();
    expect(screen.getByText(/unsupported transfer syntax/)).toBeInTheDocument();
    expect(screen.getByText(/and 3 more/i)).toBeInTheDocument();
  });
});

// The Jobs page is a support console; the report is read on the page matching the
// door the study came through. The card links there with the study's own
// reference already in the search.
describe('where to read the report', () => {
  it('points a token-sent study at the integration listing', () => {
    render(<JobDetailBody detail={job({ source: 'integration', examId: 'study-abc' })} />);
    const link = screen.getByRole('link', { name: /open the listing/i });
    expect(link).toHaveAttribute('href', '/organization/analyses?q=study-abc');
  });

  it('points a portal upload at the New Analysis history', () => {
    render(<JobDetailBody detail={job({ source: 'portal', examId: 'study-abc' })} />);
    expect(screen.getByRole('link', { name: /open the listing/i })).toHaveAttribute(
      'href',
      '/organization/new-analysis?q=study-abc',
    );
  });

  it('says nothing for a job that is not an analysis', () => {
    render(<JobDetailBody detail={job({ kind: 'users.export.csv', source: undefined })} />);
    expect(screen.queryByRole('link', { name: /open the listing/i })).not.toBeInTheDocument();
  });
});
