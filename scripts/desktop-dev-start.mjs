/**
 * Cross-platform desktop dev: start Vite, wait for it, launch Electron.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const url = process.env.LUMINARA_DEV_URL || 'http://localhost:3000/';
const isWin = process.platform === 'win32';

const vite = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: isWin,
});

const waiter = spawn(process.execPath, [path.join(__dirname, 'desktop-dev.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    LUMINARA_DEV_URL: url,
    LUMINARA_USE_LOCAL: process.env.LUMINARA_USE_LOCAL || '1',
  },
});

function shutdown(code = 0) {
  if (!vite.killed) vite.kill();
  if (!waiter.killed) waiter.kill();
  process.exit(code);
}

vite.on('exit', (code) => {
  if (!waiter.killed) waiter.kill();
  process.exit(code ?? 0);
});

waiter.on('exit', (code) => {
  if (!vite.killed) vite.kill();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
