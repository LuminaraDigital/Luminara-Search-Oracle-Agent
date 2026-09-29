/**
 * Idea Scout card schema, hostname checks, and continuum rules.
 * Pure: no D1, no fetch, no invented SERP percentages.
 */
import { safePublicHostname } from '../security/publicHostname';

export const FREE_IDEA_CARDS_PER_UTC_DAY = 2;
export const IDEA_SCOUT_SCHEMA_VERSION = 1;
export const MAX_COMPETITOR_URLS = 3;
export const MAX_IDEA_CHARS = 500;
export const MIN_IDEA_CHARS = 8;
export const MAX_NICHE_CHARS = 80;
export const MAX_HEADINGS = 8;
export const IDEA_ID_RE = /^is_[a-f0-9]{16}$/;

const PERCENT_RE = /\d+(?:\.\d+)?\s*%/;
const SCORE_KEY_RE = /percent|percentage|serp|shareofvoice|citationrate|healthscore|score|badgevalue/;

export const SITE_CHECKLIST = [
  { id: 'llms_txt', label: 'llms.txt on the future domain' },
  { id: 'entity_pages', label: 'Entity pages that name the product and who it is for' },
  { id: 'faq', label: 'FAQ in the words a buyer would ask an assistant' },
  { id: 'schema', label: 'Organization or Product schema once a domain exists' },
] as const;

export type SiteChecklistId = (typeof SITE_CHECKLIST)[number]['id'];

export interface CompetitorSnapshot {
  url: string;
  hostname: string;
  title: string | null;
  metaDescription: string | null;
  headings: string[];
  fetchStatus: 'fetched' | 'not_measured';
}

export interface IdeaScoutCard {
  schemaVersion: 1;
  problem: string;
  whoAsksAi: {
    label: 'model_inference';
    persona: string;
    promptPatterns: string[];
  };
  competitorCitation: {
    status: 'not_measured' | 'fetched';
    snapshots: CompetitorSnapshot[];
  };
  contentBets: Array<{ hypothesis: string; label: 'hypothesis' }>;
  siteChecklist: Array<{ id: SiteChecklistId; label: string; status: 'not_measured' }>;
}

export type IdeaScoutFailure = { ok: false; error: string; code: string };

function flattenKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

export function stripPercentageTheater(text: string): string {
  return text.replace(PERCENT_RE, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

export function ideaCardSlot(input: {
  subscribed: boolean;
  byok: boolean;
  usedToday: number;
}): { ok: true; remaining: number | null } | IdeaScoutFailure {
  if (input.byok || input.subscribed) return { ok: true, remaining: null };
  if (input.usedToday >= FREE_IDEA_CARDS_PER_UTC_DAY) {
    return {
      ok: false,
      code: 'IDEA_DAILY_CAP',
      error: `Free accounts can build ${FREE_IDEA_CARDS_PER_UTC_DAY} idea cards per UTC day. Subscribe, or pass your own provider key, to continue today.`,
    };
  }
  return { ok: true, remaining: FREE_IDEA_CARDS_PER_UTC_DAY - input.usedToday - 1 };
}

/** `idea` or `idea_<id>`. Other start payloads return null so audit_ and ref_ stay intact. */
export function parseIdeaStartParam(raw: string | null | undefined): { ideaId?: string } | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  if (/^idea$/i.test(trimmed)) return {};
  if (!/^idea_/i.test(trimmed)) return null;
  const tail = trimmed.slice(5);
  if (IDEA_ID_RE.test(tail)) return { ideaId: tail.toLowerCase() };
  return {};
}

/** Public http(s) URL, or null for localhost, IP literals, credentials, and special-use names. */
export function normalizeCompetitorUrl(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw || PERCENT_RE.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = safePublicHostname(url.hostname);
  if (!host) return null;
  url.hash = '';
  return url.toString();
}

export function parseCompetitorUrls(value: unknown): { ok: true; urls: string[] } | IdeaScoutFailure {
  if (value == null) return { ok: true, urls: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: 'Competitor URLs must be a list of up to 3 public links.', code: 'BAD_COMPETITORS' };
  }
  const urls: string[] = [];
  let filled = 0;
  for (const item of value) {
    if (typeof item !== 'string') {
      return { ok: false, error: 'Each competitor URL must be text.', code: 'BAD_COMPETITORS' };
    }
    if (!item.trim()) continue;
    filled += 1;
    if (filled > MAX_COMPETITOR_URLS) {
      return { ok: false, error: 'Send at most 3 competitor URLs.', code: 'TOO_MANY_COMPETITORS' };
    }
    const url = normalizeCompetitorUrl(item);
    if (!url) {
      return {
        ok: false,
        error: 'Competitor URLs must be public http(s) sites. Local hosts, IP addresses, and special-use names are rejected.',
        code: 'BAD_COMPETITOR',
      };
    }
    if (!urls.includes(url)) urls.push(url);
  }
  return { ok: true, urls };
}

function readText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > max || PERCENT_RE.test(text)) return null;
  return text;
}

export function parseIdeaScoutRequest(body: unknown):
  | { ok: true; idea: string; niche: string | null; competitorUrls: string[]; pulseOptIn: boolean }
  | IdeaScoutFailure {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Send a JSON object with an idea sentence.', code: 'BAD_BODY' };
  }
  const rec = body as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (SCORE_KEY_RE.test(flattenKey(key))) {
      return {
        ok: false,
        error: 'Idea Scout does not accept score or percentage fields.',
        code: 'SCORE_NOT_ACCEPTED',
      };
    }
  }
  const idea = readText(rec.idea, MAX_IDEA_CHARS);
  if (!idea || idea.length < MIN_IDEA_CHARS) {
    return {
      ok: false,
      error: `Describe the idea in ${MIN_IDEA_CHARS}-${MAX_IDEA_CHARS} characters. Leave percentages out. This card does not publish search share.`,
      code: 'BAD_IDEA',
    };
  }
  let niche: string | null = null;
  if (rec.niche != null && String(rec.niche).trim()) {
    niche = readText(rec.niche, MAX_NICHE_CHARS);
    if (!niche) {
      return {
        ok: false,
        error: `Niche must be plain text under ${MAX_NICHE_CHARS} characters, with no percentages.`,
        code: 'BAD_NICHE',
      };
    }
  }
  const competitors = parseCompetitorUrls(rec.competitorUrls);
  if (!competitors.ok) return competitors;
  if (rec.pulseOptIn === true && !niche) {
    return { ok: false, error: 'Niche Pulse needs a niche. Add one, or leave the reminder off.', code: 'PULSE_NEEDS_NICHE' };
  }
  return {
    ok: true,
    idea,
    niche,
    competitorUrls: competitors.urls,
    pulseOptIn: rec.pulseOptIn === true,
  };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function visibleText(fragment: string): string {
  const noTags = fragment.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return stripPercentageTheater(decodeEntities(noTags).replace(/\s+/g, ' '));
}

function metaContent(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = (/\b(?:name|property)\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag)?.[2]
      || /\b(?:name|property)\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag)?.[3]
      || '').toLowerCase();
    if (name !== 'description' && name !== 'og:description') continue;
    const content = /\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    const text = visibleText(content?.[2] || content?.[3] || '');
    if (text) return text.slice(0, 300);
  }
  return null;
}

/** Title, meta description, and a short heading sample. The rest of the page is discarded. */
export function extractPageSample(html: string): { title: string | null; metaDescription: string | null; headings: string[] } {
  const titleRaw = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html)?.[1] || '';
  const title = visibleText(titleRaw).slice(0, 200) || null;
  const headings: string[] = [];
  const re = /<h[1-3]\b[^>]*>([\s\S]{0,500}?)<\/h[1-3]>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && headings.length < MAX_HEADINGS) {
    const text = visibleText(match[1] || '').slice(0, 140);
    if (text) headings.push(text);
  }
  return { title, metaDescription: metaContent(html), headings };
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 3).trim();
}

export function buildIdeaScoutCard(input: {
  idea: string;
  niche: string | null;
  snapshots: CompetitorSnapshot[];
}): IdeaScoutCard {
  const topic = input.niche || 'this idea';
  const anyFetched = input.snapshots.some((row) => row.fetchStatus === 'fetched');
  const card: IdeaScoutCard = {
    schemaVersion: 1,
    problem: `${clip(input.idea, 280)} This restates the idea. It is not a market measurement.`,
    whoAsksAi: {
      label: 'model_inference',
      persona: input.niche
        ? `A buyer comparing options in ${clip(input.niche, 80)}. This is model inference, not a measured audience.`
        : 'A buyer who would ask an assistant about this idea. This is model inference, not a measured audience.',
      promptPatterns: [
        `What should I use for ${clip(topic, 80)}?`,
        `How do people compare options for ${clip(topic, 80)}?`,
      ],
    },
    competitorCitation: {
      status: anyFetched ? 'fetched' : 'not_measured',
      snapshots: input.snapshots.slice(0, MAX_COMPETITOR_URLS),
    },
    contentBets: [
      {
        label: 'hypothesis',
        hypothesis: `Write one page that states the problem ("${clip(input.idea, 90)}") and names who it helps.`,
      },
      {
        label: 'hypothesis',
        hypothesis: `Draft an FAQ a buyer might paste into an assistant about ${clip(topic, 80)}.`,
      },
      {
        label: 'hypothesis',
        hypothesis: 'When a domain exists, add llms.txt, an entity page, and schema. Until then these stay not measured.',
      },
    ],
    siteChecklist: SITE_CHECKLIST.map((item) => ({ id: item.id, label: item.label, status: 'not_measured' as const })),
  };
  return card;
}

function theaterWalk(value: unknown, key: string | null, hits: string[]): void {
  if (key && SCORE_KEY_RE.test(flattenKey(key))) hits.push('score');
  if (typeof value === 'number') {
    if (key !== 'schemaVersion') hits.push('number');
    return;
  }
  if (typeof value === 'string') {
    if (PERCENT_RE.test(value)) hits.push('percent');
    return;
  }
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) theaterWalk(item, null, hits);
    return;
  }
  const rec = value as Record<string, unknown>;
  if (rec.status === 'measured') hits.push('measured');
  for (const [childKey, child] of Object.entries(rec)) theaterWalk(child, childKey, hits);
}

function isCard(value: unknown): value is IdeaScoutCard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const card = value as IdeaScoutCard;
  if (card.schemaVersion !== 1) return false;
  if (typeof card.problem !== 'string' || card.problem.length < MIN_IDEA_CHARS || card.problem.length > 500) return false;
  const who = card.whoAsksAi;
  if (!who || who.label !== 'model_inference' || typeof who.persona !== 'string' || who.persona.length < 8) return false;
  if (!Array.isArray(who.promptPatterns) || who.promptPatterns.length < 1 || who.promptPatterns.length > 4) return false;
  if (who.promptPatterns.some((row) => typeof row !== 'string' || row.length < 8 || row.length > 180)) return false;
  const cite = card.competitorCitation;
  if (!cite || (cite.status !== 'fetched' && cite.status !== 'not_measured') || !Array.isArray(cite.snapshots)) return false;
  if (cite.snapshots.length > MAX_COMPETITOR_URLS) return false;
  const fetched = cite.snapshots.filter((row) => row && row.fetchStatus === 'fetched');
  if (cite.status === 'fetched' && fetched.length === 0) return false;
  if (cite.status === 'not_measured' && fetched.length > 0) return false;
  for (const row of cite.snapshots) {
    if (!row || (row.fetchStatus !== 'fetched' && row.fetchStatus !== 'not_measured')) return false;
    const host = safePublicHostname(row.hostname);
    const url = normalizeCompetitorUrl(row.url);
    if (!host || !url || safePublicHostname(new URL(url).hostname) !== host) return false;
    if (row.title != null && typeof row.title !== 'string') return false;
    if (row.metaDescription != null && typeof row.metaDescription !== 'string') return false;
    if (!Array.isArray(row.headings) || row.headings.length > MAX_HEADINGS) return false;
    if (row.headings.some((heading) => typeof heading !== 'string')) return false;
    if (row.fetchStatus === 'fetched' && !row.title && row.headings.length === 0) return false;
  }
  if (!Array.isArray(card.contentBets) || card.contentBets.length !== 3) return false;
  if (card.contentBets.some((bet) => !bet || bet.label !== 'hypothesis' || typeof bet.hypothesis !== 'string' || bet.hypothesis.length < 8 || bet.hypothesis.length > 280)) {
    return false;
  }
  if (!Array.isArray(card.siteChecklist) || card.siteChecklist.length !== SITE_CHECKLIST.length) return false;
  for (let i = 0; i < SITE_CHECKLIST.length; i++) {
    const item = card.siteChecklist[i];
    const expected = SITE_CHECKLIST[i];
    if (!item || item.id !== expected.id || item.label !== expected.label || item.status !== 'not_measured') return false;
  }
  return true;
}

/**
 * Rejects SERP percentages, score keys, numeric metrics, and measured badges.
 * A fetched page title is not a measured citation, so status "measured" is never valid here.
 */
export function validateIdeaScoutCard(value: unknown): { ok: true; card: IdeaScoutCard } | IdeaScoutFailure {
  const hits: string[] = [];
  theaterWalk(value, null, hits);
  if (hits.includes('percent')) {
    return { ok: false, error: 'Idea Scout cards cannot include percentages or SERP share.', code: 'PERCENT_NOT_ACCEPTED' };
  }
  if (hits.includes('score')) {
    return { ok: false, error: 'Idea Scout cards cannot include score fields.', code: 'SCORE_NOT_ACCEPTED' };
  }
  if (hits.includes('number')) {
    return { ok: false, error: 'Idea Scout cards cannot include numeric metrics. Missing evidence stays not measured.', code: 'NUMERIC_METRIC' };
  }
  if (hits.includes('measured')) {
    return {
      ok: false,
      error: 'Idea Scout does not issue measured badges. A page title is not a citation measurement. Use fetched or not_measured.',
      code: 'MEASURED_NOT_ALLOWED',
    };
  }
  if (!isCard(value)) {
    return {
      ok: false,
      error: 'Card shape is invalid. Need a problem, model-inference prompts, fetched or not_measured competitors, 3 hypotheses, and an unscored checklist.',
      code: 'BAD_SHAPE',
    };
  }
  if (value.competitorCitation.status === 'fetched' && value.competitorCitation.snapshots.every((row) => row.fetchStatus !== 'fetched')) {
    return { ok: false, error: 'Fetched competitor status needs a page title or heading sample.', code: 'FETCHED_WITHOUT_EVIDENCE' };
  }
  return { ok: true, card: value };
}

function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function sketchWho(value: unknown): IdeaScoutCard['whoAsksAi'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (rec.label !== 'model_inference' || typeof rec.persona !== 'string' || !Array.isArray(rec.promptPatterns)) return null;
  const persona = stripPercentageTheater(rec.persona);
  const promptPatterns = rec.promptPatterns
    .filter((row): row is string => typeof row === 'string')
    .map((row) => stripPercentageTheater(row))
    .filter((row) => row.length >= 8)
    .slice(0, 4);
  if (persona.length < 8 || promptPatterns.length < 1) return null;
  return { label: 'model_inference', persona, promptPatterns };
}

function sketchBets(value: unknown): IdeaScoutCard['contentBets'] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const bets: IdeaScoutCard['contentBets'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const rec = item as Record<string, unknown>;
    if (rec.label !== 'hypothesis' || typeof rec.hypothesis !== 'string') return null;
    const hypothesis = stripPercentageTheater(rec.hypothesis);
    if (hypothesis.length < 8 || hypothesis.length > 280) return null;
    bets.push({ label: 'hypothesis', hypothesis });
  }
  return bets;
}

/** Drops a model sketch that contains percentage theater or a measured badge. */
export function applyModelSketch(card: IdeaScoutCard, raw: string): IdeaScoutCard {
  if (PERCENT_RE.test(raw) || /"status"\s*:\s*"measured"/i.test(raw)) return card;
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return card;
  const body = parsed as Record<string, unknown>;
  const problem = typeof body.problem === 'string' ? stripPercentageTheater(body.problem) : '';
  const next: IdeaScoutCard = {
    ...card,
    problem: problem.length >= MIN_IDEA_CHARS ? problem : card.problem,
    whoAsksAi: sketchWho(body.whoAsksAi) || card.whoAsksAi,
    contentBets: sketchBets(body.contentBets) || card.contentBets,
    competitorCitation: card.competitorCitation,
    siteChecklist: card.siteChecklist,
  };
  const verdict = validateIdeaScoutCard(next);
  return verdict.ok ? verdict.card : card;
}

export function assessContinuumLink(
  body: Record<string, unknown>,
  hostname: (domain: string) => string | null = safePublicHostname,
): { ok: true; domain: string; auditRunId: string | null } | IdeaScoutFailure {
  for (const key of Object.keys(body)) {
    if (SCORE_KEY_RE.test(flattenKey(key))) {
      return { ok: false, error: 'Continuum does not accept score percentages.', code: 'SCORE_NOT_ACCEPTED' };
    }
  }
  const domain = hostname(String(body.domain || ''));
  if (!domain) {
    return { ok: false, error: 'Use a public site hostname. Local and private hosts are rejected.', code: 'BAD_DOMAIN' };
  }
  const status = body.measurementStatus;
  if (status != null && status !== 'measured' && status !== 'not_measured') {
    return { ok: false, error: 'measurementStatus must be measured or not_measured.', code: 'STATUS_NOT_HONEST' };
  }
  if (body.callerIsGuest === true && status === 'measured') {
    return { ok: false, error: 'A guest path cannot claim a measured result.', code: 'GUEST_CANNOT_CLAIM_MEASURED' };
  }
  if (status === 'measured' && body.evidencePresent !== true) {
    return { ok: false, error: 'Measured status needs evidence. Missing evidence stays not_measured.', code: 'MEASURED_WITHOUT_EVIDENCE' };
  }
  let auditRunId: string | null = null;
  if (body.auditRunId != null && String(body.auditRunId).trim()) {
    const raw = String(body.auditRunId).trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(raw)) {
      return { ok: false, error: 'auditRunId must be the id of a scout run, not a score.', code: 'BAD_RUN_ID' };
    }
    auditRunId = raw;
  }
  return { ok: true, domain, auditRunId };
}

/** Existing Instant Audit deep link. Null when the host is not public. */
export function continuumAuditStartParam(domain: string): string | null {
  const host = safePublicHostname(domain);
  if (!host) return null;
  return `audit_${host}`;
}

export function plainPulseField(value: string, max = 120): string {
  return stripPercentageTheater(value.replace(/[*_`[\]]/g, '')).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function formatNichePulseMessage(input: { niche: string; tip: string | null }): string {
  const niche = plainPulseField(input.niche, MAX_NICHE_CHARS) || 'your niche';
  const tip = plainPulseField(input.tip || '') || 'Open Idea Scout and write the question a buyer would ask an assistant.';
  return [
    '*Niche Pulse*',
    `Niche: ${niche}`,
    `Tip: ${tip}`,
    '',
    'This is one hypothesis, not a ranking. No share of search is included.',
    'Ask /pulse again when you want this reminder. The bot does not send it on a schedule yet.',
  ].join('\n');
}
