/**
 * One TypeSafe Jev call per audit. A miss, a 429, a 529, or a timeout leaves the
 * audit as it was. This module does not write KV.
 */
import type { AuditFinding, ScrapedPageEvidence } from '../agentCore/types';
import { healthScoreFromFindings } from '../agentCore/auditEvidenceGate';
import type { LlmCrawlerCheck } from './llmCrawlerReadiness';
import { brandCandidates, brandFromEvidence } from './brandName';
import { llmsTxtDraft, organizationJsonLd } from './fixPackCopy';

export const JEV_MODEL = 'jev-latest';
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_TIMEOUT_MS = 3000;
export const JEV_NOUL_MIN = 0.6;

const NOT_MEASURED = 'Not measured. The evidence check did not support this finding.';
const EXCERPT_CHARS = 400;

export interface JevPage {
  url: string;
  status?: number | null;
  excerpt?: string | null;
  headers?: Record<string, string> | null;
}

export interface JevFile {
  url: string;
  status?: number | string | null;
  excerpt?: string | null;
}

export interface JevClaim {
  id: string;
  claim: string;
}

export interface JevVerdict {
  ok: boolean;
  calls: number;
  latencyMs: number;
  downgradedIds: string[];
  siteType: string | null;
  brandSupported: boolean | null;
  brandChoice: string | null;
}

export interface JevLogLine {
  event: 'jev_verify';
  calls: number;
  latencyMs: number;
  findingCount: number;
  downgraded: number;
  ok: boolean;
}

type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

const SITE_CRITERIA = {
  real_estate_agency: 'A real estate agency with more than one agent',
  individual_agent: 'A single real estate agent',
  developer: 'A property developer',
  property_management: 'A property manager',
  other: 'None of those',
} as const;

function clip(value: string | null | undefined, max = EXCERPT_CHARS): string {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeHeaders(headers: Record<string, string> | null | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const contentType = headers['content-type'] || headers['Content-Type'];
  return contentType ? { 'content-type': contentType.slice(0, 80) } : undefined;
}

export function jevState(pages: readonly JevPage[], files: readonly JevFile[]): {
  pages: Array<{ url: string; status: number | null; excerpt: string; headers?: Record<string, string> }>;
  files: Array<{ url: string; status: number | string | null; excerpt: string }>;
} {
  return {
    pages: pages.slice(0, 6).map((page) => {
      const headers = safeHeaders(page.headers);
      return {
        url: clip(page.url, 200),
        status: typeof page.status === 'number' ? page.status : null,
        excerpt: clip(page.excerpt),
        ...(headers ? { headers } : {}),
      };
    }),
    files: files.slice(0, 6).map((file) => ({
      url: clip(file.url, 200),
      status: file.status ?? null,
      excerpt: clip(file.excerpt, 240),
    })),
  };
}

function questionsFor(
  findings: readonly JevClaim[],
  brandName: string | null,
  candidates: readonly string[],
): Record<string, unknown> {
  const questions: Record<string, unknown> = {};
  findings.forEach((finding, index) => {
    questions[`finding_${index}`] = {
      type: 'noul',
      instructions: `Is this finding supported by the evidence? ${clip(finding.claim)}`,
    };
  });
  questions.site_type = {
    type: 'choice',
    instructions: 'What kind of site is this?',
    criteria: SITE_CRITERIA,
  };
  if (brandName) {
    questions.brand_name = {
      type: 'noul',
      instructions: `Is the brand name "${clip(brandName, 80)}" correct for this site?`,
    };
  }
  if (candidates.length > 0) {
    const criteria: Record<string, string> = {};
    for (const name of candidates) criteria[name] = name;
    questions.brand_pick = {
      type: 'choice',
      instructions: 'Which of these is the brand name for this site?',
      criteria,
    };
  }
  return questions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function noulOf(answer: unknown): number | null {
  if (!isRecord(answer) || answer.type !== 'noul' || typeof answer.noul !== 'number') return null;
  return answer.noul;
}

function siteChoice(answer: unknown): string | null {
  if (!isRecord(answer) || answer.type !== 'choice' || typeof answer.choice !== 'string') return null;
  if (typeof answer.confidence !== 'number' || answer.confidence < JEV_NOUL_MIN) return null;
  return answer.choice in SITE_CRITERIA ? answer.choice : null;
}

function pickedBrand(answer: unknown, candidates: readonly string[]): string | null {
  if (!isRecord(answer) || answer.type !== 'choice' || typeof answer.choice !== 'string') return null;
  if (typeof answer.confidence !== 'number' || answer.confidence < JEV_NOUL_MIN) return null;
  return candidates.find((name) => name === answer.choice) || null;
}

function failOpen(calls: number, latencyMs: number): JevVerdict {
  return { ok: false, calls, latencyMs, downgradedIds: [], siteType: null, brandSupported: null, brandChoice: null };
}

function logLine(line: JevLogLine, log?: (line: JevLogLine) => void): void {
  if (log) {
    log(line);
    return;
  }
  console.info(JSON.stringify(line));
}

async function relayFetch(url: string, init: RequestInit): Promise<Response> {
  const { isProxyMode, providerFetch } = await import('../apiClient');
  if (!isProxyMode()) return new Response(null, { status: 503 });
  return providerFetch('typesafe', '/v1/systemone', url, init);
}

export async function verifyAuditWithJev(input: {
  pages: readonly JevPage[];
  files: readonly JevFile[];
  findings: readonly JevClaim[];
  brandName: string | null;
  brandCandidates?: readonly string[];
  fetchImpl?: FetchImpl;
  now?: () => number;
  log?: (line: JevLogLine) => void;
}): Promise<JevVerdict> {
  const now = input.now ?? (() => Date.now());
  const findingCount = input.findings.length;
  if (!input.fetchImpl) {
    const { isProxyMode } = await import('../apiClient');
    if (!isProxyMode()) return failOpen(0, 0);
  }
  const fetchImpl = input.fetchImpl ?? relayFetch;
  const started = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(JEV_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: jevState(input.pages, input.files),
        questions: questionsFor(input.findings, input.brandName, input.brandCandidates || []),
      }),
      signal: controller.signal,
    });
  } catch {
    const latencyMs = Math.max(0, now() - started);
    logLine({ event: 'jev_verify', calls: 1, latencyMs, findingCount, downgraded: 0, ok: false }, input.log);
    return failOpen(1, latencyMs);
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = Math.max(0, now() - started);
  if (!response.ok || response.status === 429 || response.status === 529) {
    logLine({ event: 'jev_verify', calls: 1, latencyMs, findingCount, downgraded: 0, ok: false }, input.log);
    return failOpen(1, latencyMs);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    logLine({ event: 'jev_verify', calls: 1, latencyMs, findingCount, downgraded: 0, ok: false }, input.log);
    return failOpen(1, latencyMs);
  }
  const answers = isRecord(parsed) && isRecord(parsed.answers) ? parsed.answers : null;
  if (!answers) {
    logLine({ event: 'jev_verify', calls: 1, latencyMs, findingCount, downgraded: 0, ok: false }, input.log);
    return failOpen(1, latencyMs);
  }

  const downgradedIds: string[] = [];
  input.findings.forEach((finding, index) => {
    const noul = noulOf(answers[`finding_${index}`]);
    if (noul != null && noul < JEV_NOUL_MIN) downgradedIds.push(finding.id);
  });
  const brandNoul = input.brandName ? noulOf(answers.brand_name) : null;
  const verdict: JevVerdict = {
    ok: true,
    calls: 1,
    latencyMs,
    downgradedIds,
    siteType: siteChoice(answers.site_type),
    brandSupported: brandNoul == null ? null : brandNoul >= JEV_NOUL_MIN,
    brandChoice: pickedBrand(answers.brand_pick, input.brandCandidates || []),
  };
  logLine({
    event: 'jev_verify',
    calls: 1,
    latencyMs,
    findingCount,
    downgraded: downgradedIds.length,
    ok: true,
  }, input.log);
  return verdict;
}

export function downgradeUnsupported<T extends Pick<AuditFinding, 'id' | 'description' | 'howWeKnowItFailed' | 'severity'>>(
  findings: readonly T[],
  downgradedIds: readonly string[],
): T[] {
  const drop = new Set(downgradedIds);
  return findings.map((finding) => {
    if (!drop.has(finding.id)) return finding;
    return {
      ...finding,
      id: `${finding.id}-unmeasured`,
      severity: 'low',
      description: NOT_MEASURED,
      howWeKnowItFailed: NOT_MEASURED,
    };
  });
}

export function reviewedHealth(
  previous: number | null,
  findings: readonly { id: string }[],
  ok: boolean,
): number | null {
  if (!ok || previous == null) return previous;
  return healthScoreFromFindings(findings);
}

/**
 * Real-estate checks stay on when a page was fetched.
 * A confident "other" turns them off. No answer leaves them on.
 */
export function includeRealEstateChecks(siteType: string | null | undefined, pageCount: number): boolean {
  if (pageCount <= 0) return false;
  return siteType !== 'other';
}

export function wantsAgencyMentions(siteType: string | null | undefined): boolean {
  return siteType === 'real_estate_agency' || siteType === 'individual_agent';
}

/** Name and description come off the copy when the brand check did not support them. A Jev pick stays. */
export function gateFixSnippet(targetType: string, snippet: string, host: string, confirmedName?: string | null): string {
  const name = (confirmedName || '').trim() || null;
  if (targetType === 'json_ld') return organizationJsonLd(host, name);
  if (targetType === 'llms_txt') return llmsTxtDraft(host, name);
  return snippet;
}

export function displayNameFromVerdict(
  brandName: string | null,
  verdict: Pick<JevVerdict, 'ok' | 'brandSupported' | 'brandChoice'>,
): string | null {
  if (verdict.brandSupported === true && brandName) return brandName;
  if (verdict.brandChoice) return verdict.brandChoice;
  if (!verdict.ok || verdict.brandSupported == null) return brandName;
  return null;
}

export async function reviewFindingsWithJev(input: {
  pages: readonly ScrapedPageEvidence[];
  checks?: readonly LlmCrawlerCheck[];
  findings: AuditFinding[];
  healthScore: number | null;
  searchTitles?: readonly string[];
}): Promise<{ findings: AuditFinding[]; healthScore: number | null; siteType: string | null; brandSupported: boolean | null; displayName: string | null }> {
  const first = input.pages[0];
  const titles = [first?.title, ...(first?.h1s || []), ...(input.searchTitles || [])];
  const candidates = brandCandidates({
    siteName: first?.siteName,
    organizationName: first?.organizationName,
    title: titles.filter((title): title is string => Boolean(title)).join(' | '),
    searchTitles: input.searchTitles,
  });
  const brandName = brandFromEvidence({
    siteName: first?.siteName,
    organizationName: first?.organizationName,
    title: first?.title,
  });
  const pool = brandName && !candidates.some((name) => name.toLowerCase() === brandName.toLowerCase())
    ? [brandName, ...candidates].slice(0, 6)
    : candidates;
  let verdict: JevVerdict;
  try {
    verdict = await verifyAuditWithJev({
      pages: input.pages.map((page) => ({
        url: page.url,
        status: page.httpStatus ?? null,
        excerpt: page.rawTextSnippet,
      })),
      files: (input.checks || []).map((check) => ({
        url: check.label,
        status: check.status,
        excerpt: check.detail,
      })),
      findings: input.findings.map((finding) => ({
        id: finding.id,
        claim: `${finding.title}. ${finding.howWeKnowItFailed}`,
      })),
      brandName,
      brandCandidates: pool,
    });
  } catch {
    verdict = failOpen(0, 0);
  }
  const findings = verdict.ok ? downgradeUnsupported(input.findings, verdict.downgradedIds) : input.findings;
  return {
    findings,
    healthScore: reviewedHealth(input.healthScore, findings, verdict.ok),
    siteType: verdict.siteType,
    brandSupported: verdict.brandSupported,
    displayName: displayNameFromVerdict(brandName, verdict),
  };
}
