import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';

async function apiProxy() {
  const config = typeof viteConfig === 'function' ? await viteConfig({ mode: 'test', command: 'serve' }) : viteConfig;
  const api = config.server?.proxy?.['/api'];
  if (!api || typeof api === 'string') throw new Error('vite.config.ts has no /api proxy');
  const proxy = new EventEmitter();
  api.configure?.(proxy as never, api);
  const send = (origin: string) => {
    const sent = new Map<string, string>([['origin', origin]]);
    const proxyReq = { setHeader: (name: string, value: string) => sent.set(name.toLowerCase(), value) };
    proxy.emit('proxyReq', proxyReq, { headers: { origin, host: 'localhost:3000' } });
    return sent.get('origin');
  };
  return { send, targetOrigin: new URL(String(api.target)).origin };
}

describe('dev /api proxy', () => {
  it('sends the target origin for the dev page, so sign-out is not refused as cross-site', async () => {
    const { send, targetOrigin } = await apiProxy();
    expect(send('http://localhost:3000')).toBe(targetOrigin);
  });

  it('passes a foreign Origin through unchanged, so the Worker still refuses it', async () => {
    const { send } = await apiProxy();
    expect(send('https://evil.example')).toBe('https://evil.example');
  });
});
