import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SITE_INPUT_MESSAGE } from '../services/audit/auditTargetUrl';
import { citabilityStatusLabel } from '../services/audit/suiteCitabilityChecklist';
import { fetchQuotaStatus, setAccountSignedIn } from '../services/apiClient';
import { normalizeDemoUrl, visibleProbeHost } from '../components/marketing/demo/demoFixtures';
import { MARKETING_SHELL_BY_PATH } from '../services/marketing/pageMeta';
import { MIN_PASSWORD_LENGTH } from '../services/auth/firebaseAuthService';

describe('playtest LOW 15-30', () => {
  afterEach(() => {
    setAccountSignedIn(null);
    vi.unstubAllGlobals();
  });

  it('strips a repeated scheme so the probe prefix is not doubled', () => {
    expect(visibleProbeHost('https:// https://example.com/path')).toBe('example.com/path');
    expect(normalizeDemoUrl('https://https://Example.com')).toEqual({ ok: true, host: 'example.com' });
    const empty = normalizeDemoUrl('   ');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toBe(EMPTY_SITE_INPUT_MESSAGE);
  });

  it('does not call /api/auth/quota when there is no confirmed session', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      location: { protocol: 'https:', origin: 'https://luminarasuite.com' },
    });

    setAccountSignedIn(null);
    expect(await fetchQuotaStatus()).toBeNull();
    setAccountSignedIn(false);
    expect(await fetchQuotaStatus()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps marketing titles unique, short, and free of the wordmark-first fragment', () => {
    const titles = Object.values(MARKETING_SHELL_BY_PATH).map((page) => page.title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const title of titles) {
      expect(title.length).toBeLessThanOrEqual(60);
      expect(title).not.toMatch(/^Luminara Suite \|/);
    }
    const index = readFileSync('index.html', 'utf8');
    expect(index).toContain('<title>AI visibility audit | Luminara Suite</title>');
    const notFound = readFileSync('components/NotFoundPage.tsx', 'utf8');
    expect(notFound).toContain("Page not found | Luminara Suite");
    expect(notFound).not.toContain('Every URL is handled honestly');
  });

  it('requires 8 characters on signup and leaves keep-me-signed-in unchecked', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
    const panel = readFileSync('components/auth/AuthPanel.tsx', 'utf8');
    expect(panel).toContain('const [keepSignedIn, setKeepSignedIn] = useState(false)');
    expect(panel).toContain("mode === 'signup' && password.length < MIN_PASSWORD_LENGTH");
    const worker = readFileSync('worker/authCredentialGateway.ts', 'utf8');
    expect(worker).toContain('const MIN_PASSWORD_LEN = 6');
  });

  it('maps not_measured to Not measured and keeps that token out of the glossary', () => {
    expect(citabilityStatusLabel('not_measured')).toBe('Not measured');
    expect(citabilityStatusLabel('pass')).toBe('Pass');
    const glossary = readFileSync('public/docs/what-is-aeo.html', 'utf8');
    expect(glossary).toContain('>Not measured<');
    expect(glossary).not.toContain('not_measured');
  });
});
