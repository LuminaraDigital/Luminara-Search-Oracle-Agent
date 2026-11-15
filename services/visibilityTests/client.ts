/**
 * Browser side of Visibility Unit Tests. It collects raw answers and sends them to the Worker, which grades them.
 * Own-key checks spend the owner's money, so they run only from a button that says so.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import { configService } from '../configService';
import { OpenRouterProvider } from '../aiProviderService';
import { PROBES, probePrompt, urlsInAnswer } from '../visibility/llmAnswerProbeService';
import { extractDomain } from '../search/searchPlanner';
import type { BusinessDNA } from '../../types';
import type { ScrapedPageEvidence, SerpEvidenceItem } from '../agentCore/types';
import { discoveryQuestion } from './scorer';
import type { CrawlSnapshot, ExpectedFacts, RawAnswer, RawVisibilityRun, ScorecardRow, VisibilitySummary, VisibilityVerdict } from './types';

const SNAPSHOT_PAGES = 6;
const MAX_SEARCH_ANSWERS = 6;
const MAX_QUESTIONS = 3;

export type SavedVisibilityRun = {
  id: string;
  canRegrade: boolean;
  scorerVersion: number;
  currentScorerVersion: number;
  summary: VisibilitySummary | null;
};

export type VisibilityRunResult = { run: SavedVisibilityRun; verdicts: VisibilityVerdict[] };

export function factsFromDna(domain: string, dna: BusinessDNA | null | undefined): ExpectedFacts {
  return {
    brand: dna?.name?.trim() || domain,
    domain,
    suburb: dna?.suburb?.trim() || undefined,
    service: dna?.industry?.trim() || undefined,
    keyFacts: dna?.keyFacts ?? [],
    bannedClaims: dna?.negativeConstraints ?? [],
    confirmed: Boolean(dna?.factsConfirmedAt),
  };
}

function intentOf(query: string): string {
  if (/\bvs\b|compar/i.test(query)) return 'comparative';
  if (/\b(best|top|alternatives?)\b/i.test(query)) return 'commercial';
  return 'informational';
}

/** One question's search rows read as one answer. Sample rows are fixtures and never count. */
export function searchAnswers(rows: readonly SerpEvidenceItem[], measuredAt: number): RawAnswer[] {
  const byQuery = new Map<string, SerpEvidenceItem[]>();
  for (const row of rows) {
    if (row.sample) continue;
    byQuery.set(row.query, [...(byQuery.get(row.query) ?? []), row]);
  }
  return [...byQuery.entries()].slice(0, MAX_SEARCH_ANSWERS).map(([query, group], index) => ({
    id: `search:${index}`,
    kind: 'search',
    engine: group[0].engine,
    provider: 'search',
    model: group[0].engine,
    prompt: query,
    intent: intentOf(query),
    text: group.map((row) => [row.aiOverviewText, row.title, row.snippet].filter(Boolean).join(' ')).join('\n'),
    sources: group.map((row) => row.url),
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    latencyMs: null,
    answeredAt: measuredAt,
  }));
}

export function snapshotFromPages(pages: readonly ScrapedPageEvidence[], fetchedAt: number): CrawlSnapshot | null {
  if (!pages.length) return null;
  return {
    pages: pages.slice(0, SNAPSHOT_PAGES).map((page) => {
      const schemas = page.schemasFound.filter((schema) => schema.isValid);
      return {
        url: page.url,
        title: page.title,
        schemaTypes: schemas.map((schema) => schema.type),
        // A fact that only sits in a hidden label is still on the page, so the label text is read too.
        text: [page.description, ...page.h1s, page.rawTextSnippet, ...schemas.map((schema) => schema.rawJson)].filter(Boolean).join('\n'),
      };
    }),
    fetchedAt,
  };
}

/** Everything here was already collected by the audit, so this check costs nothing extra. */
export function rawRunFromAudit(
  targetUrl: string,
  dna: BusinessDNA | null | undefined,
  rows: readonly SerpEvidenceItem[],
  pages: readonly ScrapedPageEvidence[],
  discovery: readonly SerpEvidenceItem[] = [],
): RawVisibilityRun {
  const domain = extractDomain(targetUrl) || targetUrl;
  const now = Date.now();
  return {
    facts: factsFromDna(domain, dna),
    answers: searchAnswers([...discovery, ...rows], now),
    snapshot: snapshotFromPages(pages, now),
  };
}

export type OwnKeyTarget = { provider: 'openrouter'; model: string };

/**
 * OpenRouter only: its provider uses the pasted key and has no fallback. Groq rotates to a key that may be
 * hosted and walks to other models, so its answers could be paid by us and credited to the wrong model.
 */
export function ownKeyTargets(): OwnKeyTarget[] {
  if (!configService.getByokKey('luminara_openrouter_key')) return [];
  return PROBES.map((probe) => ({ provider: 'openrouter', model: probe.model }));
}

export function ownKeyQuestions(raw: RawVisibilityRun): Array<{ prompt: string; intent: string }> {
  const discovery = discoveryQuestion(raw.facts.service, raw.facts.suburb);
  const byName = `What do you know about ${raw.facts.brand} (${raw.facts.domain})?`;
  return [
    ...(discovery ? [{ prompt: discovery, intent: 'commercial' }] : []),
    { prompt: byName, intent: 'informational' },
  ].slice(0, MAX_QUESTIONS);
}

export async function askOwnModels(raw: RawVisibilityRun, targets: readonly OwnKeyTarget[]): Promise<RawAnswer[]> {
  const questions = ownKeyQuestions(raw);
  const answers: RawAnswer[] = [];
  for (const target of targets) {
    const provider = new OpenRouterProvider();
    for (const question of questions) {
      const base = {
        id: `${target.model}:${raw.answers.length + answers.length}`,
        kind: 'byok_probe' as const,
        engine: target.model,
        provider: target.provider,
        model: target.model,
        prompt: question.prompt,
        intent: question.intent,
      };
      const startedAt = Date.now();
      try {
        const result = await provider.generateText(probePrompt(question.prompt), { model: target.model, temperature: 0, maxTokens: 300, reportCost: true });
        answers.push({
          ...base,
          text: result.text,
          sources: urlsInAnswer(result.text),
          finishReason: result.finishReason,
          inputTokens: result.tokenUsage?.prompt ?? null,
          outputTokens: result.tokenUsage?.completion ?? null,
          costUsd: result.costUsd ?? null,
          latencyMs: Date.now() - startedAt,
          answeredAt: Date.now(),
        });
      } catch {
        answers.push({
          ...base,
          text: '',
          sources: [],
          error: 'The call to this AI failed',
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          latencyMs: Date.now() - startedAt,
          answeredAt: Date.now(),
        });
      }
    }
  }
  return answers;
}

async function postJson<T>(path: string, body: unknown): Promise<T | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The newest saved run for a website, so a past report can show its checks. */
export async function fetchLatestRun(domain: string): Promise<VisibilityRunResult | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const list = await workerFetchWithAuthRetry(`${base}/api/visibility-tests/runs?domain=${encodeURIComponent(domain)}&limit=1&kind=audit`);
    if (!list.ok) return null;
    const [latest] = ((await list.json()) as { runs?: SavedVisibilityRun[] }).runs ?? [];
    if (!latest) return null;
    const detail = await workerFetchWithAuthRetry(`${base}/api/visibility-tests/runs/${latest.id}`);
    return detail.ok ? ((await detail.json()) as VisibilityRunResult) : null;
  } catch {
    return null;
  }
}

export function saveVisibilityRun(raw: RawVisibilityRun): Promise<VisibilityRunResult | null> {
  return postJson<VisibilityRunResult>('/visibility-tests/runs', raw);
}

export function regradeVisibilityRun(runId: string, facts: ExpectedFacts): Promise<VisibilityRunResult | null> {
  return postJson<VisibilityRunResult>(`/visibility-tests/runs/${runId}/regrade`, { facts });
}

export async function fetchScorecard(domain: string): Promise<ScorecardRow[]> {
  const base = apiBase();
  if (!base) return [];
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/visibility-tests/scorecard?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) return [];
    return ((await res.json()) as { scorecard?: ScorecardRow[] }).scorecard ?? [];
  } catch {
    return [];
  }
}
