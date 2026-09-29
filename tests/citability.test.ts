import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluateLlmCrawlerReadiness,
  unevaluatedLlmCrawlerReport,
} from '../services/audit/llmCrawlerReadiness';
import { suiteCitabilityChecklist } from '../services/audit/suiteCitabilityChecklist';
import { LLMS_TXT, ROBOTS_TXT } from '../worker/crawlDocuments';
import { parseTeaserCreateBody, TEASER_CRAWLER_CHECK_LIMIT } from '../worker/shareService';

const noScore = (value: unknown) => {
  const blob = JSON.stringify(value);
  expect(blob).not.toMatch(/\d+\s*\/\s*100/);
  expect(blob).not.toMatch(/\d+(?:\.\d+)?\s*(?:%|percent)/i);
  expect(blob).not.toContain('\u2014');
};

describe('deeper LLM crawler lens', () => {
  it('keeps every row not_measured until files are fetched', () => {
    const report = unevaluatedLlmCrawlerReport();
    expect(report.checks.map((check) => check.id)).toEqual([
      'llms_txt',
      'llms_structure',
      'ai_bot_directives',
      'cite_paths',
      'ai_txt',
    ]);
    expect(report.checks.every((check) => check.status === 'not_measured')).toBe(true);
    noScore(report);
  });

  it('fails structure when a present llms.txt has no summary', () => {
    const report = evaluateLlmCrawlerReadiness({
      llmsTxt: '# Product\n\n## Docs\n',
      llmsHttpStatus: 200,
      robotsTxt: 'User-agent: *\nAllow: /\n',
      robotsHttpStatus: 200,
      aiTxt: null,
      aiHttpStatus: null,
    });
    expect(report.checks.find((check) => check.id === 'llms_structure')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'llms_structure')?.detail).toContain('short summary');
    expect(report.checks.find((check) => check.id === 'llms_structure')?.detail).toContain('not a score');
    noScore(report);
  });

  it('fails a cite path that hides llms.txt while the homepage stays open', () => {
    const report = evaluateLlmCrawlerReadiness({
      llmsTxt: '# Product\n\n> A short summary that agents can quote from the file.\n',
      llmsHttpStatus: 200,
      robotsTxt: 'User-agent: *\nAllow: /\nDisallow: /llms.txt\n',
      robotsHttpStatus: 200,
      aiTxt: 'Allow: *\n',
      aiHttpStatus: 200,
    });
    expect(report.checks.find((check) => check.id === 'ai_bot_directives')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'cite_paths')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'cite_paths')?.detail).toContain('/llms.txt');
    expect(report.checks.find((check) => check.id === 'ai_txt')?.status).toBe('pass');
    noScore(report);
  });

  it('lets a longer Allow win over a root Disallow for /llms.txt', () => {
    const report = evaluateLlmCrawlerReadiness({
      llmsTxt: '# Product\n\n> A short summary that agents can quote from the file.\n',
      llmsHttpStatus: 200,
      robotsTxt: 'User-agent: GPTBot\nDisallow: /\nAllow: /llms.txt\n\nUser-agent: *\nAllow: /\n',
      robotsHttpStatus: 200,
    });
    const detail = report.checks.find((check) => check.id === 'cite_paths')?.detail || '';
    expect(detail).toContain('GPTBot at /');
    expect(detail).not.toContain('GPTBot at /llms.txt');
    expect(report.checks.find((check) => check.id === 'ai_txt')?.status).toBe('not_measured');
  });

  it('records a missing optional ai.txt as fail and a fetch error as not_measured', () => {
    const missing = evaluateLlmCrawlerReadiness({
      llmsTxt: null,
      llmsHttpStatus: null,
      robotsTxt: null,
      robotsHttpStatus: null,
      aiTxt: '',
      aiHttpStatus: 404,
    });
    expect(missing.checks.find((check) => check.id === 'ai_txt')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('not a citation score'),
    });

    const errored = evaluateLlmCrawlerReadiness({
      llmsTxt: null,
      llmsHttpStatus: null,
      robotsTxt: null,
      robotsHttpStatus: null,
      aiTxt: null,
      aiHttpStatus: 503,
    });
    expect(errored.checks.find((check) => check.id === 'ai_txt')?.status).toBe('not_measured');
    noScore(missing);
  });

  it('passes Suite llms.txt structure and robots cite paths', () => {
    const report = evaluateLlmCrawlerReadiness({
      llmsTxt: LLMS_TXT,
      llmsHttpStatus: 200,
      robotsTxt: ROBOTS_TXT,
      robotsHttpStatus: 200,
      aiTxt: '',
      aiHttpStatus: 404,
    });
    expect(report.checks.find((check) => check.id === 'llms_txt')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'llms_structure')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'ai_bot_directives')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'cite_paths')?.status).toBe('pass');
    expect(report.checks.find((check) => check.id === 'ai_txt')?.status).toBe('fail');
    noScore(report);
  });
});

describe('Suite GEO checklist', () => {
  it('stays not_measured until a probe status is supplied', () => {
    const items = suiteCitabilityChecklist();
    expect(items.map((item) => item.id)).toEqual([
      'suite_llms',
      'suite_robots',
      'suite_sitemap',
      'suite_aeo',
      'suite_honesty',
      'suite_entity',
      'suite_teaser',
    ]);
    expect(items.every((item) => item.status === 'not_measured')).toBe(true);
    expect(items.find((item) => item.id === 'suite_aeo')?.href).toBe('/docs/what-is-aeo.html');
    expect(items.find((item) => item.id === 'suite_honesty')?.href).toContain('#honesty');
    noScore(items);
  });

  it('accepts a probe status and ignores anything else', () => {
    const items = suiteCitabilityChecklist({
      suite_llms: 'pass',
      suite_robots: 'nope' as 'pass',
    });
    expect(items.find((item) => item.id === 'suite_llms')?.status).toBe('pass');
    expect(items.find((item) => item.id === 'suite_robots')?.status).toBe('not_measured');
    expect(items.filter((item) => item.id !== 'suite_llms').every((item) => item.status === 'not_measured')).toBe(true);
  });
});

describe('teaser crawler rows', () => {
  it('keeps the five crawler rows and still stores them as not_measured', () => {
    expect(TEASER_CRAWLER_CHECK_LIMIT).toBeGreaterThanOrEqual(5);
    const ids = ['llms_txt', 'llms_structure', 'ai_bot_directives', 'cite_paths', 'ai_txt'];
    const parsed = parseTeaserCreateBody({
      domain: 'stripe.com',
      verdict: 'AI mention readiness was not measured.',
      topFix: 'Fetch the homepage again.',
      crawlerChecks: [
        ...ids.map((id) => ({ id, label: id, status: 'pass', detail: 'Checked. This is not a score.' })),
        { id: 'row_6', label: 'sixth', status: 'fail', detail: 'Sixth row still fits under the cap.' },
        { id: 'row_7', label: 'seventh', status: 'fail', detail: 'Seventh row still fits under the cap.' },
        { id: 'row_8', label: 'eighth', status: 'fail', detail: 'Eighth row still fits under the cap.' },
        { id: 'row_9', label: 'ninth', status: 'fail', detail: 'Ninth row is past the cap and must be dropped.' },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.crawlerChecks).toHaveLength(TEASER_CRAWLER_CHECK_LIMIT);
    expect(parsed.payload.crawlerChecks.map((check) => check.id)).toEqual([...ids, 'row_6', 'row_7', 'row_8']);
    expect(parsed.payload.crawlerChecks.every((check) => check.status === 'not_measured')).toBe(true);
    expect(JSON.stringify(parsed.payload)).not.toContain('row_9');
  });
});

describe('What is AEO page', () => {
  it('is static HTML with the honesty glossary, method, and teaser note', () => {
    const html = readFileSync('public/docs/what-is-aeo.html', 'utf8');
    expect(html).toContain('<h1>What is AEO?</h1>');
    expect(html).toContain('id="honesty"');
    expect(html).toContain('id="methodology"');
    expect(html).toContain('id="faq"');
    expect(html).toContain('not_measured');
    expect(html).toContain('/share/teaser/');
    expect(html).toContain('FAQPage');
    expect(html).not.toContain('\u2014');
    expect(html).not.toMatch(/\d+(?:\.\d+)?\s*%/);
    expect(html).not.toMatch(/\b\d+\s*\/\s*100\b/);
  });
});
