import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditReportArticle } from '../components/audit/AuditReportArticle';
import { EnquiryDeskView } from '../components/suite/EnquiryDeskView';
import { crawlerFixes } from '../services/audit/crawlerFixes';
import { withTopCrawlerMove } from '../services/audit/reportBlocks';
import { plainCustomerReport } from '../services/audit/reportColumnGate';

const failedCrawlerChecks = [
  { id: 'llms_txt', status: 'fail' },
  { id: 'ai_bot_directives', status: 'fail' },
  { id: 'ai_txt', status: 'fail' },
];

const report = [
  '# Luminara: Web search check for example.com',
  '',
  '## 1. One move this week',
  '',
  'Add a public security contact file (security.txt) at the site root.',
  '',
  '## 2. Plain verdict',
  '',
  'The page is reachable.',
].join('\n');

describe('the written report agrees with the top fix', () => {
  it('replaces the one move with the first needed crawler fix when no page finding exists', () => {
    const next = withTopCrawlerMove(report, crawlerFixes(failedCrawlerChecks), false);
    expect(next).toContain('Let crawlers read public pages in robots.txt');
    expect(next).not.toContain('security contact file');
    expect(next).toContain('## 2. Plain verdict');
  });

  it('matches the heading the way the rest of the report does', () => {
    for (const heading of ['## One move this week', '### 1. One move this week:', '## 1. One move this week\r']) {
      const next = withTopCrawlerMove(report.replace('## 1. One move this week', heading), crawlerFixes(failedCrawlerChecks), false);
      expect(next).toContain('Let crawlers read public pages in robots.txt');
      expect(next).not.toContain('security contact file');
    }
  });

  it('keeps the one move when a page finding leads, and when only optional fixes exist', () => {
    expect(withTopCrawlerMove(report, crawlerFixes(failedCrawlerChecks), true)).toBe(report);
    expect(withTopCrawlerMove(report, crawlerFixes([{ id: 'ai_txt', status: 'fail' }]), false)).toBe(report);
  });

  it('lists crawler fixes in the article instead of saying none were recorded', () => {
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: report,
      measured: true,
      findings: [],
      domain: 'example.com',
      crawlerChecks: failedCrawlerChecks,
    }));
    expect(html).not.toContain('No fixes were recorded');
    expect(html).toContain('Add a short page at /llms.txt');
    expect(html).toContain('Optional: add /ai.txt');
  });

  it('still says no fixes were recorded when nothing failed', () => {
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: report,
      measured: true,
      findings: [],
      domain: 'example.com',
    }));
    expect(html).toContain('No fixes were recorded');
  });
});

describe('report copy', () => {
  it('reads as a sentence when a line names the HSTS or CSP header', () => {
    const text = plainCustomerReport('Verify `HSTS` header is sent on all responses.\n\nVerify CSP header restricts script sources.');
    expect(text).toContain('Verify the header that forces the secure version of the site (HSTS) is sent on all responses.');
    expect(text).toContain('Verify the header that controls which scripts can load (CSP) restricts script sources.');
    expect(text).not.toMatch(/Verify doesn't/);
  });

  it('still glosses a missing HSTS the same way', () => {
    expect(plainCustomerReport('The site lacks HSTS and CSP.')).toContain("doesn't force the secure version of the site (HSTS)");
  });

  it('drops an unmeasured claim that a file lifts AI citation trust', () => {
    const text = plainCustomerReport('Add the file. It improves trust signals used by AI citation systems. Check that it opens.');
    expect(text).not.toMatch(/trust signals/i);
    expect(text).toContain('Add the file.');
    expect(text).toContain('Check that it opens.');
  });
});

describe('report copy that stays', () => {
  it('leaves a trust line alone when it only names a file', () => {
    expect(plainCustomerReport('Trust signals such as ai.txt help.')).toContain('ai.txt help');
  });

  it('reads as a sentence after any verb that names the header', () => {
    expect(plainCustomerReport('Ensure CSP blocks unwanted third-party code.')).toContain(
      'Ensure the header that controls which scripts can load (CSP) blocks unwanted third-party code.',
    );
    expect(plainCustomerReport('Make sure a CSP header is set.')).toContain(
      'Make sure the header that controls which scripts can load (CSP) is set.',
    );
    expect(plainCustomerReport('Confirm that HSTS is on.')).toContain(
      'Confirm the header that forces the secure version of the site (HSTS) is on.',
    );
  });

  it('keeps the case of verify mid-sentence', () => {
    expect(plainCustomerReport('Ask your host to verify HSTS is on.')).toContain('to verify the header that forces');
  });
});

describe('Enquiry Desk', () => {
  it('opens empty, with no fake lead and no stage counted', () => {
    const html = renderToStaticMarkup(createElement(EnquiryDeskView));
    expect(html).not.toContain('Sarah Jenkins');
    expect(html).toContain('Load Sample');
  });

  it('stops every outward action for a sample', () => {
    const source = readFileSync('components/suite/EnquiryDeskView.tsx', 'utf8');
    for (const handler of ['handleToggleTakeover', 'handleApproveBooking', 'handleDeclineBooking', 'handleSendRecoveryStep', 'handleSyncTwenty', 'handleRecordStaffOutcome']) {
      const body = source.slice(source.indexOf(`const ${handler} =`));
      expect(body.split('\n')[1]).toContain('stopForSample');
    }
  });
});
