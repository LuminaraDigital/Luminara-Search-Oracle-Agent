import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluateLlmCrawlerReadiness, type LlmCrawlerCheck } from '../services/audit/llmCrawlerReadiness';
import { loadCrawlerSnapshot, servedWebPage } from '../worker/llmCrawlerRoute';
import { summarizeProbeCrawl } from '../worker/probeCrawlRoute';
import { crawlerFixes, type CrawlerCheckRow } from '../services/audit/crawlerFixes';
import { buildGuestScoutSummary } from '../services/audit/guestScoutSummary';
import { executiveTranslatorAgent } from '../services/agentCore/agents/executiveTranslatorAgent';
import { ActionableFixList } from '../components/retention/ActionableFixList';

const HOMEPAGE = '<!DOCTYPE html>\n<html lang="en"><head><title>Home</title></head><body><h1>Welcome</h1></body></html>';
const LLMS = '# Example Co\n\n> Example Co sells water filters to homes in Sydney and Melbourne.\n';
const ROBOTS = 'User-agent: *\nAllow: /\n';

type Served = { body: string; status?: number; type?: string; location?: string };

/** Public DNS for the host, then each crawler path answers as given (a missing path is a 404). */
async function crawl(files: Record<string, Served>) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('cloudflare-dns.com')) {
      const answer = url.includes('type=AAAA') ? [] : [{ type: 1, data: '104.21.8.8' }];
      return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200 });
    }
    const file = files[new URL(url).pathname];
    if (!file) return new Response('', { status: 404 });
    const headers: Record<string, string> = { 'content-type': file.type || 'text/plain' };
    if (file.location) headers.Location = file.location;
    return new Response(file.body, { status: file.status || 200, headers });
  });
  const loaded = await loadCrawlerSnapshot('https://aquazerofit.com', fetcher as unknown as typeof fetch);
  if (!loaded.ok) throw new Error(loaded.error);
  return { snapshot: loaded.snapshot, checks: evaluateLlmCrawlerReadiness(loaded.snapshot).checks };
}

function status(checks: readonly CrawlerCheckRow[], id: string): string | undefined {
  return checks.find((check) => check.id === id)?.status;
}

describe('crawler file detection', () => {
  it('reports llms.txt and ai.txt missing when both redirect to the homepage', async () => {
    const { snapshot, checks } = await crawl({
      '/llms.txt': { body: '', status: 301, location: '/' },
      '/ai.txt': { body: '', status: 301, location: '/' },
      '/robots.txt': { body: ROBOTS },
      '/': { body: HOMEPAGE, type: 'text/html; charset=utf-8' },
    });
    expect(snapshot.llmsHttpStatus).toBe(404);
    expect(snapshot.aiHttpStatus).toBe(404);
    expect(status(checks, 'llms_txt')).toBe('fail');
    expect(status(checks, 'ai_txt')).toBe('fail');

    const probe = summarizeProbeCrawl('aquazerofit.com', snapshot);
    expect(probe.llmsPresent).toBe(false);
    expect(probe.aiTxtPresent).toBe(false);
    expect(probe.status).toBe('measured');
  });

  it('treats a web page or an API error served at the file path as missing', async () => {
    const { checks } = await crawl({
      '/llms.txt': { body: '<?xml version="1.0"?><html><body>Not found</body></html>' },
      '/ai.txt': { body: '{"error":"not found"}', type: 'application/json' },
      '/robots.txt': { body: '<div id="root"></div>', type: 'text/plain' },
    });
    expect(status(checks, 'llms_txt')).toBe('fail');
    expect(status(checks, 'ai_txt')).toBe('fail');
    expect(checks.find((check) => check.id === 'ai_bot_directives')?.detail).toMatch(/No robots\.txt was found/);
  });

  it('keeps a bot challenge as not measured, not missing', async () => {
    const { checks } = await crawl({
      '/llms.txt': { body: '<html><title>Just a moment...</title></html>', type: 'text/html' },
      '/robots.txt': { body: ROBOTS },
    });
    expect(status(checks, 'llms_txt')).toBe('not_measured');
  });

  it('still passes real text files', async () => {
    const { checks } = await crawl({
      '/llms.txt': { body: `${LLMS}\nPaste <html> into your template.\n` },
      '/ai.txt': { body: ROBOTS },
      '/robots.txt': { body: ROBOTS },
    });
    expect(status(checks, 'llms_txt')).toBe('pass');
    expect(status(checks, 'llms_structure')).toBe('pass');
    expect(status(checks, 'ai_txt')).toBe('pass');
    expect(servedWebPage('<!-- generated -->\n# Example Co\n')).toBe(false);
  });

  it('reads real files a server mislabels as text/html', async () => {
    const { checks } = await crawl({
      '/llms.txt': { body: LLMS, type: 'text/html; charset=UTF-8' },
      '/robots.txt': { body: 'User-agent: GPTBot\nDisallow: /\n', type: 'text/html' },
    });
    expect(status(checks, 'llms_txt')).toBe('pass');
    expect(status(checks, 'ai_bot_directives')).toBe('fail');
  });
});

describe('summary and fixes read the same check results', () => {
  const rows = (fail: string[], unmeasured: string[] = []): LlmCrawlerCheck[] =>
    (['llms_txt', 'llms_structure', 'ai_bot_directives', 'cite_paths', 'ai_txt'] as const).map((id) => ({
      id,
      label: id,
      detail: '',
      status: fail.includes(id) ? 'fail' : unmeasured.includes(id) ? 'not_measured' : 'pass',
    }));
  const allPass = rows([]);
  const aquaZero = rows(['llms_txt', 'ai_txt'], ['llms_structure']);

  const brief = (crawlerChecks: readonly CrawlerCheckRow[]) => executiveTranslatorAgent.execute(
    'https://aquazerofit.com',
    { passed: 4, total: 4, failed: 0, unmeasured: 0 },
    null,
    [],
    [],
    null,
    () => {},
    null,
    crawlerChecks,
  );

  it('gives each failed file one fix, most serious first, and none for passing rows', () => {
    expect(crawlerFixes(rows(['llms_txt', 'ai_bot_directives', 'cite_paths', 'ai_txt'])).map((fix) => fix.id))
      .toEqual(['fix-robots-txt', 'fix-llms-txt', 'fix-ai-txt']);
    expect(crawlerFixes(rows(['llms_structure'])).map((fix) => fix.title)).toEqual(['Give /llms.txt a title and a short summary']);
    expect(crawlerFixes(allPass)).toEqual([]);
    expect(crawlerFixes(rows([], ['llms_txt', 'ai_txt']))).toEqual([]);
  });

  it('lists a step for each failed file instead of saying all checks passed', async () => {
    const text = await brief(aquaZero);
    expect(text).toContain('4 of 4 checks passed');
    expect(text).toMatch(/AI crawler checks: 2 of 5 passed, 2 failed, 1 not measured/);
    expect(text).toMatch(/1 AI crawler fix is needed/);
    expect(text).toContain('2 steps for the checks that failed');
    expect(text).not.toMatch(/no steps to list|None of the checks this run made found/);
  });

  it('keeps the all-clear when only the optional ai.txt is missing, and lists it as a step', async () => {
    const text = await brief(rows(['ai_txt']));
    expect(text).toContain('None of the checks this run made found a critical gap');
    expect(text).toContain('1 step for the check that failed');
    expect(text).toContain('Optional: add /ai.txt');
  });

  it('keeps the all-clear brief when every check passed', async () => {
    const text = await brief(allPass);
    expect(text).toMatch(/AI crawler checks: 5 of 5 passed/);
    expect(text).toContain('so there are no steps to list');
  });

  it('makes a needed crawler fix the next move, never the optional ai.txt', () => {
    const summary = (checks: LlmCrawlerCheck[]) => buildGuestScoutSummary({
      targetUrl: 'https://aquazerofit.com',
      measurementStatus: 'measured',
      citationRatePercent: 50,
      shareOfVoiceScore: 1,
      healthScore: 85,
      scrapedPageCount: 1,
      serpCount: 2,
      findings: [],
      llmCrawler: { checks },
      hostedRail: 'byok_or_signin',
    }).topFix;
    expect(summary(aquaZero)).toBe('Add a short page at /llms.txt');
    expect(summary(rows(['ai_txt']))).not.toMatch(/ai\.txt/);
  });

  it('lists a fix for each failed row the page findings do not already cover', () => {
    const html = renderToStaticMarkup(createElement(ActionableFixList, {
      domain: 'aquazerofit.com',
      findings: [{ id: 'finding-robots-meta', title: 'Fix robots meta noindex' }],
      crawlerChecks: rows(['llms_txt', 'ai_bot_directives', 'ai_txt']),
    }));
    expect(html).not.toContain('did not record a failed check');
    expect(html).toContain('Fix robots meta noindex');
    expect(html).toContain('Let crawlers read public pages in robots.txt');
    expect(html).toContain('Add a short page at /llms.txt');
    expect(html).toContain('Optional: add /ai.txt');
    expect(html).not.toContain('>/ai.txt<');
  });

  it('still says there is nothing to repair when every row passed', () => {
    const html = renderToStaticMarkup(createElement(ActionableFixList, {
      domain: 'example.com',
      findings: [],
      crawlerChecks: allPass,
    }));
    expect(html).toContain('did not record a failed check');
  });
});
