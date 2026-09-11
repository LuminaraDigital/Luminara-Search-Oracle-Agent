/**
 * Wait until a URL responds, then spawn Electron.
 * Used by `npm run desktop:dev` so Vite is ready first.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const url = process.env.LUMINARA_DEV_URL || 'http://localhost:3000/';
const maxAttempts = 60;

async function waitForUrl(target) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(target, { method: 'GET' });
      if (res.ok || res.status === 304) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${target}`);
}

await waitForUrl(url);

const electronCli = path.join(root, 'node_modules', 'electron', 'cli.js');
const child = spawn(process.execPath, [electronCli, root], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    LUMINARA_USE_LOCAL: process.env.LUMINARA_USE_LOCAL || '1',
    LUMINARA_DEV_URL: url,
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
