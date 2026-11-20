import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_MARKDOWN_PAGES, markdownForPath } from '../services/marketing/agentMarkdown';
import { MARKETING_FAQ } from '../services/marketing/marketingFaqContent';
import { HOME_HERO } from '../services/marketing/marketingHeroCopy';
import { REFUND_LINE } from '../services/help/helpPages';
import { FREE_ASK_DAILY, FREE_HOSTED_AUDIT_DAILY, PRACTITIONER, STACK_ROWS, TRUST_ITEMS } from '../services/marketing/marketingPositioning';
import { MARKETING_SHELL_BY_PATH } from '../services/marketing/pageMeta';
import { AI_TXT, LLMS_TXT, ROBOTS_TXT } from '../worker/crawlDocuments';
import { applyMarketingDocument } from '../worker/marketingShell';

const SHELL = `<!DOCTYPE html><html><head><title>Old</title><meta name="description" content="old"></head><body><div id="root"></div></body></html>`;

describe('marketing positioning', () => {
  it('paints one h1, and links markdown from the home and pricing heads', () => {
    for (const path of ['/', '/pricing', '/methodology']) {
      const out = applyMarketingDocument(SHELL, MARKETING_SHELL_BY_PATH[path]);
      expect(out.match(/<h1\b/gi), path).toHaveLength(1);
    }
    const home = applyMarketingDocument(SHELL, MARKETING_SHELL_BY_PATH['/']);
    const pricing = applyMarketingDocument(SHELL, MARKETING_SHELL_BY_PATH['/pricing']);
    expect(home).toContain('rel="alternate" type="text/markdown" href="https://www.luminarasuite.com/index.md"');
    expect(pricing).toContain('rel="alternate" type="text/markdown" href="https://www.luminarasuite.com/pricing.md"');
    expect(home).toContain(HOME_HERO.titleLead);
    expect(HOME_HERO.lede).not.toMatch(/Not measured/);
    expect(HOME_HERO.titleLead).toBe('An AI employee');
  });

  it('serves home, pricing, and MCP markdown, and leaves crawl policy alone', () => {
    expect(markdownForPath('/features.md')).toBeNull();
    expect(markdownForPath('/index.md')).toContain('Kim W. Fulwood');
    expect(markdownForPath('/pricing.md')).toContain('A$79');
    expect(markdownForPath('/mcp.md')).toContain('https://www.luminarasuite.com/api/mcp');
    for (const page of AGENT_MARKDOWN_PAGES) {
      expect(readFileSync(`public${page.path}`, 'utf8')).toBe(page.body);
      expect(page.body).not.toContain('\u2014');
      expect(page.body).not.toContain('\u2013');
      expect(LLMS_TXT).toContain(`https://www.luminarasuite.com${page.path}`);
    }
    expect(ROBOTS_TXT).toContain('Content-Signal: search=yes,ai-train=no,use=reference');
    expect(ROBOTS_TXT.match(/Content-Signal:/g)).toEqual(['Content-Signal:']);
    expect(readFileSync('public/llms.txt', 'utf8')).toBe(LLMS_TXT);
    expect(readFileSync('public/llm.txt', 'utf8')).toBe(LLMS_TXT);
    expect(readFileSync('public/ai.txt', 'utf8')).toBe(AI_TXT);
    expect(readFileSync('public/docs/mcp.html', 'utf8')).toContain('href="https://www.luminarasuite.com/mcp.md"');
  });

  it('keeps the FAQ, the stack, and Kim free of prices and invented proof', () => {
    const questions = MARKETING_FAQ.map((item) => item.question);
    expect(questions).toEqual(expect.arrayContaining([
      'How is it different from asking ChatGPT?',
      'Does the AI make things up?',
      "I'm not technical, will I manage?",
      'Will it change my website?',
      'Is my data safe?',
      'How soon will I see results?',
      'Does it work for my agency?',
    ]));
    const stack = STACK_ROWS.map((row) => `${row.them} ${row.us}`).join('\n');
    expect(stack).not.toMatch(/\$|per month|\/mo\b/i);
    const home = MARKETING_SHELL_BY_PATH['/'].crawlerBody;
    expect(home).toContain(PRACTITIONER.name);
    expect(home).toContain('Melbourne, VIC');
    expect(home).not.toMatch(/<img\b/i);
    expect(home).not.toMatch(/years of experience|testimonial|award/i);
    expect(home.match(/<h1\b/gi)).toBeNull();
  });

  it('matches the Worker daily defaults for the free tier', () => {
    const quota = readFileSync('worker/quotaMiddleware.ts', 'utf8');
    expect(quota).toContain('env.FREE_DAILY_LIMIT || 3');
    expect(quota).toContain('env.ASK_DAILY_LIMIT ?? 10');
    expect(FREE_HOSTED_AUDIT_DAILY).toBe(3);
    expect(FREE_ASK_DAILY).toBe(10);
    expect(TRUST_ITEMS.find((item) => item.title === 'Nothing to cancel')?.body).toBe(REFUND_LINE);
    const wrangler = readFileSync('wrangler.jsonc', 'utf8');
    expect(wrangler).toContain('"FREE_DAILY_LIMIT": "3"');
    expect(wrangler).not.toContain('ASK_DAILY_LIMIT');
  });
});
