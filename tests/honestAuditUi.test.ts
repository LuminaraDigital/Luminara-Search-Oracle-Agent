import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { brandNameFor, clearRememberedBrand, hostBrandLabel, rememberScrapedBrand } from '../services/audit/brandName';
import { llmsTxtDraft, organizationJsonLd } from '../services/audit/fixPackCopy';
import { AUDIT_WRITE_UNAVAILABLE, writeHostedAuditReport } from '../services/audit/hostedAuditWrite';
import { GroqProvider } from '../services/llm/providers/GroqProvider';
import { configService } from '../services/configService';

describe('brand name from a host', () => {
  afterEach(() => clearRememberedBrand());

  it('strips www and a multi-part TLD', () => {
    expect(hostBrandLabel('www.movida.com.au')).toBe('Movida');
    expect(hostBrandLabel('https://movida.com.au/cars')).toBe('Movida');
    expect(hostBrandLabel('blog.example.com')).toBe('Example');
  });

  it('prefers a scraped title over the host label', () => {
    expect(brandNameFor('www.movida.com.au', 'Movida Car Rental | Hire')).toBe('Movida Car Rental');
    rememberScrapedBrand('https://www.movida.com.au', 'Movida');
    expect(brandNameFor('movida.com.au')).toBe('Movida');
    expect(brandNameFor('other.example.com')).toBe('Example');
  });

  it('rejects a raw host and Www as a name', () => {
    expect(brandNameFor('www.movida.com.au', 'Www')).toBe('Movida');
    expect(brandNameFor('www.movida.com.au', 'Home | Movida')).toBe('Movida');
    expect(brandNameFor('www.movida.com.au', 'https://www.movida.com.au')).toBe('Movida');
  });
});

describe('fix pack copy', () => {
  it('uses the derived name and no invented verification', () => {
    const llms = llmsTxtDraft('www.movida.com.au');
    const schema = organizationJsonLd('www.movida.com.au');
    expect(llms.startsWith('# Movida')).toBe(true);
    expect(schema).toContain('"name": "Movida"');
    expect(`${llms}\n${schema}`).not.toMatch(/Verified|leading solution|verified answer|verified services/i);
    expect(llms).toContain('Fill this in');
    expect(schema).toContain('Fill this in');
  });
});

describe('audit write error copy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the honest sentence and does not name engines', async () => {
    expect(AUDIT_WRITE_UNAVAILABLE).toBe(
      "The AI write-up couldn't be generated this time. Your measured results above are still accurate. Try again.",
    );
    expect(AUDIT_WRITE_UNAVAILABLE).not.toMatch(/NIM|Ollama|Settings|Groq/);
    vi.spyOn(configService, 'getByokKey').mockReturnValue('');
    vi.spyOn(configService, 'getGroqKey').mockReturnValue('proxy');
    vi.spyOn(GroqProvider.prototype, 'generateText').mockRejectedValue(new Error('Groq inference error (500)'));
    await expect(writeHostedAuditReport('prompt', 'system')).rejects.toThrow(AUDIT_WRITE_UNAVAILABLE);
  });
});

describe('free daily cap', () => {
  it('sets staging and production, and the code default, to 3', () => {
    const wrangler = readFileSync('wrangler.jsonc', 'utf8');
    expect(wrangler.match(/"FREE_DAILY_LIMIT": "3"/g)).toHaveLength(3);
    expect(wrangler).not.toContain('"FREE_DAILY_LIMIT": "25"');
    expect(wrangler).not.toContain('"FREE_DAILY_LIMIT": "100"');
    const quota = readFileSync('worker/quotaMiddleware.ts', 'utf8');
    expect(quota).toContain('Number(env.FREE_DAILY_LIMIT || 3)');
  });
});
