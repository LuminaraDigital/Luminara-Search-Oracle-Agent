import { describe, expect, it } from 'vitest';
import { isSidecarPathAllowed, umamiUpstreamPath } from '../worker/index';

describe('sidecar relay allowlist', () => {
  it('allows the two LanguageTool routes with the right method', () => {
    expect(isSidecarPathAllowed('languagetool', 'POST', '/v2/check')).toBe(true);
    expect(isSidecarPathAllowed('languagetool', 'GET', '/v2/languages')).toBe(true);
    expect(isSidecarPathAllowed('languagetool', 'post', '/v2/check')).toBe(true);
  });

  it('enforces the method per LanguageTool route', () => {
    expect(isSidecarPathAllowed('languagetool', 'GET', '/v2/check')).toBe(false);
    expect(isSidecarPathAllowed('languagetool', 'POST', '/v2/languages')).toBe(false);
    expect(isSidecarPathAllowed('languagetool', 'DELETE', '/v2/check')).toBe(false);
  });

  it('blocks LanguageTool look-alikes and other endpoints', () => {
    expect(isSidecarPathAllowed('languagetool', 'POST', '/v2/checkX')).toBe(false);
    expect(isSidecarPathAllowed('languagetool', 'POST', '/v2/check/extra')).toBe(false);
    expect(isSidecarPathAllowed('languagetool', 'POST', '/v2/words/add')).toBe(false);
    expect(isSidecarPathAllowed('languagetool', 'GET', '/v2/languages/')).toBe(false);
  });

  it('allows read-only Umami website routes', () => {
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites')).toBe(true);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc-123/stats')).toBe(true);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/metrics')).toBe(true);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc/pageviews')).toBe(true);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc/sessions')).toBe(true);
  });

  it('blocks Umami writes and everything outside the website read surface', () => {
    expect(isSidecarPathAllowed('umami', 'POST', '/api/websites')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'DELETE', '/api/websites/abc')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc/events')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/abc/stats/extra')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websitesX')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/users')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/auth/login')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/../users')).toBe(false);
    expect(isSidecarPathAllowed('umami', 'GET', '/api/websites/a b/stats')).toBe(false);
  });

  it('rejects unknown sidecar ids', () => {
    expect(isSidecarPathAllowed('crawler', 'GET', '/health')).toBe(false);
    expect(isSidecarPathAllowed('', 'GET', '/api/websites')).toBe(false);
  });
});

describe('umamiUpstreamPath', () => {
  it('rewrites /api to /v1 for Umami Cloud', () => {
    expect(umamiUpstreamPath('https://api.umami.is', '/api/websites')).toBe('https://api.umami.is/v1/websites');
    expect(umamiUpstreamPath('https://api.umami.is/', '/api/websites/abc/stats')).toBe('https://api.umami.is/v1/websites/abc/stats');
  });

  it('passes self-hosted paths through unchanged', () => {
    expect(umamiUpstreamPath('https://stats.example.com', '/api/websites')).toBe('https://stats.example.com/api/websites');
    expect(umamiUpstreamPath('http://localhost:3002/', '/api/websites/abc/metrics')).toBe('http://localhost:3002/api/websites/abc/metrics');
  });

  it('preserves a query string when one is included', () => {
    expect(umamiUpstreamPath('https://api.umami.is', '/api/websites/abc/stats?startAt=1&endAt=2'))
      .toBe('https://api.umami.is/v1/websites/abc/stats?startAt=1&endAt=2');
    expect(umamiUpstreamPath('https://stats.example.com', '/api/websites/abc/stats?startAt=1&endAt=2'))
      .toBe('https://stats.example.com/api/websites/abc/stats?startAt=1&endAt=2');
  });

  it('does not rewrite a self-hosted instance whose path merely contains api', () => {
    expect(umamiUpstreamPath('https://example.com/api.umami.is', '/api/websites')).toBe('https://example.com/api.umami.is/api/websites');
  });
});
