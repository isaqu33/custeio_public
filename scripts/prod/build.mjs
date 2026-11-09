#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = PACKAGE_JSON.version;

const args = new Set(process.argv.slice(2));

const options = {
  skipVerify: args.has('--skip-verify') || process.env.PROD_SKIP_VERIFY === 'true',
  skipDocker: args.has('--skip-docker') || process.env.PROD_SKIP_DOCKER === 'true',
  clean: args.has('--clean') || process.env.PROD_CLEAN === 'true',
};

const cloudImageTag = process.env.PROD_CLOUD_IMAGE_TAG ?? `rayai:${VERSION}`;
const runtimeBaseImageTag =
  process.env.PROD_RUNTIME_BASE_IMAGE_TAG ??
  process.env.RUNTIME_BASE_IMAGE ??
  'rayai-runtime-base:node22-dcmtk';
let runtimeBaseBuilt = false;

async function main() {
  console.log(`Production build`);
  console.log(`  version: ${VERSION}`);
  console.log(`  verify: ${options.skipVerify ? 'skipped' : 'enabled'}`);
  console.log(`  docker: ${options.skipDocker ? 'skipped' : 'enabled'}`);
  if (!options.skipDocker) console.log(`  runtime base image: ${runtimeBaseImageTag}`);
  console.log('');

  if (options.clean) await cleanOutputs();
  if (!options.skipVerify) await run('npm', ['run', 'verify']);

  await buildCloud();

  console.log('\nProduction build complete.');
}

async function buildCloud() {
  console.log('\n== Cloud app ==');
  await run('npm', ['run', 'build']);

  if (options.skipDocker) return;

  await buildRuntimeBase();
  await run('docker', [
    'build',
    '--target',
    'production',
    '--build-arg',
    `RUNTIME_BASE_IMAGE=${runtimeBaseImageTag}`,
    '-t',
    cloudImageTag,
    '-t',
    'rayai:latest',
    '.',
  ]);
}

async function buildRuntimeBase() {
  if (runtimeBaseBuilt) return;
  await run('docker', ['build', '-f', 'Dockerfile.runtime-base', '-t', runtimeBaseImageTag, '.']);
  runtimeBaseBuilt = true;
}

async function cleanOutputs() {
  console.log('Cleaning generated build outputs...');
  await removeIfExists(join(ROOT, '.next'));
}

async function removeIfExists(path) {
  if (!existsSync(path)) return;
  await rm(path, { recursive: true, force: true });
}

function run(command, commandArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    console.log(`\n$ ${[command, ...commandArgs].join(' ')}`);
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }
      rejectPromise(new Error(`${command} exited with code ${code ?? 1}`));
    });
  });
}

main().catch((error) => {
  console.error(`\n[FATAL] ${error.message}`);
  process.exit(1);
});
