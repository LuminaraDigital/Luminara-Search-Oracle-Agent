import { describe, expect, it } from 'vitest';
import { handleAssetLinks } from '../worker/assetLinks';
import type { Env } from '../worker/env';

const url = 'https://www.luminarasuite.com/.well-known/assetlinks.json';
const fingerprint = Array.from({ length: 32 }, () => 'AB').join(':');

describe('handleAssetLinks', () => {
  it('ignores other paths', () => {
    expect(handleAssetLinks(new Request('https://www.luminarasuite.com/'), {} as Env)).toBeNull();
  });

  it('returns 404 until a real fingerprint is configured', () => {
    expect(handleAssetLinks(new Request(url), {} as Env)?.status).toBe(404);
    const bad = { ANDROID_APP_CERT_SHA256: 'not-a-fingerprint' } as unknown as Env;
    expect(handleAssetLinks(new Request(url), bad)?.status).toBe(404);
  });

  it('lists the package and each configured fingerprint', async () => {
    const env = { ANDROID_APP_CERT_SHA256: ` ${fingerprint.toLowerCase()} ,junk` } as unknown as Env;
    const res = handleAssetLinks(new Request(url), env);
    const body = (await res?.json()) as Array<{ target: Record<string, unknown> }>;
    expect(body[0]?.target).toMatchObject({
      package_name: 'com.luminarasuite.app',
      sha256_cert_fingerprints: [fingerprint],
    });
  });
});
