import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HelpPage } from '../components/help/HelpPage';
import { optionalPortalUrl } from '../services/audit/agencyProfile';
import { auditIdFromHash, auditReportHash } from '../services/audit/auditReportUrl';
import { cleanPlace } from '../services/audit/freeAiAnswer';
import { focusLabel, focusTip } from '../services/audit/focusLabel';
import { CONTACT_CRAWLER, FAQ_CRAWLER, REFUND_LINE } from '../services/help/helpPages';
import { MARKETING_SHELL_BY_PATH, marketingShellKey } from '../services/marketing/pageMeta';
import { resolveAppView } from '../utils/marketingRoutes';
import { AppView } from '../types';
import { SITEMAP_XML } from '../worker/crawlDocuments';
import { injectMarketingMeta } from '../worker/marketingShell';

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">';

describe('help pages', () => {
  it('serves faq, contact and privacy on the marketing shell', () => {
    expect(resolveAppView('/faq', '')).toBe(AppView.FAQ);
    expect(resolveAppView('/contact/', '')).toBe(AppView.CONTACT);
    expect(resolveAppView('/privacy', '')).toBe(AppView.PRIVACY);
    expect(marketingShellKey('/faq/')).toBe('/faq');
    expect(marketingShellKey('/contact.html')).toBe('/contact');
    expect(marketingShellKey('/privacy-policy')).toBe('/privacy');
    expect(FAQ_CRAWLER).toContain('How Luminara works');
    expect(FAQ_CRAWLER).toContain(REFUND_LINE);
    expect(CONTACT_CRAWLER).toContain('mailto:info@luminara.digital');
    expect(CONTACT_CRAWLER).toContain('There is no phone line.');
    expect(MARKETING_SHELL_BY_PATH['/faq'].crawlerBody).toBe(FAQ_CRAWLER);
    expect(MARKETING_SHELL_BY_PATH['/contact'].crawlerBody).toBe(CONTACT_CRAWLER);
    expect(MARKETING_SHELL_BY_PATH['/privacy'].crawlerBody).toContain('Privacy Policy');
    expect(MARKETING_SHELL_BY_PATH['/privacy'].crawlerBody).toContain('LUMINARA DIGITAL PTY LTD');
    expect(MARKETING_SHELL_BY_PATH['/privacy'].crawlerBody).toContain('ABN 90 693 125 281');
    const shell = `<!DOCTYPE html><html><head>${VIEWPORT}<title>Old</title></head><body></body></html>`;
    const faqHtml = injectMarketingMeta(shell, MARKETING_SHELL_BY_PATH['/faq']);
    expect(faqHtml).toContain('viewport-fit=cover');
    expect(faqHtml).toContain('ABN 90 693 125 281');
    expect(faqHtml).toContain('<title>FAQ | Luminara Suite</title>');
    const joined = `${FAQ_CRAWLER}${CONTACT_CRAWLER}${MARKETING_SHELL_BY_PATH['/privacy'].crawlerBody}`;
    expect(joined).not.toMatch(/0402|0422|GST/i);
    expect(SITEMAP_XML).toContain('https://www.luminarasuite.com/faq');
    expect(SITEMAP_XML).toContain('https://www.luminarasuite.com/contact');

    const faq = renderToStaticMarkup(createElement(HelpPage, { kind: 'faq', onBack: () => {} }));
    const contact = renderToStaticMarkup(createElement(HelpPage, { kind: 'contact', onBack: () => {} }));
    expect(faq).toContain('Start free');
    expect(faq).toContain('How Luminara works');
    expect(faq).toContain('LUMINARA DIGITAL PTY LTD (ABN 90 693 125 281)');
    expect(contact).toContain('mailto:info@luminara.digital');
    expect(contact).toContain('There is no phone line.');
    expect(contact).toContain('Email support');
    expect(`${faq}${contact}`).not.toMatch(/0402|0422|GST/i);
    expect(readFileSync('index.html', 'utf8')).toContain(VIEWPORT);
  });

  it('keeps a measured-win report address and a plain focus name', () => {
    expect(auditReportHash('audit 1')).toBe('#instant_audit/audit%201');
    expect(auditIdFromHash('#instant_audit/audit%201')).toBe('audit 1');
    expect(auditIdFromHash('#instant_audit')).toBe('');
    expect(resolveAppView('/', '#instant_audit/audit%201')).toBe(AppView.INSTANT_AUDIT);
    expect(focusLabel('AEO')).toBe('Answer engines');
    expect(focusTip('GEO')).toBe('GEO: AI answers');
    expect(cleanPlace('Richmond, South Yarra')).toBe('Richmond, South Yarra');
    expect(optionalPortalUrl('', 'realestate.com.au')).toBe('');
    expect(optionalPortalUrl('https://www.realestate.com.au/agency/example', 'realestate.com.au')).toContain('realestate.com.au');
    expect(optionalPortalUrl('https://evil.example/agency', 'realestate.com.au')).toBeNull();
    expect(readFileSync('components/audit/ReportDisplay.tsx', 'utf8')).not.toContain('share is a paid unlock');
    expect(readFileSync('components/ApiKeyModal.tsx', 'utf8')).toContain('Advanced (for developers)');
    expect(readFileSync('components/settings/NotificationsPanel.tsx', 'utf8')).toContain('Weekly Telegram briefing');
  });
});
