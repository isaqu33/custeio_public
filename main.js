'use strict';

const { spawn } = require('child_process');

const child = spawn('npm', ['run', 'entrypoint'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  console.error('[main] failed to start entrypoint', err);
  process.exit(1);
});

function shutdown(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
