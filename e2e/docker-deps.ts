import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT_DIR = resolve(__dirname, '..');
const COMPOSE_FILE = resolve(ROOT_DIR, 'docker-compose.dev.yml');
const ENV_INIT_SCRIPT = resolve(ROOT_DIR, 'scripts/dev/init-env.sh');
const ENV_FILE = resolve(ROOT_DIR, '.env');
const HEALTH_TIMEOUT_MS = 120_000;
const HEALTH_POLL_MS = 2_000;

const REQUIRED_SERVICES = [
  { container: 'mongo-custeio', service: 'mongo' },
  { container: 'redis-custeio', service: 'redis' },
  { container: 'azurite-custeio', service: 'azurite' },
] as const;

type DependencyService = (typeof REQUIRED_SERVICES)[number];

type ContainerState = {
  readonly running: boolean;
  readonly health: string;
};

const shouldSkipDockerDeps = () =>
  process.env.E2E_SKIP_DOCKER_DEPS === '1' || process.env.E2E_NO_DOCKER_DEPS === '1';

const shouldKeepDockerDeps = () => process.env.E2E_KEEP_DOCKER_DEPS === '1';

const log = (message: string) => {
  process.stdout.write(`[e2e] ${message}\n`);
};

const run = async (command: string, args: readonly string[]) => {
  await execFileAsync(command, [...args], {
    cwd: ROOT_DIR,
    env: process.env,
    timeout: 120_000,
  });
};

const getContainerState = async (container: string): Promise<ContainerState> => {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'inspect',
        '--format',
        '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',
        container,
      ],
      { timeout: 10_000 },
    );
    const [running, health] = stdout.trim().split('|');

    return {
      running: running === 'true',
      health: health ?? 'none',
    };
  } catch {
    return {
      running: false,
      health: 'missing',
    };
  }
};

const isReady = (state: ContainerState) =>
  state.running && (state.health === 'healthy' || state.health === 'none');

const describeState = (service: DependencyService, state: ContainerState) =>
  `${service.service}=${state.running ? 'running' : 'stopped'}/${state.health}`;

const waitForHealthyDependencies = async () => {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const states = await Promise.all(
      REQUIRED_SERVICES.map(async (service) => ({
        service,
        state: await getContainerState(service.container),
      })),
    );

    if (states.every(({ state }) => isReady(state))) {
      log(
        `Docker dependencies are ready: ${states.map(({ service, state }) => describeState(service, state)).join(', ')}`,
      );
      return;
    }

    await new Promise((resolvePoll) => setTimeout(resolvePoll, HEALTH_POLL_MS));
  }

  const states = await Promise.all(
    REQUIRED_SERVICES.map(async (service) => ({
      service,
      state: await getContainerState(service.container),
    })),
  );
  const stateSummary = states.map(({ service, state }) => describeState(service, state)).join(', ');
  throw new Error(`Timed out waiting for Docker dependencies to become healthy: ${stateSummary}`);
};

const ensureEnvFile = async () => {
  if (existsSync(ENV_FILE) || !existsSync(ENV_INIT_SCRIPT)) return;

  log('Creating .env for Docker dependencies.');
  await run('bash', [ENV_INIT_SCRIPT]);
};

const stopDockerDependencies = async (servicesToStop: readonly DependencyService[]) => {
  if (servicesToStop.length === 0 || shouldKeepDockerDeps()) return;

  log(
    `Stopping Docker dependencies started by e2e: ${servicesToStop.map(({ service }) => service).join(', ')}.`,
  );
  await run('docker', [
    'compose',
    '-f',
    COMPOSE_FILE,
    'stop',
    ...servicesToStop.map(({ service }) => service),
  ]);
};

export const prepareDockerDependencies = async () => {
  if (shouldSkipDockerDeps()) {
    log('Skipping Docker dependency startup because Docker dependency startup is disabled.');
    return async () => {};
  }

  await ensureEnvFile();

  const initialStates = await Promise.all(
    REQUIRED_SERVICES.map(async (service) => ({
      service,
      state: await getContainerState(service.container),
    })),
  );
  const servicesToStop = initialStates
    .filter(({ state }) => !state.running)
    .map(({ service }) => service);

  log('Starting Docker dependencies: mongo, redis, azurite.');
  await run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', 'mongo', 'redis', 'azurite']);
  await waitForHealthyDependencies();

  return () => stopDockerDependencies(servicesToStop);
};
