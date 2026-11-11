import { describe, expect, it } from 'vitest';
import { buildFixDraft } from '../services/audit/fixDraft';
import { parseFixDraftBody } from '../worker/fixDraftRoute';
import { submitFixDraft } from '../components/audit/FixDraftPanel';

const FILLED = {
  kind: 'suburb_page' as const,
  businessName: 'Harbour and Co',
  agentName: 'Mina Chen',
  suburb: 'Richmond',
  phone: '03 9999 8888',
  address: '12 Harbour Street',
  serviceArea: 'Richmond',
  domain: 'https://harbour.example',
  findingTitle: 'Add a suburb page',
};

describe('fix drafts', () => {
  it('writes only the fields it was given and leaves the rest in brackets', () => {
    const draft = buildFixDraft({ kind: 'about_page', businessName: 'Harbour and Co' });
    expect(draft.markdown).toContain('Harbour and Co');
    expect(draft.markdown).toContain('[Phone]');
    expect(draft.markdown).toContain('[Suburb]');
    expect(draft.markdown).not.toMatch(/\d+\s+reviews|\b#1\b|best agent/i);
    expect(draft.markdown).not.toContain('\u2014');
    expect(draft.markdown).not.toContain('\u2013');
    expect(draft.note).toContain('Nothing was published');
    expect(draft.jsonLd).toBeNull();
  });

  it('omits blank fields from RealEstateAgent JSON-LD and never adds a rating', () => {
    const draft = buildFixDraft({ kind: 'json_ld', businessName: 'Harbour and Co', phone: '03 9999 8888', domain: 'harbour.example' });
    const parsed = JSON.parse(draft.jsonLd || '{}') as Record<string, unknown>;
    expect(parsed['@type']).toBe('RealEstateAgent');
    expect(parsed.name).toBe('Harbour and Co');
    expect(parsed.telephone).toBe('03 9999 8888');
    expect(parsed.url).toBe('https://harbour.example');
    expect(parsed.address).toBeUndefined();
    expect(parsed.aggregateRating).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toMatch(/review/i);
  });

  it('drops an FAQ answer that still has an empty slot', () => {
    const draft = buildFixDraft({ kind: 'faq_block', businessName: 'Harbour and Co', suburb: 'Richmond' });
    const parsed = JSON.parse(draft.jsonLd || '{}') as { mainEntity?: Array<{ name: string }> };
    expect(parsed.mainEntity?.map((item) => item.name)).toEqual(['Where does Harbour and Co work?']);
    expect(draft.markdown).toContain('[Phone]');
  });

  it('refuses a bad kind before any draft is built', () => {
    expect(parseFixDraftBody({ kind: 'publish' }).ok).toBe(false);
    expect(buildFixDraft(FILLED).markdown).toContain('https://harbour.example');
    expect(buildFixDraft({ ...FILLED, domain: 'javascript:alert(1)' }).markdown).not.toContain('javascript:');
  });
});

describe('submitFixDraft', () => {
  it('returns the server error without a draft', async () => {
    const result = await submitFixDraft(async () => new Response(JSON.stringify({ error: 'You have used today\'s 10 questions.' }), { status: 402 }), 'https://example.test', {
      kind: 'suburb_page',
      businessName: '',
      agentName: '',
      suburb: '',
      phone: '',
      address: '',
      serviceArea: '',
      findingTitle: '',
      domain: '',
    });
    expect(result).toEqual({ ok: false, error: 'You have used today\'s 10 questions.' });
  });
});
