import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { prepareDockerDependencies } from './docker-deps';

const ROOT_DIR = resolve(__dirname, '..');
const DEFAULT_PORT = '3000';

let server: ChildProcess | undefined;
let cleanupDockerDependencies: (() => Promise<void>) | undefined;
let shuttingDown = false;

const getPort = () => {
  const portFlagIndex = process.argv.findIndex((arg) => arg === '--port');
  return process.argv[portFlagIndex + 1] ?? process.env.PORT ?? DEFAULT_PORT;
};

const stopServer = () => {
  if (!server || server.killed) return;
  server.kill('SIGTERM');
};

const shutdown = async (exitCode: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopServer();
  await cleanupDockerDependencies?.();
  process.exit(exitCode);
};

const start = async () => {
  cleanupDockerDependencies = await prepareDockerDependencies();

  server = spawn('npm', ['run', 'dev', '--', '--port', getPort()], {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: 'inherit',
  });

  server.on('exit', (code) => {
    void shutdown(code ?? 0);
  });
};

process.on('SIGINT', () => {
  void shutdown(130);
});

process.on('SIGTERM', () => {
  void shutdown(143);
});

void start().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  void shutdown(1);
});
