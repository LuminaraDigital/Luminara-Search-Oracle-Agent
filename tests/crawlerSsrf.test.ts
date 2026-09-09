import { describe, expect, it } from 'vitest';
// The crawler ships as plain ESM with no build step; the guard uses only Node built-ins.
// @ts-expect-error untyped .mjs module
import { assertPublicTarget, isPrivateIp, parsePublicHttpUrl } from '../crawler/ssrf.mjs';

describe('crawler SSRF guard', () => {
  it('flags reserved address ranges', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.0.10', '169.254.169.254', '100.100.1.1', '0.0.0.0', '::1', 'fe80::abcd', 'fd00::1', '::ffff:192.168.1.1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700::1111']) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it('accepts public http(s) URLs only', () => {
    expect(parsePublicHttpUrl('https://example.com/page')?.hostname).toBe('example.com');
    expect(parsePublicHttpUrl('http://93.184.216.34/')?.hostname).toBe('93.184.216.34');
    for (const bad of [
      'file:///etc/passwd',
      'ftp://example.com/',
      'http://localhost:3001/health',
      'http://127.0.0.1/',
      'http://[::1]:8080/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/admin',
      'http://user:pass@example.com/',
      'http://intranet/',
      'http://printer.local/',
      'http://db.internal/',
      'not a url',
      '',
    ]) {
      expect(parsePublicHttpUrl(bad), bad).toBeNull();
    }
  });

  it('refuses hostnames that resolve to private addresses, and unresolved hosts', async () => {
    const resolver = (map: Record<string, string[]>) => async (host: string) => {
      if (!(host in map)) throw new Error('ENOTFOUND');
      return map[host].map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
    };
    const r = resolver({ 'example.com': ['93.184.216.34'], 'rebind.example.com': ['93.184.216.34', '127.0.0.1'], 'v6.example.com': ['fe80::1'] });
    expect((await assertPublicTarget('https://example.com/', r)).ok).toBe(true);
    expect((await assertPublicTarget('https://rebind.example.com/', r)).ok).toBe(false);
    expect((await assertPublicTarget('https://v6.example.com/', r)).ok).toBe(false);
    expect((await assertPublicTarget('https://missing.example.com/', r)).ok).toBe(false);
    expect((await assertPublicTarget('http://localhost/', r)).ok).toBe(false);
  });
});
