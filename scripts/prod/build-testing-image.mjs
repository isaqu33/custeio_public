#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));

const REGISTRY = process.env.PROD_REGISTRY ?? 'registry.pacs-worklist.com.br';
const REPOSITORY = process.env.PROD_TESTING_REPOSITORY ?? 'testing.pacs-worklist.com.br/app';
const VERSION = process.env.VERSION ?? PACKAGE_JSON.version;
const IMAGE_TAG = `${REGISTRY}/${REPOSITORY}:${VERSION}`;
const RUNTIME_BASE_IMAGE =
  process.env.RUNTIME_BASE_IMAGE ??
  `${REGISTRY}/testing.pacs-worklist.com.br/runtime-base:node22-dcmtk`;
const LOCAL_RUNTIME_BASE_IMAGE = 'rayai-runtime-base:node22-dcmtk';

const args = new Set(process.argv.slice(2));
const options = {
  skipVerify: args.has('--skip-verify') || process.env.PROD_SKIP_VERIFY === 'true',
  push: args.has('--push') || process.env.PROD_PUSH === 'true',
};

async function main() {
  console.log('Testing image build');
  console.log(`  image: ${IMAGE_TAG}`);
  console.log(`  runtime base: ${RUNTIME_BASE_IMAGE}`);
  console.log(`  verify: ${options.skipVerify ? 'skipped' : 'enabled'}`);
  console.log(`  push: ${options.push ? 'enabled' : 'skipped'}\n`);

  if (!options.skipVerify) await run('npm', ['run', 'verify']);

  await buildRuntimeBase();
  await buildAppImage();

  if (options.push) await run('docker', ['push', IMAGE_TAG]);

  console.log(`\nTesting image ready: ${IMAGE_TAG}`);
}

async function buildRuntimeBase() {
  await run('docker', [
    'build',
    '-f',
    'Dockerfile.runtime-base',
    '-t',
    LOCAL_RUNTIME_BASE_IMAGE,
    '-t',
    RUNTIME_BASE_IMAGE,
    '.',
  ]);
}

async function buildAppImage() {
  await run('docker', [
    'build',
    '--target',
    'production',
    '--build-arg',
    `RUNTIME_BASE_IMAGE=${RUNTIME_BASE_IMAGE}`,
    '-t',
    IMAGE_TAG,
    '.',
  ]);
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
