import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { brandFromEvidence, brandNameFor, clearRememberedBrand, organizationNameFromJson, rememberScrapedBrand } from '../services/audit/brandName';
import { llmsTxtDraft, organizationJsonLd } from '../services/audit/fixPackCopy';
import { AUDIT_WRITE_UNAVAILABLE, writeHostedAuditReport } from '../services/audit/hostedAuditWrite';
import { GroqProvider } from '../services/llm/providers/GroqProvider';
import { configService } from '../services/configService';

describe('brand name from a host', () => {
  afterEach(() => clearRememberedBrand());

  it('keeps scraped casing and does not title-case the domain', () => {
    expect(brandFromEvidence({ siteName: 'Ray White' })).toBe('Ray White');
    expect(brandFromEvidence({ organizationName: 'McGrath', title: 'Home | Other' })).toBe('McGrath');
    expect(brandFromEvidence({ title: 'Ray White | Real Estate' })).toBe('Ray White');
    expect(brandFromEvidence({
      siteName: 'Ray White',
      organizationName: 'McGrath',
      title: 'Other Brand | Homes',
    })).toBe('Ray White');
    expect(organizationNameFromJson([
      { type: 'RealEstateAgent', rawJson: JSON.stringify({ name: 'Ray White' }) },
    ])).toBe('Ray White');
    expect(brandNameFor('raywhite.com.au')).toBeNull();
    expect(brandNameFor('www.mcgrath.com.au', 'McGrath')).toBe('McGrath');
  });

  it('prefers a scraped title over a remembered name for another host', () => {
    expect(brandNameFor('www.movida.com.au', 'Movida Car Rental | Hire')).toBe('Movida Car Rental');
    rememberScrapedBrand('https://www.movida.com.au', 'Movida');
    expect(brandNameFor('movida.com.au')).toBe('Movida');
    expect(brandNameFor('other.example.com')).toBeNull();
  });

  it('rejects a raw host, Www, and a generic title prefix', () => {
    expect(brandNameFor('www.movida.com.au', 'Www')).toBeNull();
    expect(brandNameFor('www.movida.com.au', 'Home | Movida')).toBeNull();
    expect(brandNameFor('www.movida.com.au', 'https://www.movida.com.au')).toBeNull();
  });
});

describe('fix pack copy', () => {
  it('uses the derived name and no invented verification', () => {
    const llms = llmsTxtDraft('www.movida.com.au');
    const schema = organizationJsonLd('www.movida.com.au');
    expect(llms.startsWith('# movida.com.au')).toBe(true);
    expect(schema).not.toContain('"name"');
    expect(`${llms}\n${schema}`).not.toMatch(/Verified|leading solution|verified answer|verified services/i);
    expect(`${llms}\n${schema}`).not.toContain('Fill this in');
    expect(llms).toContain('Template:');
    const named = llmsTxtDraft('raywhite.com', { siteName: 'Ray White', description: 'Sells homes in Melbourne.', contactUrl: 'https://raywhite.com/contact' });
    expect(named).toContain('# Ray White');
    expect(named).toContain('Sells homes in Melbourne.');
    expect(named).toContain('https://raywhite.com/contact');
    expect(organizationJsonLd('raywhite.com', { siteName: 'Ray White' })).toContain('"name": "Ray White"');
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
