import { describe, expect, it, vi } from 'vitest';
import type { AuditFinding } from '../services/agentCore/types';
import { organizationJsonLd } from '../services/audit/fixPackCopy';
import {
  JEV_MODEL,
  JEV_URL,
  displayNameFromVerdict,
  downgradeUnsupported,
  gateFixSnippet,
  includeRealEstateChecks,
  jevState,
  reviewFindingsWithJev,
  reviewedHealth,
  verifyAuditWithJev,
  wantsAgencyMentions,
  type JevLogLine,
} from '../services/audit/jevVerifier';
import { tavilyBlocked } from '../services/search/tavilyService';

const EXCERPT = 'PAGE_EXCERPT_DO_NOT_LOG';

function finding(id: string): AuditFinding {
  return {
    id,
    category: 'schema',
    severity: 'critical',
    title: 'Missing Organization markup',
    description: 'Parsed HTML has no Organization schema.',
    evidenceSource: 'DOM',
    howWeKnowItFailed: 'Schema types found: none.',
    leadingIndicator: 'Entity disambiguation.',
    criticVerified: false,
    criticConfidence: 0.9,
  };
}

function answer(noul: number, choice = 'real_estate_agency', confidence = 0.9, brand = 0.91) {
  return {
    model: JEV_MODEL,
    answers: {
      finding_0: { type: 'noul', noul },
      site_type: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } },
      brand_name: { type: 'noul', noul: brand },
    },
  };
}

function clock(start: number, end: number): () => number {
  const times = [start, end];
  let index = 0;
  return () => times[Math.min(index++, times.length - 1)];
}

describe('verifyAuditWithJev', () => {
  it('keeps a supported finding and batches every question into one call', async () => {
    const bodies: unknown[] = [];
    const logs: JevLogLine[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(answer(0.6)), { status: 200 });
    });
    const verdict = await verifyAuditWithJev({
      pages: [{ url: 'https://raywhite.com.au', status: 200, excerpt: EXCERPT, headers: { 'content-type': 'text/html', cookie: 'secret' } }],
      files: [{ url: 'llms.txt', status: 200, excerpt: 'llms body' }],
      findings: [{ id: 'finding-schema-org', claim: 'Organization schema is missing.' }],
      brandName: 'Ray White',
      fetchImpl,
      now: clock(1_000, 1_040),
      log: (line) => logs.push(line),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(JEV_URL);
    expect(verdict.ok).toBe(true);
    expect(verdict.calls).toBe(1);
    expect(verdict.latencyMs).toBe(40);
    expect(verdict.downgradedIds).toEqual([]);
    expect(verdict.siteType).toBe('real_estate_agency');
    expect(verdict.brandSupported).toBe(true);
    const body = bodies[0] as { model: string; questions: Record<string, { type: string }>; state: { pages: Array<{ headers?: Record<string, string> }> } };
    expect(body.model).toBe(JEV_MODEL);
    expect(Object.keys(body.questions).sort()).toEqual(['brand_name', 'finding_0', 'site_type']);
    expect(body.state.pages[0].headers).toEqual({ 'content-type': 'text/html' });
    expect(JSON.stringify(logs)).not.toContain(EXCERPT);
    expect(logs[0]).toEqual({ event: 'jev_verify', calls: 1, latencyMs: 40, findingCount: 1, downgraded: 0, ok: true });
  });

  it('downgrades a finding under 0.6 and withholds the brand fields', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(answer(0.59, 'other', 0.8, 0.2)), { status: 200 }));
    const verdict = await verifyAuditWithJev({
      pages: [],
      files: [],
      findings: [{ id: 'finding-schema-org', claim: 'Organization schema is missing.' }],
      brandName: 'Ray White',
      fetchImpl,
      now: clock(2_000, 2_055),
    });
    const kept = downgradeUnsupported([finding('finding-schema-org')], verdict.downgradedIds);

    expect(verdict.calls).toBe(1);
    expect(verdict.latencyMs).toBe(55);
    expect(verdict.siteType).toBe('other');
    expect(verdict.brandSupported).toBe(false);
    expect(kept[0].id).toBe('finding-schema-org-unmeasured');
    expect(kept[0].title).toBe('Missing Organization markup');
    expect(kept[0].description).toBe('Not measured. The evidence check did not support this finding.');
    expect(kept[0].severity).toBe('low');
    expect(reviewedHealth(73, kept, true)).toBeNull();
    expect(includeRealEstateChecks(verdict.siteType, 1)).toBe(false);
    const jsonLd = gateFixSnippet('json_ld', '{"name":"Ray White"}', 'raywhite.com.au');
    const llms = gateFixSnippet('llms_txt', '# Ray White\n> Sells homes.', 'raywhite.com.au');
    expect(jsonLd).toBe(organizationJsonLd('raywhite.com.au'));
    expect(jsonLd).not.toContain('Ray White');
    expect(jsonLd).not.toContain('"name"');
    expect(llms).not.toContain('Ray White');
    expect(llms).toContain('<Your agency name>');
    expect(llms).not.toContain('Template:');
  });

  it('softens an alarmist title when the evidence check does not support the finding', () => {
    const [kept] = downgradeUnsupported([
      {
        ...finding('finding-thin-content'),
        title: 'Thin Content Detected on Critical Landing Page(s)',
        severity: 'high',
      },
    ], ['finding-thin-content']);
    expect(kept.id).toBe('finding-thin-content-unmeasured');
    expect(kept.title).toBe('Thin content');
    expect(kept.severity).toBe('low');
    expect(kept.description).toBe('Not measured. The evidence check did not support this finding.');
    expect(kept.howWeKnowItFailed).toBe(kept.description);
  });

  it('fail-opens on timeout, 429, and 529 without throwing', async () => {
    const original = [finding('finding-schema-org')];
    const cases = [
      { name: 'timeout', status: 0, latency: 3_000, impl: vi.fn(async () => { throw new Error('aborted'); }) },
      { name: '429', status: 429, latency: 12, impl: vi.fn(async () => new Response('busy', { status: 429 })) },
      { name: '529', status: 529, latency: 18, impl: vi.fn(async () => new Response('overloaded', { status: 529 })) },
    ];
    const latencies: number[] = [];
    for (const item of cases) {
      const verdict = await verifyAuditWithJev({
        pages: [{ url: 'https://example.com', status: 403, excerpt: EXCERPT }],
        files: [],
        findings: [{ id: original[0].id, claim: original[0].title }],
        brandName: 'Ray White',
        fetchImpl: item.impl,
        now: clock(0, item.latency),
        log: (line) => {
          expect(JSON.stringify(line)).not.toContain(EXCERPT);
          expect(line.ok).toBe(false);
          expect(line.downgraded).toBe(0);
        },
      });
      expect(verdict.ok, item.name).toBe(false);
      expect(verdict.calls, item.name).toBe(1);
      expect(verdict.latencyMs, item.name).toBe(item.latency);
      expect(verdict.siteType, item.name).toBeNull();
      expect(verdict.brandSupported, item.name).toBeNull();
      expect(downgradeUnsupported(original, verdict.downgradedIds)).toEqual(original);
      expect(reviewedHealth(73, original, verdict.ok)).toBe(73);
      expect(item.impl).toHaveBeenCalledTimes(1);
      latencies.push(verdict.latencyMs);
    }
    const average = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
    expect(average).toBe((3_000 + 12 + 18) / 3);
    expect(includeRealEstateChecks(null, 2)).toBe(true);
  });

  it('does not call Jev when the worker relay is not in use', async () => {
    const verdict = await verifyAuditWithJev({
      pages: [],
      files: [],
      findings: [],
      brandName: null,
    });
    expect(verdict).toEqual({ ok: false, calls: 0, latencyMs: 0, downgradedIds: [], siteType: null, brandSupported: null, brandChoice: null });
  });

  it('leaves a crew finding list unchanged when the relay is closed', async () => {
    const rows = [finding('finding-schema-org')];
    const reviewed = await reviewFindingsWithJev({
      pages: [],
      findings: rows,
      healthScore: 73,
    });
    expect(reviewed.findings).toBe(rows);
    expect(reviewed.healthScore).toBe(73);
    expect(reviewed.siteType).toBeNull();
    expect(reviewed.brandSupported).toBeNull();
    expect(reviewed.displayName).toBeNull();
  });

  it('asks Jev to pick a brand and uses that choice when the page gave no name', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({
        model: JEV_MODEL,
        answers: {
          finding_0: { type: 'noul', noul: 0.9 },
          site_type: { type: 'choice', choice: 'real_estate_agency', confidence: 0.9 },
          brand_pick: { type: 'choice', choice: 'Ray White', confidence: 0.9 },
        },
      }), { status: 200 });
    });
    const verdict = await verifyAuditWithJev({
      pages: [{ url: 'https://raywhite.com.au', status: 403, excerpt: 'blocked' }],
      files: [],
      findings: [{ id: 'finding-schema-org', claim: 'Organization schema is missing.' }],
      brandName: null,
      brandCandidates: ['Ray White', 'Ray White Real Estate'],
      fetchImpl,
      now: clock(0, 20),
    });
    const body = bodies[0] as { questions: { brand_pick?: { type: string; criteria: Record<string, string> } } };
    expect(body.questions.brand_pick).toEqual({
      type: 'choice',
      instructions: 'Which of these is the brand name for this site?',
      criteria: { 'Ray White': 'Ray White', 'Ray White Real Estate': 'Ray White Real Estate' },
    });
    expect(verdict.brandSupported).toBeNull();
    expect(verdict.brandChoice).toBe('Ray White');
    expect(displayNameFromVerdict(null, verdict)).toBe('Ray White');
    const named = gateFixSnippet('llms_txt', '# raywhite', 'raywhite.com.au', verdict.brandChoice);
    expect(named).toContain('# Ray White');
    expect(named).not.toContain('<Your agency name>');
    expect(named).not.toContain('Template:');
  });

  it('ignores a low-confidence or unknown brand pick and keeps a supported scraped name', async () => {
    const low = await verifyAuditWithJev({
      pages: [],
      files: [],
      findings: [],
      brandName: null,
      brandCandidates: ['Ray White'],
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        answers: { brand_pick: { type: 'choice', choice: 'Ray White', confidence: 0.59 } },
      }), { status: 200 })),
      now: clock(0, 5),
    });
    expect(low.brandChoice).toBeNull();
    expect(displayNameFromVerdict(null, low)).toBeNull();

    const unknown = await verifyAuditWithJev({
      pages: [],
      files: [],
      findings: [],
      brandName: null,
      brandCandidates: ['Ray White'],
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        answers: { brand_pick: { type: 'choice', choice: 'Not a candidate', confidence: 0.99 } },
      }), { status: 200 })),
      now: clock(0, 5),
    });
    expect(unknown.brandChoice).toBeNull();

    const supported = await verifyAuditWithJev({
      pages: [],
      files: [],
      findings: [],
      brandName: 'Ray White',
      brandCandidates: ['Ray White', 'Ray White Real Estate'],
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        answers: {
          brand_name: { type: 'noul', noul: 0.91 },
          brand_pick: { type: 'choice', choice: 'Ray White Real Estate', confidence: 0.95 },
        },
      }), { status: 200 })),
      now: clock(0, 5),
    });
    expect(supported.brandSupported).toBe(true);
    expect(supported.brandChoice).toBe('Ray White Real Estate');
    expect(displayNameFromVerdict('Ray White', supported)).toBe('Ray White');
    expect(displayNameFromVerdict('Ray White', { ok: false, brandSupported: null, brandChoice: null })).toBe('Ray White');
    expect(displayNameFromVerdict('Ray White', { ok: true, brandSupported: false, brandChoice: null })).toBeNull();
  });
});

describe('site type and search block', () => {
  it('keeps real-estate checks for an agency and skips them for other', () => {
    expect(includeRealEstateChecks('real_estate_agency', 1)).toBe(true);
    expect(includeRealEstateChecks('developer', 1)).toBe(true);
    expect(includeRealEstateChecks('property_management', 1)).toBe(true);
    expect(includeRealEstateChecks('other', 1)).toBe(false);
    expect(includeRealEstateChecks('other', 0)).toBe(false);
    expect(wantsAgencyMentions('real_estate_agency')).toBe(true);
    expect(wantsAgencyMentions('individual_agent')).toBe(true);
    expect(wantsAgencyMentions('developer')).toBe(false);
    expect(wantsAgencyMentions(null)).toBe(false);
  });

  it('treats a low-confidence choice as no answer', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(answer(0.9, 'other', 0.59, 0.9)), { status: 200 }));
    const verdict = await verifyAuditWithJev({
      pages: [],
      files: [],
      findings: [{ id: 'finding-schema-org', claim: 'supported' }],
      brandName: 'Ray White',
      fetchImpl,
      now: clock(0, 10),
    });
    expect(verdict.siteType).toBeNull();
    expect(includeRealEstateChecks(verdict.siteType, 1)).toBe(true);
  });

  it('detects a blocked Tavily response', async () => {
    expect(await tavilyBlocked(new Response('', { status: 403 }))).toBe(true);
    expect(await tavilyBlocked(new Response('', { status: 429 }))).toBe(true);
    expect(await tavilyBlocked(new Response(JSON.stringify({ upstreamStatus: 403 }), { status: 503 }))).toBe(true);
    expect(await tavilyBlocked(new Response(JSON.stringify({ code: 'HOSTED_PROVIDER_KEY_REFUSED', upstreamStatus: 401 }), { status: 503 }))).toBe(false);
  });

  it('drops cookie headers from the evidence state', () => {
    const state = jevState(
      [{ url: 'https://a.example', status: 403, excerpt: EXCERPT, headers: { cookie: 'a', 'content-type': 'text/html' } }],
      [{ url: 'robots.txt', status: 429, excerpt: 'blocked' }],
    );
    expect(JSON.stringify(state)).not.toContain('cookie');
    expect(state.pages[0].status).toBe(403);
    expect(state.files[0].status).toBe(429);
  });
});
