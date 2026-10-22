import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTACT_HTML, FAQ_HTML, REFUND_LINE } from '../services/help/helpPages';
import { optionalPortalUrl } from '../services/audit/agencyProfile';
import { auditIdFromHash, auditReportHash } from '../services/audit/auditReportUrl';
import { cleanPlace } from '../services/audit/freeAiAnswer';
import { focusLabel, focusTip } from '../services/audit/focusLabel';
import { resolveAppView } from '../utils/marketingRoutes';
import { AppView } from '../types';
import { maybeServeHelpHtml } from '../worker/marketingShell';
import { SITEMAP_XML } from '../worker/crawlDocuments';

describe('help pages', () => {
  it('serves prerendered faq and contact with the refund line and no phone', () => {
    const faq = maybeServeHelpHtml(new URL('https://www.luminarasuite.com/faq'));
    const contact = maybeServeHelpHtml(new URL('https://www.luminarasuite.com/contact/'));
    expect(faq?.status).toBe(200);
    expect(contact?.status).toBe(200);
    expect(FAQ_HTML).toContain('How Luminara works');
    expect(FAQ_HTML).toContain(REFUND_LINE);
    expect(CONTACT_HTML).toContain('mailto:info@luminara.digital');
    expect(CONTACT_HTML).toContain('There is no phone line.');
    expect(`${FAQ_HTML}${CONTACT_HTML}`).not.toMatch(/0402|0422|telephone/i);
    expect(readFileSync('public/faq.html', 'utf8')).toBe(FAQ_HTML);
    expect(readFileSync('public/contact.html', 'utf8')).toBe(CONTACT_HTML);
    expect(SITEMAP_XML).toContain('https://www.luminarasuite.com/faq');
    expect(SITEMAP_XML).toContain('https://www.luminarasuite.com/contact');
    expect(maybeServeHelpHtml(new URL('https://www.luminarasuite.com/pricing'))).toBeNull();
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
