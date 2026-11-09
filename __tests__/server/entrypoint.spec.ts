/**
 * @jest-environment node
 */

import { type ChildProcess } from 'child_process';

jest.mock('@/app/lib/health', () => ({
  checkReadiness: jest.fn().mockResolvedValue({
    statusCode: 200,
    body: { status: 'ok', checks: { mongo: 'ok', redis: 'ok' } },
  }),
}));

import { parseBool, runEntrypoint } from '@/scripts/entrypoint';
import type { RuntimeRoles } from '@/app/lib/runtime-roles';

const baseFlags: RuntimeRoles = {
  loadAdminApi: false,
  loadGatewayApi: false,
  loadHttp: false,
  loadIngestionApi: false,
  loadJobs: false,
  loadUi: false,
};

function makeChild(pid = 1000) {
  const handlers: Record<string, (_a?: unknown, _b?: unknown) => void> = {};
  const child: {
    pid: number;
    kill: jest.Mock;
    on: jest.Mock;
    emitEvent: (_e: string, _a?: unknown, _b?: unknown) => void;
  } = {
    pid,
    kill: jest.fn(),
    on: jest.fn((event: string, handler: (_a?: unknown, _b?: unknown) => void) => {
      handlers[event] = handler;
      return child;
    }),
    emitEvent: (event: string, a?: unknown, b?: unknown) => {
      handlers[event]?.(a, b);
    },
  };
  return child as unknown as ChildProcess & {
    emitEvent: (_e: string, _a?: unknown, _b?: unknown) => void;
  };
}

describe('entrypoint', () => {
  it('parseBool supports true-like values', () => {
    expect(parseBool(undefined, true)).toBe(true);
    expect(parseBool(undefined, false)).toBe(false);
    expect(parseBool('TRUE', false)).toBe(true);
    expect(parseBool('on', false)).toBe(true);
    expect(parseBool('0', true)).toBe(false);
  });

  it('exits with code 1 when all load flags are false', async () => {
    const exit = jest.fn(() => {
      throw new Error('exit');
    });
    await expect(
      runEntrypoint(baseFlags, {
        spawnNpmScript: jest.fn(),
        createJobsHealthServer: jest.fn(() => null),
        exit: exit as unknown as (_code: number) => never,
        onSignal: jest.fn(),
      }),
    ).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('starts web and worker when both are enabled', async () => {
    const startChild = makeChild(101);
    const workerChild = makeChild(102);
    const spawnNpmScript = jest.fn((script: string) =>
      script === 'start' ? startChild : workerChild,
    );

    runEntrypoint(
      {
        ...baseFlags,
        loadAdminApi: true,
        loadGatewayApi: true,
        loadHttp: true,
        loadIngestionApi: true,
        loadJobs: true,
        loadUi: true,
      },
      {
        spawnNpmScript,
        createJobsHealthServer: jest.fn(() => ({ close: jest.fn() })),
        exit: jest.fn() as unknown as (_code: number) => never,
        onSignal: jest.fn(),
      },
    );

    expect(spawnNpmScript).toHaveBeenCalledTimes(2);
    expect(spawnNpmScript).toHaveBeenNthCalledWith(1, 'start');
    expect(spawnNpmScript).toHaveBeenNthCalledWith(2, 'worker');
  });

  it('starts jobs health server only in jobs-only mode', async () => {
    const workerChild = makeChild(200);
    const createJobsHealthServer = jest.fn(() => ({ close: jest.fn() }));

    runEntrypoint(
      { ...baseFlags, loadJobs: true },
      {
        spawnNpmScript: jest.fn(() => workerChild),
        createJobsHealthServer,
        exit: jest.fn() as unknown as (_code: number) => never,
        onSignal: jest.fn(),
      },
    );

    expect(createJobsHealthServer).toHaveBeenCalledTimes(1);
  });

  it('shuts down sibling child when one exits', async () => {
    const firstChild = makeChild(301);
    const secondChild = makeChild(302);
    const exit = jest.fn();

    runEntrypoint(
      {
        ...baseFlags,
        loadAdminApi: true,
        loadGatewayApi: true,
        loadHttp: true,
        loadIngestionApi: true,
        loadJobs: true,
        loadUi: true,
      },
      {
        spawnNpmScript: jest.fn().mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild),
        createJobsHealthServer: jest.fn(() => null),
        exit: exit as unknown as (_code: number) => never,
        onSignal: jest.fn(),
      },
    );

    firstChild.emitEvent('exit', 0, null);
    expect(secondChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(exit).toHaveBeenCalledWith(0);
  });
});
