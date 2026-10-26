import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteAccountPage } from '../components/DeleteAccountPage';
import { HelpPage } from '../components/help/HelpPage';
import { LegalPage } from '../components/LegalPage';
import { PRIVACY_SECTIONS } from '../services/legal/privacyCopy';
import { isAndroidPlayClientSearch } from '../services/legal/playClient';
import { buildAndroidContactHtml, buildAndroidPrivacyHtml, DELETE_ACCOUNT_HTML } from '../worker/androidLegalHtml';
import { TERMS_HTML, buildTermsHtml } from '../worker/termsPolicy';
import worker from '../worker/index';

const COMMERCE = /href="\/pricing"|Start free|buy on the website|checkout is through Stripe|Card checkout/i;
const PRICES = /\$\d|\bAUD\b|A\$/;

function assertPlaySafe(html: string) {
  expect(html).not.toMatch(COMMERCE);
  expect(html).not.toMatch(PRICES);
  expect(html).toContain('LUMINARA DIGITAL PTY LTD');
  expect(html).toContain('ABN 90 693 125 281');
  expect(html).toContain('Founded 2025');
}

describe('Play-safe Android legal pages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads only client=android', () => {
    expect(isAndroidPlayClientSearch('?client=android')).toBe(true);
    expect(isAndroidPlayClientSearch('client=android&x=1')).toBe(true);
    expect(isAndroidPlayClientSearch('?client=desktop')).toBe(false);
    expect(isAndroidPlayClientSearch('')).toBe(false);
  });

  it('keeps website terms, and strips prices from the Android terms document', () => {
    expect(TERMS_HTML).toContain('href="/pricing"');
    expect(TERMS_HTML).toContain('Stripe');
    const android = buildTermsHtml({ android: true });
    assertPlaySafe(android);
    expect(android).not.toContain('Stripe');
    expect(android).toContain('does not list prices');
    expect(android).toContain('href="/privacy?client=android"');
    expect(android).toContain('Australian Consumer Law');
  });

  it('serves privacy, contact, and account deletion without a Pricing link', () => {
    const privacy = buildAndroidPrivacyHtml();
    const contact = buildAndroidContactHtml();
    assertPlaySafe(privacy);
    assertPlaySafe(contact);
    assertPlaySafe(DELETE_ACCOUNT_HTML);
    expect(privacy).toContain('Android Keystore AES-256-GCM');
    expect(privacy).toContain('x-provider-key');
    expect(privacy).not.toContain('stay in this browser');
    expect(contact).toContain('mailto:info@luminara.digital');
    expect(contact).toContain('support@luminarasuite.com');
    expect(contact).toContain('does not list prices');
    expect(DELETE_ACCOUNT_HTML).toContain('Delete from the Android app');
    expect(DELETE_ACCOUNT_HTML).toContain('Delete on the website');
    expect(DELETE_ACCOUNT_HTML).toContain('Email support');
    expect(DELETE_ACCOUNT_HTML).toContain('Type DELETE');
    expect(DELETE_ACCOUNT_HTML).toContain('support@luminarasuite.com');
    expect(DELETE_ACCOUNT_HTML).not.toContain('href="/pricing"');
  });

  it('describes Android key storage in the shared privacy policy', () => {
    const keys = PRIVACY_SECTIONS.flatMap((section) => section.bullets || []).join('\n');
    expect(keys).toContain('Android Keystore AES-256-GCM');
    expect(keys).toContain('x-provider-key');
    expect(keys).not.toContain('stay in this browser');
  });

  it('renders the in-app pages without Pricing when the query is set', () => {
    vi.stubGlobal('window', { location: { search: '?client=android' } });
    const terms = renderToStaticMarkup(createElement(LegalPage, { kind: 'terms', onBack: () => {} }));
    const privacy = renderToStaticMarkup(createElement(LegalPage, { kind: 'privacy', onBack: () => {} }));
    const contact = renderToStaticMarkup(createElement(HelpPage, { kind: 'contact', onBack: () => {} }));
    const deletion = renderToStaticMarkup(createElement(DeleteAccountPage));
    for (const html of [terms, privacy, contact, deletion]) assertPlaySafe(html);
    expect(terms).not.toContain('Stripe');
    expect(contact).toContain('support@luminarasuite.com');
    expect(deletion).toContain('Permanently Delete Account');
  });

  it('keeps the website contact page on the marketing chrome', () => {
    vi.stubGlobal('window', { location: { search: '' } });
    const contact = renderToStaticMarkup(createElement(HelpPage, { kind: 'contact', onBack: () => {} }));
    expect(contact).toContain('Pricing');
    expect(contact).toContain('Refunds and cancellation');
  });
});

describe('Play-safe Worker routes', () => {
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  const env = {
    ASSETS: { fetch: async () => new Response('<!doctype html><html><body>app</body></html>', { headers: { 'content-type': 'text/html' } }) },
    ENVIRONMENT: 'test',
  } as unknown as Parameters<typeof worker.fetch>[1];

  async function body(path: string): Promise<string> {
    const res = await worker.fetch(new Request(`https://www.luminarasuite.com${path}`), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    return res.text();
  }

  it('serves the Android query and the deletion URL as plain documents', async () => {
    const terms = await body('/terms?client=android');
    const privacy = await body('/privacy?client=android');
    const contact = await body('/contact?client=android');
    const deletion = await body('/delete-account');
    for (const html of [terms, privacy, contact, deletion]) assertPlaySafe(html);
    const websiteTerms = await body('/terms');
    expect(websiteTerms).toContain('href="/pricing"');
    expect(websiteTerms).toContain('Stripe');
  });
});
