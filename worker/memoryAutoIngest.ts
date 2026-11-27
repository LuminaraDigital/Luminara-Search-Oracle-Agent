/**
 * Autonomous Agentic Memory & Bi-Temporal Knowledge Graph Ingestion (AMV1).
 *
 * Implements:
 * 1. Letta + Mem0 Self-Editing Semantic Delta Loop (`extractAndStoreChatMemory`):
 *    - Extracts scoped facts (`fact`, `preference`, `decision`, `brand_fact`, `constraint`)
 *    - Detects negative constraints ("never bring up X") and stores high-priority `constraint` facts + edges
 *    - Resolves contradictions by superseding outdated `memory_facts` (`supersedesFactId`)
 *    - Extracts bi-temporal `memory_edges` (`competes_with`, `uses_stack`, `targets_market`, `targets_keyword`, `never_bring_up`)
 * 2. Graphiti / Zep Domain Event Auto-Ingestion:
 *    - `ingestAuditFindingsToGraph`: tracks open and resolved findings as bi-temporal edges
 *    - `ingestWeeklyDecisionToGraph`: tracks weekly priority decisions and supersedes prior week edges
 *    - `ingestDreamProposalToGraph`: bridges Dreaming consolidation into scoped facts and temporal edges
 *
 * No em dashes in copy.
 */
import type { Env } from './env';
import {
  isQuestionLike,
  normalizeMemoryDomain,
  rememberScopedFact,
  upsertTemporalEdge,
  type MemoryFactKind,
  type ScopedMemoryFact,
  type TemporalMemoryEdge,
} from './unifiedMemoryRouter';
import { sanitizePii } from '../services/trust/piiSanitizer';

export interface ChatMemoryExtractionInput {
  accountId: string;
  projectId?: string | null;
  domain?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
  userMessage: string;
  assistantMessage?: string | null;
}

export interface ChatMemoryExtractionResult {
  factsStored: ScopedMemoryFact[];
  factsSuperseded: string[];
  edgesStored: TemporalMemoryEdge[];
}

const NEGATIVE_CONSTRAINT_RE =
  /\b(?:never\s+(?:mention|bring\s+up|suggest|recommend|use|include)|do\s+not\s+(?:mention|bring\s+up|suggest|recommend|use|include)|don't\s+(?:mention|bring\s+up|suggest|recommend|use|include)|avoid\s+(?:mentioning|suggesting|recommending|bringing\s+up)|stop\s+(?:mentioning|suggesting|recommending|bringing\s+up))\s+([^.!?\n]{3,140})/i;

const CORRECTION_CUE_RE =
  /\b(?:actually|instead\s+of|no\s+longer|we\s+switched|we\s+moved\s+from|we\s+migrated\s+from|we\s+replaced|updated\s+our|changed\s+our|not\s+[a-z0-9_.-]+\s+anymore)\b/i;

const PREFERENCE_RE =
  /\b(?:i\s+prefer|we\s+prefer|always\s+use|please\s+always|our\s+tone\s+is|brand\s+voice\s+is|write\s+in\s+a|format\s+responses|keep\s+answers|keep\s+reports)\b/i;

const DECISION_RE =
  /\b(?:we\s+decided|our\s+priority\s+is|this\s+week\s+we\s+will|we\s+are\s+switching\s+to|we\s+moved\s+to|we\s+migrated\s+to|we\s+committed\s+to|our\s+goal\s+is)\b/i;

const BRAND_FACT_RE =
  /\b(?:our\s+(?:domain|website|site|brand|company|product|icp|audience|target\s+market|market|stack|cms|framework|competitor|competitors|pricing|revenue|geo|region)\b|we\s+(?:sell|offer|target|compete\s+with|build|run\s+on|use|operate\s+in|serve))\b/i;

const SLOT_PATTERNS: Array<{ slot: string; regex: RegExp }> = [
  { slot: 'cms_stack', regex: /\b(?:cms|stack|framework|platform|hosted\s+on|run\s+on|moved\s+to|migrated\s+to)\b/i },
  { slot: 'competitor', regex: /\b(?:competitor|compete\s+with)\b/i },
  { slot: 'target_market', regex: /\b(?:target\s+market|icp|audience|region|serve|target)\b/i },
  { slot: 'tone_style', regex: /\b(?:tone|voice|prefer|format)\b/i },
  { slot: 'priority', regex: /\b(?:priority|goal|decided|focus)\b/i },
];

function classifyStatement(sentence: string): {
  kind: MemoryFactKind;
  importance: number;
  confidence: number;
} | null {
  if (NEGATIVE_CONSTRAINT_RE.test(sentence)) {
    return { kind: 'constraint', importance: 0.95, confidence: 0.92 };
  }
  if (DECISION_RE.test(sentence)) {
    return { kind: 'decision', importance: 0.88, confidence: 0.88 };
  }
  if (PREFERENCE_RE.test(sentence)) {
    return { kind: 'preference', importance: 0.85, confidence: 0.88 };
  }
  if (BRAND_FACT_RE.test(sentence)) {
    return { kind: 'brand_fact', importance: 0.8, confidence: 0.85 };
  }
  return null;
}

function detectSlotKey(sentence: string): string | null {
  for (const item of SLOT_PATTERNS) {
    if (item.regex.test(sentence)) return item.slot;
  }
  return null;
}

async function findSupersedeCandidateId(
  env: Env,
  opts: {
    accountId: string;
    projectId: string | null;
    domain: string | null;
    kind: MemoryFactKind;
    sentence: string;
  },
): Promise<string | null> {
  if (!env.DB) return null;
  const hasCorrectionCue = CORRECTION_CUE_RE.test(opts.sentence);
  const slotKey = detectSlotKey(opts.sentence);
  if (!hasCorrectionCue && !slotKey) return null;

  let rows: { results?: Array<{ id: string; text: string; project_id: string | null; domain: string | null }> };
  try {
    rows = slotKey
      ? await env.DB.prepare(
          `SELECT id, text, project_id, domain
           FROM memory_facts
           WHERE account_id = ?
             AND kind IN ('brand_fact', 'decision', 'preference', 'fact')
             AND (status IS NULL OR status = 'active')
           ORDER BY created_at DESC
           LIMIT 30`,
        )
          .bind(opts.accountId)
          .all<{ id: string; text: string; project_id: string | null; domain: string | null }>()
      : await env.DB.prepare(
          `SELECT id, text, project_id, domain
           FROM memory_facts
           WHERE account_id = ?
             AND kind = ?
             AND (status IS NULL OR status = 'active')
           ORDER BY created_at DESC
           LIMIT 25`,
        )
          .bind(opts.accountId, opts.kind)
          .all<{ id: string; text: string; project_id: string | null; domain: string | null }>();
  } catch {
    return null;
  }

  const candidates = (rows.results || []).filter((r) => {
    if (opts.domain && r.domain && r.domain.toLowerCase() !== opts.domain.toLowerCase()) return false;
    if (opts.projectId && r.project_id && r.project_id !== opts.projectId) return false;
    return true;
  });

  if (!candidates.length) return null;

  if (slotKey) {
    const slotMatch = candidates.find((c) => detectSlotKey(c.text) === slotKey && c.text.toLowerCase() !== opts.sentence.toLowerCase());
    if (slotMatch) return slotMatch.id;
  }

  if (hasCorrectionCue) {
    const tokens = opts.sentence
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4);
    for (const cand of candidates) {
      const lower = cand.text.toLowerCase();
      if (lower === opts.sentence.toLowerCase()) continue;
      const overlap = tokens.filter((t) => lower.includes(t)).length;
      if (overlap >= 2) return cand.id;
    }
  }

  return null;
}

function extractRelationshipTriples(
  sentence: string,
  subjectEntity: string,
): Array<{ subjectEntity: string; predicate: string; objectEntity: string; confidence: number }> {
  const triples: Array<{ subjectEntity: string; predicate: string; objectEntity: string; confidence: number }> = [];

  const constraintMatch = sentence.match(NEGATIVE_CONSTRAINT_RE);
  if (constraintMatch?.[1]) {
    triples.push({
      subjectEntity,
      predicate: 'never_bring_up',
      objectEntity: constraintMatch[1].trim().replace(/[.!?]+$/, '').slice(0, 120),
      confidence: 0.92,
    });
  }

  const competitorMatch = sentence.match(
    /(?:our\s+(?:main\s+|primary\s+|top\s+)?competitor\s+is|we\s+compete\s+(?:directly\s+)?with)\s+([A-Za-z0-9._-]{2,60})/i,
  );
  if (competitorMatch?.[1]) {
    triples.push({
      subjectEntity,
      predicate: 'competes_with',
      objectEntity: competitorMatch[1].trim().replace(/[.,!?]+$/, ''),
      confidence: 0.88,
    });
  }

  const stackMatch = sentence.match(
    /(?:our\s+(?:cms|stack|framework|platform)\s+is|we\s+run\s+on|we\s+moved\s+to|we\s+migrated\s+to|we\s+switched\s+to)\s+([A-Za-z0-9._+-]{2,50}(?:\s+[A-Za-z0-9._+-]{2,30})?)/i,
  );
  if (stackMatch?.[1]) {
    triples.push({
      subjectEntity,
      predicate: 'uses_stack',
      objectEntity: stackMatch[1].trim().replace(/[.,!?]+$/, ''),
      confidence: 0.88,
    });
  }

  const marketMatch = sentence.match(
    /(?:we\s+target|our\s+(?:target\s+market|audience|icp|primary\s+region)\s+is)\s+([^.;,?!]{3,70})/i,
  );
  if (marketMatch?.[1]) {
    triples.push({
      subjectEntity,
      predicate: 'targets_market',
      objectEntity: marketMatch[1].trim().replace(/[.,!?]+$/, ''),
      confidence: 0.85,
    });
  }

  const keywordMatch = sentence.match(
    /(?:our\s+(?:primary|main|core|target)\s+keyword\s+is)\s+["']?([^"'.;,?!]{3,60})["']?/i,
  );
  if (keywordMatch?.[1]) {
    triples.push({
      subjectEntity,
      predicate: 'targets_keyword',
      objectEntity: keywordMatch[1].trim(),
      confidence: 0.86,
    });
  }

  return triples;
}

/**
 * Autonomous post-chat semantic delta pass (Letta + Mem0 + Graphiti + GAM).
 */
export async function extractAndStoreChatMemory(
  env: Env,
  input: ChatMemoryExtractionInput,
): Promise<ChatMemoryExtractionResult> {
  const result: ChatMemoryExtractionResult = {
    factsStored: [],
    factsSuperseded: [],
    edgesStored: [],
  };
  if (!env.DB || !input.userMessage?.trim()) return result;

  const projectId = input.projectId?.trim() || null;
  const domain = normalizeMemoryDomain(input.domain);
  const subjectEntity = domain || projectId || 'brand';

  const sentences = input.userMessage
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 14 && s.length <= 360);

  for (const rawSentence of sentences) {
    if (isQuestionLike(rawSentence) && !NEGATIVE_CONSTRAINT_RE.test(rawSentence)) continue;

    const classification = classifyStatement(rawSentence);
    if (!classification) continue;

    const cleanSentence = sanitizePii(rawSentence).sanitized;
    const supersedesFactId = await findSupersedeCandidateId(env, {
      accountId: input.accountId,
      projectId,
      domain,
      kind: classification.kind,
      sentence: cleanSentence,
    });

    const remembered = await rememberScopedFact(env, {
      accountId: input.accountId,
      projectId,
      domain,
      kind: classification.kind,
      text: cleanSentence,
      importance: classification.importance,
      confidence: classification.confidence,
      supersedesFactId,
      source: input.sessionId ? `oracle_chat:${input.sessionId}` : 'oracle_chat',
    });

    if (remembered.ok && remembered.fact) {
      result.factsStored.push(remembered.fact);
      if (remembered.supersededFactId) {
        result.factsSuperseded.push(remembered.supersededFactId);
      }
    }

    const triples = extractRelationshipTriples(cleanSentence, subjectEntity);
    for (const triple of triples) {
      const edgeRes = await upsertTemporalEdge(env, {
        accountId: input.accountId,
        projectId,
        domain,
        subjectEntity: triple.subjectEntity,
        predicate: triple.predicate,
        objectEntity: triple.objectEntity,
        confidence: triple.confidence,
        derivation: 'user',
        sourceRef: (remembered.ok ? remembered.fact.id : null) || input.turnId || input.sessionId || 'oracle_chat',
      });
      if (edgeRes.ok && edgeRes.edge) {
        result.edgesStored.push(edgeRes.edge);
      }
    }

    if (result.factsStored.length >= 4) break;
  }

  if (input.sessionId && result.factsStored.length > 0) {
    const now = Date.now();
    for (const storedFact of result.factsStored) {
      try {
        await env.DB.prepare(
          `INSERT INTO memory_chat_extractions
            (id, account_id, session_id, source_turn_id, fact_text, confidence, status, memory_fact_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'stored', ?, ?)`,
        )
          .bind(
            `mce_${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
            input.accountId,
            input.sessionId,
            input.turnId || null,
            storedFact.text.slice(0, 500),
            storedFact.confidence,
            storedFact.id,
            now,
          )
          .run();
      } catch {
        /* optional extraction log table */
      }
    }
  }

  return result;
}

/**
 * Graphiti Bi-Temporal Auto-Ingestion for Audit Findings (`worker/findingsService.ts`).
 * - Open critical/high findings create active `has_open_finding:<id>` edges.
 * - Resolved (`done` / `wont_fix`) findings close active `has_open_finding:<id>` edges (`valid_to = now`)
 *   and create a `resolved_finding:<id>` edge + `finding_outcome` fact.
 */
export async function ingestAuditFindingsToGraph(
  env: Env,
  input: {
    accountId: string;
    projectId?: string | null;
    domain: string;
    findings: Array<{
      id: string;
      severity: string;
      category: string;
      title: string;
      status: 'open' | 'in_progress' | 'done' | 'wont_fix';
    }>;
  },
): Promise<{ edgesUpdated: number }> {
  if (!env.DB || !input.findings.length) return { edgesUpdated: 0 };
  const domain = normalizeMemoryDomain(input.domain);
  if (!domain) return { edgesUpdated: 0 };

  let edgesUpdated = 0;
  const now = Date.now();

  for (const f of input.findings.slice(0, 15)) {
    const openPredicate = `has_open_finding_${f.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24).toLowerCase()}`;
    if (f.status === 'done' || f.status === 'wont_fix') {
      try {
        await env.DB.prepare(
          `UPDATE memory_edges
           SET valid_to = ?
           WHERE account_id = ? AND LOWER(domain) = LOWER(?) AND predicate = ? AND valid_to IS NULL`,
        )
          .bind(now, input.accountId, domain, openPredicate)
          .run();
      } catch {
        /* ignore pre-0044 missing table */
      }

      const resolvedRes = await upsertTemporalEdge(env, {
        accountId: input.accountId,
        projectId: input.projectId || null,
        domain,
        subjectEntity: domain,
        predicate: `resolved_finding_${f.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24).toLowerCase()}`,
        objectEntity: `[${f.status.toUpperCase()}] (${f.category}) ${f.title}`.slice(0, 180),
        confidence: 0.98,
        derivation: 'verified',
        sourceRef: `finding:${f.id}`,
      });
      if (resolvedRes.ok) edgesUpdated++;

      await rememberScopedFact(env, {
        accountId: input.accountId,
        projectId: input.projectId || null,
        domain,
        kind: 'finding_outcome',
        text: `Audit finding resolved (${f.status}) on ${domain}: [${f.severity.toUpperCase()}] ${f.title}`,
        importance: 0.78,
        confidence: 0.95,
        source: `finding:${f.id}`,
      });
    } else if (f.severity === 'critical' || f.severity === 'high') {
      const openRes = await upsertTemporalEdge(env, {
        accountId: input.accountId,
        projectId: input.projectId || null,
        domain,
        subjectEntity: domain,
        predicate: openPredicate,
        objectEntity: `[${f.severity.toUpperCase()}] (${f.category}) ${f.title}`.slice(0, 180),
        confidence: 0.95,
        derivation: 'verified',
        sourceRef: `finding:${f.id}`,
      });
      if (openRes.ok) edgesUpdated++;
    }
  }

  return { edgesUpdated };
}

/**
 * Graphiti Bi-Temporal Auto-Ingestion for Weekly Decisions (`worker/weeklyDecisionService.ts`).
 */
export async function ingestWeeklyDecisionToGraph(
  env: Env,
  input: {
    accountId: string;
    projectId?: string | null;
    domain: string;
    weekStart: string;
    headline: string;
    actionText: string;
    decisionId?: string;
  },
): Promise<void> {
  if (!env.DB) return;
  const domain = normalizeMemoryDomain(input.domain);
  if (!domain) return;

  await upsertTemporalEdge(env, {
    accountId: input.accountId,
    projectId: input.projectId || null,
    domain,
    subjectEntity: domain,
    predicate: 'active_weekly_decision',
    objectEntity: `[${input.weekStart}] ${input.headline} -> ${input.actionText}`.slice(0, 200),
    confidence: 0.95,
    derivation: 'verified',
    sourceRef: input.decisionId ? `weekly_decision:${input.decisionId}` : `weekly_decision:${input.weekStart}`,
  });
}

/**
 * Graphiti + Mem0 Auto-Ingestion for Dreaming Business Memories (`worker/dreamingService.ts`).
 */
export async function ingestDreamProposalToGraph(
  env: Env,
  input: {
    accountId: string;
    projectId?: string | null;
    domain: string;
    memoryType: string;
    title: string;
    content: string;
    proposalId?: string;
  },
): Promise<void> {
  if (!env.DB) return;
  const domain = normalizeMemoryDomain(input.domain);
  if (!domain) return;

  const kind: MemoryFactKind =
    input.memoryType === 'fix_outcome'
      ? 'finding_outcome'
      : input.memoryType === 'strategy_shift'
        ? 'decision'
        : 'brand_fact';

  await rememberScopedFact(env, {
    accountId: input.accountId,
    projectId: input.projectId || null,
    domain,
    kind,
    text: `[Dream Consolidated - ${input.memoryType}] ${input.title}: ${input.content}`.slice(0, 480),
    importance: 0.82,
    confidence: 0.88,
    source: input.proposalId ? `dream:${input.proposalId}` : 'dream_consolidation',
  });

  await upsertTemporalEdge(env, {
    accountId: input.accountId,
    projectId: input.projectId || null,
    domain,
    subjectEntity: domain,
    predicate: `dream_${input.memoryType.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`,
    objectEntity: `${input.title}: ${input.content.slice(0, 140)}`,
    confidence: 0.88,
    derivation: 'model',
    sourceRef: input.proposalId ? `dream:${input.proposalId}` : 'dream_consolidation',
  });
}
