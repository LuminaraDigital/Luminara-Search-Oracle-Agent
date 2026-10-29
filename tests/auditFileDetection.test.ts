import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluateLlmCrawlerReadiness, servedWebPage } from '../services/audit/llmCrawlerReadiness';
import { loadCrawlerSnapshot } from '../worker/llmCrawlerRoute';
import { summarizeProbeCrawl } from '../worker/probeCrawlRoute';
import { crawlerFixes } from '../services/audit/teaserFailureCodes';
import { executiveTranslatorAgent } from '../services/agentCore/agents/executiveTranslatorAgent';
import { ActionableFixList } from '../components/retention/ActionableFixList';

const HOMEPAGE = '<!DOCTYPE html>\n<html lang="en"><head><title>Home</title></head><body><h1>Welcome</h1></body></html>';
const LLMS = '# Example Co\n\n> Example Co sells water filters to homes in Sydney and Melbourne.\n';
const noop = () => {};

function status(checks: { id: string; status: string }[], id: string): string | undefined {
  return checks.find((check) => check.id === id)?.status;
}

describe('crawler file detection', () => {
  it('treats a homepage served at /llms.txt and /ai.txt as missing, not present', () => {
    const report = evaluateLlmCrawlerReadiness({
      llmsTxt: HOMEPAGE,
      llmsHttpStatus: 200,
      robotsTxt: HOMEPAGE,
      robotsHttpStatus: 200,
      aiTxt: HOMEPAGE,
      aiHttpStatus: 200,
    });
    expect(status(report.checks, 'llms_txt')).toBe('fail');
    expect(status(report.checks, 'llms_structure')).toBe('not_measured');
    expect(status(report.checks, 'ai_txt')).toBe('fail');
    expect(report.checks.find((check) => check.id === 'ai_bot_directives')?.detail).toMatch(/No robots\.txt was found/);
  });

  it('still passes a real llms.txt, including one that quotes an HTML tag further down', () => {
    expect(servedWebPage(`${LLMS}\nPaste <html> into your template.\n`)).toBe(false);
    expect(servedWebPage('  <!-- cached -->\n<html><body></body></html>')).toBe(true);
    const report = evaluateLlmCrawlerReadiness({
      llmsTxt: LLMS,
      llmsHttpStatus: 200,
      robotsTxt: 'User-agent: *\nAllow: /\n',
      robotsHttpStatus: 200,
      aiTxt: 'User-agent: *\nAllow: /\n',
      aiHttpStatus: 200,
    });
    expect(status(report.checks, 'llms_txt')).toBe('pass');
    expect(status(report.checks, 'llms_structure')).toBe('pass');
    expect(status(report.checks, 'ai_txt')).toBe('pass');
  });

  it('follows a same-site redirect to the homepage and reports the file missing', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) {
        const answer = url.includes('type=AAAA') ? [] : [{ type: 1, data: '104.21.8.8' }];
        return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200 });
      }
      if (url.endsWith('/llms.txt') || url.endsWith('/ai.txt')) {
        return new Response(null, { status: 301, headers: { Location: '/' } });
      }
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /\n', { status: 200 });
      return new Response(HOMEPAGE, { status: 200, headers: { 'content-type': 'text/html' } });
    });
    const loaded = await loadCrawlerSnapshot('https://aquazerofit.com', fetcher as unknown as typeof fetch);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const report = evaluateLlmCrawlerReadiness(loaded.snapshot);
    expect(status(report.checks, 'llms_txt')).toBe('fail');
    expect(status(report.checks, 'ai_txt')).toBe('fail');

    const probe = summarizeProbeCrawl('aquazerofit.com', loaded.snapshot);
    expect(probe.llmsPresent).toBe(false);
    expect(probe.aiTxtPresent).toBe(false);
    expect(probe.note).toContain('llms.txt missing');
    expect(probe.note).not.toMatch(/llms\.txt found|ai\.txt found/);
    expect(probe.status).toBe('measured');
  });
});

describe('summary and fixes read the same check results', () => {
  const crawlerChecks = [
    { id: 'llms_txt', status: 'fail' },
    { id: 'llms_structure', status: 'not_measured' },
    { id: 'ai_bot_directives', status: 'pass' },
    { id: 'cite_paths', status: 'pass' },
    { id: 'ai_txt', status: 'fail' },
  ];

  it('gives every failed crawler row a fix and no passing row one', () => {
    expect(crawlerFixes(crawlerChecks).map((fix) => fix.id)).toEqual(['fix-llms-txt', 'fix-ai-txt']);
    expect(crawlerFixes([{ id: 'llms_txt', status: 'pass' }, { id: 'llms_structure', status: 'fail' }]).map((fix) => fix.title))
      .toEqual(['Give /llms.txt a title and a short summary']);
    expect(crawlerFixes(crawlerChecks.map((check) => ({ ...check, status: 'pass' })))).toEqual([]);
  });

  it('does not say all checks passed with nothing to fix when AI file checks failed', async () => {
    const brief = await executiveTranslatorAgent.execute(
      'https://aquazerofit.com',
      { passed: 4, total: 4, failed: 0, unmeasured: 0 },
      null,
      [],
      [],
      null,
      noop,
      null,
      crawlerChecks,
    );
    expect(brief).toContain('4 of 4 checks passed');
    expect(brief).toContain('AI file checks: 2 of 5 passed, 2 failed, 1 not measured.');
    expect(brief).toContain('2 AI file checks failed.');
    expect(brief).toContain('2 steps for the checks that failed');
    expect(brief).toContain('Add a short page at /llms.txt');
    expect(brief).not.toMatch(/no steps to list|None of the checks this run made found/);
  });

  it('keeps the all-clear brief when every check passed', async () => {
    const brief = await executiveTranslatorAgent.execute(
      'https://example.com',
      { passed: 4, total: 4, failed: 0, unmeasured: 0 },
      null,
      [],
      [],
      null,
      noop,
      null,
      crawlerChecks.map((check) => ({ ...check, status: 'pass' })),
    );
    expect(brief).toContain('AI file checks: 5 of 5 passed.');
    expect(brief).toContain('All 4 checks this run made passed, so there are no steps to list.');
  });

  it('lists a fix for each failed crawler row when the page findings are empty', () => {
    const html = renderToStaticMarkup(createElement(ActionableFixList, {
      domain: 'aquazero.example',
      findings: [],
      crawlerChecks,
    }));
    expect(html).not.toContain('did not record a failed check');
    expect(html).toContain('Add a short page at /llms.txt');
    expect(html).toContain('Add an optional /ai.txt');
    expect(html).not.toContain('robots.txt');
  });

  it('still says there is nothing to repair when every row passed', () => {
    const html = renderToStaticMarkup(createElement(ActionableFixList, {
      domain: 'example.com',
      findings: [],
      crawlerChecks: crawlerChecks.map((check) => ({ ...check, status: 'pass' })),
    }));
    expect(html).toContain('did not record a failed check');
  });
});
