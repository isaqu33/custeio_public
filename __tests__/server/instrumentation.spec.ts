/**
 * @jest-environment node
 */
export {};

// `instrumentation.ts` is the only thing that loads the Sentry server/edge
// configs — Next imports no other entry point for them. It was missing for
// months and the symptom was silent: server-side errors simply never left the
// container. These tests fail loudly if the wiring is dropped again or ends up
// pointing at the wrong config.
const mockLoads: string[] = [];
const captureRequestErrorMock = jest.fn();

jest.mock('@sentry/nextjs', () => ({ captureRequestError: captureRequestErrorMock }));
jest.mock('@/sentry.server.config', () => {
  mockLoads.push('server');
  return { __esModule: true };
});
jest.mock('@/sentry.edge.config', () => {
  mockLoads.push('edge');
  return { __esModule: true };
});

const ORIGINAL_RUNTIME = process.env.NEXT_RUNTIME;

async function registerWithRuntime(runtime: string | undefined): Promise<string[]> {
  jest.resetModules();
  mockLoads.length = 0;
  if (runtime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = runtime;

  const { register } = await import('@/instrumentation');
  await register();
  return [...mockLoads];
}

describe('instrumentation', () => {
  afterAll(() => {
    if (ORIGINAL_RUNTIME === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = ORIGINAL_RUNTIME;
  });

  it('loads only the server Sentry config on the node runtime', async () => {
    await expect(registerWithRuntime('nodejs')).resolves.toEqual(['server']);
  });

  it('loads only the edge Sentry config on the edge runtime', async () => {
    await expect(registerWithRuntime('edge')).resolves.toEqual(['edge']);
  });

  it('loads nothing and does not throw when the runtime is unset', async () => {
    await expect(registerWithRuntime(undefined)).resolves.toEqual([]);
  });

  it('exports onRequestError so Next reports handler and RSC errors', async () => {
    jest.resetModules();
    const { onRequestError } = await import('@/instrumentation');
    expect(onRequestError).toBe(captureRequestErrorMock);
  });
});
