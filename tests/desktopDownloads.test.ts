import { describe, expect, it, vi } from 'vitest';
import { desktopLatestJson, desktopWindowsDownload } from '../worker/desktopDownloads';

function r2(store: Map<string, { body: string; type?: string }>): R2Bucket {
  return {
    get: async (key: string) => {
      const v = store.get(key);
      if (!v) return null;
      return {
        body: v.body,
        httpEtag: '"test"',
        writeHttpMetadata: (headers: Headers) => {
          if (v.type) headers.set('content-type', v.type);
        },
        json: async () => JSON.parse(v.body),
      } as unknown as R2ObjectBody;
    },
    head: async (key: string) => (store.has(key) ? ({} as R2Object) : null),
  } as unknown as R2Bucket;
}

describe('desktop downloads', () => {
  it('reports GitHub fallback when R2 is empty', async () => {
    const res = await desktopLatestJson({});
    const body = await res.json() as { mirroredOnR2: boolean; downloadPath: string };
    expect(body.mirroredOnR2).toBe(false);
    expect(body.downloadPath).toBe('/desktop/windows');
  });

  it('streams from R2 when latest.exe exists', async () => {
    const bucket = r2(new Map([
      ['windows/latest.exe', { body: 'MZ-fake-installer', type: 'application/octet-stream' }],
      ['windows/manifest.json', { body: JSON.stringify({ version: '1.0.0', fileName: 'Luminara-Suite-Setup-1.0.0.exe' }), type: 'application/json' }],
    ]));
    const res = await desktopWindowsDownload({ DESKTOP_RELEASES: bucket }, new Request('https://luminarasuite.com/desktop/windows'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Luminara-Desktop-Source')).toBe('r2');
    expect(res.headers.get('Content-Disposition')).toContain('Luminara-Suite-Setup-1.0.0.exe');
    expect(await res.text()).toBe('MZ-fake-installer');
  });

  it('redirects to GitHub when R2 has no object', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      assets: [{ name: 'Luminara-Suite-Setup-1.0.0.exe', browser_download_url: 'https://github.com/example/releases/download/desktop-v1.0.0/Luminara-Suite-Setup-1.0.0.exe' }],
    }), { status: 200 })));

    const res = await desktopWindowsDownload({}, new Request('https://luminarasuite.com/desktop/windows'));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toContain('Luminara-Suite-Setup-1.0.0.exe');
    vi.unstubAllGlobals();
  });
});

describe('desktop download count', () => {
  const pending: Promise<void>[] = [];
  const background = (work: Promise<void>) => void pending.push(work);

  function fakeDb(fail = false) {
    const run = vi.fn(async () => {
      if (fail) throw new Error('D1 down');
    });
    const bind = vi.fn(() => ({ run }));
    return { db: { prepare: vi.fn(() => ({ bind })) } as unknown as D1Database, bind, run };
  }

  it('counts a GET and not a HEAD', async () => {
    const { db, bind, run } = fakeDb();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    await desktopWindowsDownload({ DB: db }, new Request('https://luminarasuite.com/desktop/windows', { method: 'HEAD' }), background);
    expect(run).not.toHaveBeenCalled();
    await desktopWindowsDownload({ DB: db }, new Request('https://luminarasuite.com/desktop/windows'), background);
    await Promise.all(pending);
    expect(bind.mock.calls[0]).toContain('desktop_download_started');
    vi.unstubAllGlobals();
  });

  it('still serves the download when the count fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const res = await desktopWindowsDownload({ DB: fakeDb(true).db }, new Request('https://luminarasuite.com/desktop/windows'), background);
    await Promise.all(pending);
    expect(res.status).toBe(302);
    vi.unstubAllGlobals();
  });
});
