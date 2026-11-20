import { describe, expect, it } from 'vitest';
import { playbookAuditorAgent } from '../services/agentCore/agents/playbookAuditorAgent';
import type { ScrapedPageEvidence, SerpEvidenceItem } from '../services/agentCore/types';
import { isOrganizationEntityType as fromBrandName } from '../services/audit/brandName';
import { postAuditReflectionService } from '../services/audit/postAuditReflectionService';
import {
  CHECK_IDS,
  CHECK_NAMES,
  MAX_TARGET_URLS,
  MIN_WORDS,
  RESULT_CODES,
  RULE_IDS,
  isHowToType,
  isOrganizationEntityType,
} from '../services/audit/ruleDefinitions';

// Allora CL0-5: one home for rule ids, thresholds and type lists; findings carry ruleId and targetUrls.

const noop = () => {};

function page(overrides: Partial<ScrapedPageEvidence> = {}): ScrapedPageEvidence {
  return {
    url: 'https://acme.com.au/',
    title: 'Acme',
    h1s: ['Acme'],
    schemasFound: [],
    wordCount: 600,
    rawTextSnippet: 'Acme sells widgets to builders across Australia.',
    source: 'patchright',
    ...overrides,
  };
}

const unnamed: SerpEvidenceItem = {
  query: 'best widgets',
  engine: 'tavily',
  title: 'Other brand',
  url: 'https://other.com.au/',
  snippet: 'A different supplier.',
  brandMentioned: false,
};

const schema = (type: string) => ({ type, rawJson: JSON.stringify({ '@type': type }), isValid: true });

describe('ruleDefinitions', () => {
  it('keeps one organization type list, still reachable from brandName', () => {
    expect(fromBrandName).toBe(isOrganizationEntityType);
    for (const t of ['Organization', 'NGOOrganization', 'https://schema.org/Corporation', 'schema:LocalBusiness', 'ProfessionalService', 'RealEstateAgent']) {
      expect(isOrganizationEntityType(t), t).toBe(true);
    }
    for (const t of ['WebSite', 'Dentist', 'Product', '']) expect(isOrganizationEntityType(t), t).toBe(false);
    expect(isHowToType(' HowTo ')).toBe(true);
    expect(isHowToType('HowToStep')).toBe(false);
  });

  it('holds the closed lists from the plan', () => {
    expect(MIN_WORDS).toBe(250);
    expect(MAX_TARGET_URLS).toBe(3);
    expect(Object.keys(CHECK_NAMES).sort()).toEqual([...CHECK_IDS].sort());
    expect(RESULT_CODES).toContain('app_shell');
    expect(RESULT_CODES).toHaveLength(14);
  });
});

describe('auditor findings carry ruleId and targetUrls', () => {
  it('a 30-word page still raises thin content, naming that page', async () => {
    const { findings } = await playbookAuditorAgent.execute(
      'AEO',
      [page({ url: 'https://acme.com.au/about', wordCount: 30, schemasFound: [schema('Organization')] })],
      [unnamed],
      null,
      noop,
    );
    const thin = findings.find((f) => f.id === RULE_IDS.thinContent);
    expect(thin).toMatchObject({ ruleId: RULE_IDS.thinContent, targetUrls: ['https://acme.com.au/about'] });
    expect(thin?.description).toContain(`fewer than ${MIN_WORDS} words`);
  });

  it('every finding names its rule, and no URL list exceeds 3', async () => {
    const pages = [1, 2, 3, 4, 5].map((n) =>
      page({ url: `https://acme.com.au/p${n}`, wordCount: 40 + n, schemasFound: [schema('HowTo')] }),
    );
    const { findings } = await playbookAuditorAgent.execute('AEO', pages, [unnamed], null, noop);
    expect(findings.map((f) => f.id).sort()).toEqual(
      [RULE_IDS.deprecatedHowto, RULE_IDS.schemaOrg, RULE_IDS.thinContent, RULE_IDS.zeroCitations].sort(),
    );
    for (const f of findings) {
      expect(f.ruleId, f.id).toBe(f.id);
      expect((f.targetUrls ?? []).length, f.id).toBeLessThanOrEqual(MAX_TARGET_URLS);
    }
    const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
    expect(byId[RULE_IDS.schemaOrg].targetUrls).toEqual(['https://acme.com.au/']);
    expect(byId[RULE_IDS.deprecatedHowto].targetUrls).toEqual(['https://acme.com.au/p1', 'https://acme.com.au/p2', 'https://acme.com.au/p3']);
    expect(byId[RULE_IDS.thinContent].targetUrls).toHaveLength(3);
    expect(byId[RULE_IDS.zeroCitations].targetUrls).toBeUndefined();
  });

  it('the partial organization finding names only the pages missing the tag', async () => {
    const { findings } = await playbookAuditorAgent.execute(
      'AEO',
      [
        page({ url: 'https://acme.com.au/', schemasFound: [schema('Organization')] }),
        page({ url: 'https://acme.com.au/contact', schemasFound: [schema('WebPage')] }),
      ],
      [{ ...unnamed, brandMentioned: true }],
      null,
      noop,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: RULE_IDS.schemaOrgPartial, targetUrls: ['https://acme.com.au/contact'] });
  });

  it('keeps the health score a clean page always had', async () => {
    const clean = await playbookAuditorAgent.execute(
      'AEO',
      [page({ schemasFound: [schema('Organization')] })],
      [{ ...unnamed, brandMentioned: true }],
      null,
      noop,
    );
    expect(clean.findings).toEqual([]);
    expect(clean.healthScore).toBe(85);
  });
});

describe('reflection uses the shared threshold', () => {
  const lesson = (wordCount: number) =>
    postAuditReflectionService
      .reflectOnAudit({
        domain: 'acme.com.au',
        focus: 'AEO',
        scrapedEvidence: { wordCount, rawTextSnippet: 'Acme widgets', schemasFound: [], hasContent: true },
      } as Parameters<typeof postAuditReflectionService.reflectOnAudit>[0])
      .proceduralLessons.some((l) => l.pattern === `Thin Initial DOM Content (<${MIN_WORDS} words)`);

  it('flags 249 words and not 250', () => {
    expect(lesson(MIN_WORDS - 1)).toBe(true);
    expect(lesson(MIN_WORDS)).toBe(false);
  });
});
