import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { logger } from '../app/lib/logger';
import { checkReadiness } from '../app/lib/health';
import {
  parseRuntimeBool,
  readRuntimeRoles,
  shouldStartWebProcess,
  type RuntimeRoles,
} from '../app/lib/runtime-roles';

type RuntimeFlags = RuntimeRoles;

type EntrypointDeps = {
  spawnNpmScript: (_script: string) => ChildProcess;
  createJobsHealthServer: () => { close: () => void } | null;
  exit: (_code: number) => never;
  onSignal: (_signal: NodeJS.Signals, _handler: () => void) => void;
};

export function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  return parseRuntimeBool(value, defaultValue);
}

export function readFlags(): RuntimeFlags {
  return readRuntimeRoles();
}

export function spawnNpmScript(script: string): ChildProcess {
  const child = spawn('npm', ['run', script], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (err) => {
    logger.error({ err, script }, 'failed to spawn child process');
  });

  return child;
}

function writeJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export function createJobsHealthServer() {
  const enabled = parseBool(process.env.APP_JOBS_HEALTH_ENABLED, true);
  if (!enabled) return null;

  const port = Number(process.env.APP_JOBS_HEALTH_PORT) || 8081;
  const host = process.env.APP_JOBS_HEALTH_HOST || '0.0.0.0';
  const log = logger.child({ component: 'jobs-health', port, host });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/';

    // The jobs process mirrors the web app's probe surface, including the short
    // `/health/healthz` and `/health/readyz` aliases, so a single probe config
    // works against either process instead of one per container role.
    if (url === '/health/live' || url === '/health/healthz') {
      writeJson(res, 200, {
        status: 'ok',
        component: 'jobs',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (url === '/health/ready' || url === '/health/readyz' || url === '/health') {
      const { body, statusCode } = await checkReadiness();
      writeJson(res, statusCode, { component: 'jobs', ...body });
      return;
    }

    writeJson(res, 404, { error: 'Not found' });
  });

  server.on('error', (err) => {
    log.error({ err }, 'jobs health server failed');
  });

  server.listen(port, host, () => {
    log.info('jobs health server listening');
  });

  return server;
}

export async function runEntrypoint(
  flags: RuntimeFlags = readFlags(),
  deps: EntrypointDeps = {
    spawnNpmScript,
    createJobsHealthServer,
    exit: process.exit,
    onSignal: (signal, handler) => {
      process.on(signal, handler);
    },
  },
) {
  const log = logger.child({ component: 'entrypoint', ...flags });

  const shouldLoadWeb = shouldStartWebProcess(flags);
  if (!shouldLoadWeb && !flags.loadJobs) {
    log.error('nothing to run: all APP_LOAD_* flags are false');
    deps.exit(1);
  }

  const children: ChildProcess[] = [];
  let jobsHealthServer: { close: () => void } | null = null;

  if (shouldLoadWeb) {
    log.info('starting web process (next start)');
    children.push(deps.spawnNpmScript('start'));
  }

  if (flags.loadJobs) {
    log.info('starting jobs worker');
    children.push(deps.spawnNpmScript('worker'));
    if (!shouldLoadWeb) {
      jobsHealthServer = deps.createJobsHealthServer();
    }
  }

  let exiting = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (exiting) return;
    exiting = true;
    log.info({ signal }, 'entrypoint shutting down');
    jobsHealthServer?.close();
    for (const child of children) {
      if (child.pid) child.kill(signal);
    }
  };

  deps.onSignal('SIGINT', () => shutdown('SIGINT'));
  deps.onSignal('SIGTERM', () => shutdown('SIGTERM'));

  for (const child of children) {
    child.on('exit', (code, signal) => {
      log.info({ code, signal, pid: child.pid }, 'child exited');
      if (!exiting) {
        exiting = true;
        for (const other of children) {
          if (other !== child && other.pid) other.kill('SIGTERM');
        }
      }
      deps.exit(code ?? 0);
    });
  }
}

if (require.main === module) {
  void runEntrypoint();
}
