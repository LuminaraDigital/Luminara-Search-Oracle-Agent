/**
 * Replit Self-Driving Company Agentic Loop (Phase 7):
 *
 * 1. Review-to-Skill Feedback Compiler (`compileFeedbackIntoSkillRule`):
 *    Converts human review corrections or MCP action denials into scoped negative
 *    constraints (`memory_facts`), bi-temporal `never_bring_up` edges (`memory_edges`),
 *    Dreaming feedback events (`dream_events`), and shared project `writing_preferences`.
 * 2. Agent Habitat Ephemeral Scoped Credentials (`mintHabitatToken`, `identifyHabitatToken`):
 *    Short-lived (`lm_hab_*`) project-scoped capability tokens with a strict risk ceiling
 *    (`read` or `write`, never `destructive`) and TTL enforcement.
 * 3. Agent Habitat Control Plane (`getAgentHabitatStatus`):
 *    Parallelized snapshot of pending `mcp_action_requests`, recent `run_provenance` invocations,
 *    budget status, and compiled review rules.
 * 4. Coasean Cross-Role Handoff Packet (`buildCoaseanHandoffPacket` + `create_dev_ticket_from_finding`):
 *    Collapses cross-team coordination into 3 synchronized role artifacts (Engineering Verified PR
 *    Bundle, Sales/Support Reputation Firewall Brief, and 14-day QA Verification Schedule).
 *
 * No em dashes in copy.
 */
import type { Env } from './env';
import type { HostedIdentity, McpCredential } from './userTypes';
import type { McpToolDef, McpToolResult } from './mcpServer';
import { billingId, json, sha256Hex } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { randomId } from '../services/projects/projectUtils';
import {
  normalizeMemoryDomain,
  recallUnifiedContext,
  rememberScopedFact,
  upsertTemporalEdge,
} from './unifiedMemoryRouter';
import { enqueueDreamEvent } from './dreamingQueue';
import { getProjectContext, updateProjectContext } from './projectContextService';
import { listActionRequests, type ActionRequestRow } from './mcpGovernance';
import { listRunsForAccount, type RunRow } from './runProvenance';
import { getBudgetStatus, type BudgetStatus } from './budgets';
import { getActiveSubscription } from './quotaMiddleware';
import { planCapsFor } from './telegramBot';
import {
  comparisonOutlineDraft,
  llmsTxtDraft,
  organizationJsonLd,
} from '../services/audit/fixPackCopy';
import { brandNameFor, readableStem } from '../services/audit/brandName';
import {
  buildVerifiedRemediationPrBundle,
  type VerifiedPrHandoffBundle,
} from '../services/deployment/remediationTierRouter';

const HABITAT_TOKEN_PREFIX = 'lm_hab_';
const HABITAT_KV_PREFIX = 'hab_token:';

export type HabitatRiskCeiling = 'read' | 'write';

export interface HabitatTokenRecord {
  id: string;
  accountId: string;
  userId: string;
  projectId: string | null;
  domain: string | null;
  maxRisk: HabitatRiskCeiling;
  label: string;
  createdAt: number;
  expiresAt: number;
}

/** In-memory fallback store when LUMINARA_KV is absent in local unit tests. */
const memoryHabitatTokens = new Map<string, HabitatTokenRecord>();

function scrubEmDashes(input: string): string {
  return input.replace(/\u2014/g, '-').replace(/\s+/g, ' ').trim();
}

export interface CompileFeedbackInput {
  accountId: string;
  userId: string;
  domain?: string | null;
  projectId?: string | null;
  reason: string;
  targetToolOrAsset?: string | null;
  sourceRef?: string | null;
}

export interface CompileFeedbackResult {
  ok: true;
  ruleText: string;
  factId: string | null;
  edgeId: string | null;
  dreamEventId: string | null;
  updatedProjectPreferences: boolean;
}

/**
 * Pillar 1: Compiles an operator's review rejection or edit note into durable shared rules
 * across `memory_facts`, `memory_edges`, `dream_events`, and `project_context_sections`.
 */
export async function compileFeedbackIntoSkillRule(
  env: Env,
  input: CompileFeedbackInput,
): Promise<CompileFeedbackResult | { ok: false; error: string; status: number }> {
  const cleanReason = scrubEmDashes(input.reason || '').slice(0, 480);
  if (cleanReason.length < 4) {
    return {
      ok: false,
      error: 'Review reason must be at least 4 characters to compile into a team rule.',
      status: 400,
    };
  }

  let resolvedDomain = normalizeMemoryDomain(input.domain || null);
  let resolvedProjectId = input.projectId?.trim() || null;

  if (env.DB) {
    try {
      if (!resolvedProjectId && resolvedDomain) {
        const projRow = await env.DB.prepare(
          `SELECT id FROM projects WHERE account_id = ? AND domain = ? ORDER BY updated_at DESC LIMIT 1`,
        )
          .bind(input.accountId, resolvedDomain)
          .first<{ id: string }>();
        if (projRow?.id) resolvedProjectId = projRow.id;
      } else if (resolvedProjectId && !resolvedDomain) {
        const domRow = await env.DB.prepare(
          `SELECT domain FROM projects WHERE id = ? AND account_id = ? LIMIT 1`,
        )
          .bind(resolvedProjectId, input.accountId)
          .first<{ domain: string }>();
        const normDom = normalizeMemoryDomain(domRow?.domain || null);
        if (normDom) resolvedDomain = normDom;
      }
    } catch {
      /* schema-safe best-effort lookup */
    }
  }

  const targetPrefix = input.targetToolOrAsset
    ? `[Rule from ${scrubEmDashes(input.targetToolOrAsset).slice(0, 60)}] `
    : '[Compiled Review Rule] ';
  const ruleText = `${targetPrefix}${cleanReason}`;
  const subjectEntity = resolvedDomain || 'workspace';

  const [factRes, edgeRes, dreamRes] = await Promise.all([
    rememberScopedFact(env, {
      accountId: input.accountId,
      projectId: resolvedProjectId,
      domain: resolvedDomain,
      text: ruleText,
      kind: 'constraint',
      importance: 0.96,
      confidence: 0.95,
      source: input.sourceRef || 'review_compiler',
    }).catch(() => null),
    upsertTemporalEdge(env, {
      accountId: input.accountId,
      projectId: resolvedProjectId,
      domain: resolvedDomain,
      subjectEntity,
      predicate: 'never_bring_up',
      objectEntity: cleanReason.slice(0, 200),
      confidence: 0.95,
      derivation: 'user',
      sourceRef: input.sourceRef || 'review_compiler',
    }).catch(() => null),
    enqueueDreamEvent(env, {
      accountId: input.accountId,
      projectId: resolvedProjectId,
      domain: subjectEntity,
      eventType: 'feedback_received',
      sourceId: input.sourceRef || null,
      payload: {
        ruleText,
        targetToolOrAsset: input.targetToolOrAsset || null,
        compiledBy: input.userId,
      },
    }).catch(() => null),
  ]);

  let updatedProjectPreferences = false;
  if (resolvedProjectId && env.DB) {
    try {
      const existingCtx = await getProjectContext(env, input.accountId, resolvedProjectId);
      if (existingCtx) {
        const prefSection = existingCtx.sections.find((s) => s.key === 'writing_preferences');
        const currentContent = prefSection?.content ? `${prefSection.content.trim()}\n` : '';
        const bullet = `- ${ruleText}`;
        if (!currentContent.includes(bullet)) {
          const nextContent = `${currentContent}${bullet}`.slice(0, 3900);
          const patched = await updateProjectContext(
            env,
            input.accountId,
            resolvedProjectId,
            [{ section: 'writing_preferences', content: nextContent }],
            'mcp',
          );
          updatedProjectPreferences = patched.ok;
        }
      }
    } catch {
      /* schema-safe best-effort update */
    }
  }

  return {
    ok: true,
    ruleText,
    factId: factRes && factRes.ok ? factRes.fact.id : null,
    edgeId: edgeRes && edgeRes.ok ? edgeRes.edge.id : null,
    dreamEventId: dreamRes && dreamRes.ok ? dreamRes.event.id : null,
    updatedProjectPreferences,
  };
}

/**
 * Pillar 3: Mints a short-lived, project-scoped Agent Habitat token (`lm_hab_*`).
 * Destructive risk is never granted on habitat tokens; destructive tools always quarantine.
 */
export async function mintHabitatToken(
  env: Env,
  user: HostedIdentity,
  params: {
    projectId?: string | null;
    domain?: string | null;
    maxRisk?: string | null;
    ttlMinutes?: number | null;
    label?: string | null;
  },
): Promise<
  | {
      ok: true;
      token: string;
      record: HabitatTokenRecord;
    }
  | { ok: false; error: string; status: number }
> {
  if (user.id.startsWith('hab:')) {
    return {
      ok: false,
      error: 'Ephemeral Habitat credentials cannot mint new tokens.',
      status: 403,
    };
  }

  const sub = await getActiveSubscription(env, user);
  const caps = planCapsFor(sub?.plan);
  if (!caps.mcpAccess) {
    return {
      ok: false,
      error: 'Minting Agent Habitat credentials requires a Growth or Agency plan.',
      status: 403,
    };
  }

  if (
    params.maxRisk !== undefined &&
    params.maxRisk !== null &&
    params.maxRisk !== 'read' &&
    params.maxRisk !== 'write'
  ) {
    return {
      ok: false,
      error: 'maxRisk must be "read" or "write". Destructive risk is never granted to Habitat tokens.',
      status: 400,
    };
  }

  const maxRisk: HabitatRiskCeiling = params.maxRisk === 'write' ? 'write' : 'read';
  const rawTtl = Number(params.ttlMinutes ?? 60);
  const ttlMinutes = Number.isFinite(rawTtl) ? Math.min(Math.max(5, Math.floor(rawTtl)), 1440) : 60;
  const now = Date.now();
  const expiresAt = now + ttlMinutes * 60 * 1000;
  const secret = randomId('h', 24).replace(/^h_/, '');
  const token = `${HABITAT_TOKEN_PREFIX}${secret}`;
  const tokenHash = await sha256Hex(`luminara-habitat-token:${token}`);
  const id = randomId('hab');
  const accountId = billingId(user);
  const projectId = params.projectId?.trim() || null;
  const domain = normalizeMemoryDomain(params.domain || null);
  const label = scrubEmDashes(params.label || 'Scoped Habitat Agent').slice(0, 64) || 'Scoped Habitat Agent';

  const record: HabitatTokenRecord = {
    id,
    accountId,
    userId: user.id,
    projectId,
    domain,
    maxRisk,
    label,
    createdAt: now,
    expiresAt,
  };

  if (env.LUMINARA_KV) {
    await env.LUMINARA_KV.put(`${HABITAT_KV_PREFIX}${tokenHash}`, JSON.stringify(record), {
      expirationTtl: ttlMinutes * 60,
    });
  } else {
    memoryHabitatTokens.set(tokenHash, record);
  }

  return { ok: true, token, record };
}

/**
 * Resolves `Bearer lm_hab_*` to a HostedIdentity + project/risk-scoped McpCredential.
 */
export async function identifyHabitatToken(
  env: Env,
  bearer: string | null,
): Promise<{ user: HostedIdentity; credential: McpCredential; record: HabitatTokenRecord } | null> {
  if (!bearer || !bearer.startsWith(HABITAT_TOKEN_PREFIX)) return null;
  const tokenHash = await sha256Hex(`luminara-habitat-token:${bearer}`);

  let record: HabitatTokenRecord | null = null;
  if (env.LUMINARA_KV) {
    const raw = await env.LUMINARA_KV.get(`${HABITAT_KV_PREFIX}${tokenHash}`);
    if (raw) {
      try {
        record = JSON.parse(raw) as HabitatTokenRecord;
      } catch {
        record = null;
      }
    }
  } else {
    record = memoryHabitatTokens.get(tokenHash) || null;
  }

  if (!record || record.expiresAt <= Date.now()) {
    memoryHabitatTokens.delete(tokenHash);
    return null;
  }

  const scopes = record.maxRisk === 'read' ? ['mcp:free'] : ['mcp:free', 'mcp:research'];
  return {
    user: {
      id: `hab:${record.id}`,
      source: 'firebase',
      accountId: record.accountId,
      name: record.label,
    },
    credential: {
      kind: 'oauth',
      id: record.id,
      scopes,
      projectId: record.projectId,
      domain: record.domain,
      maxRisk: record.maxRisk,
    },
    record,
  };
}

export interface AgentHabitatStatusSnapshot {
  pendingRequests: ActionRequestRow[];
  recentRuns: RunRow[];
  budget: BudgetStatus;
  compiledRules: string[];
}

export async function getAgentHabitatStatus(
  env: Env,
  accountId: string,
  domain?: string | null,
): Promise<AgentHabitatStatusSnapshot> {
  const [allRequests, recentRuns, budget, recalled] = await Promise.all([
    listActionRequests(env, accountId, 25),
    listRunsForAccount(env, accountId, 12),
    getBudgetStatus(env, accountId),
    recallUnifiedContext(env, {
      accountId,
      domain: domain || null,
      topK: 10,
    }).catch(() => ({ strictConstraints: [] as string[] })),
  ]);

  const now = Date.now();
  return {
    pendingRequests: allRequests.filter((r) => r.status === 'pending' && r.expires_at > now),
    recentRuns,
    budget,
    compiledRules: recalled.strictConstraints || [],
  };
}

export interface CoaseanHandoffInput {
  accountId: string;
  userId: string;
  domain: string;
  brandName?: string | null;
  findingId?: string | null;
  findingTitle?: string | null;
  findingDescription?: string | null;
  rivalName?: string | null;
  projectId?: string | null;
  verifyByDate?: string | null;
}

export interface CoaseanHandoffPacket {
  domain: string;
  preparedAssetId: string | null;
  engineeringPrBundle: VerifiedPrHandoffBundle;
  salesSupportBrief: {
    headline: string;
    aiRiskSummary: string;
    verifiedTalkingPoint: string;
    frontDeskChecklist: string[];
    markdownBrief: string;
  };
  qaVerificationSchedule: {
    verifyByDate: string;
    readbackProbeUrl: string;
    buyerPromptsToRetest: string[];
    acceptanceCriteria: string[];
  };
}

/**
 * Pillar 4: Generates the 3-role Coasean Handoff Packet (Engineering PR Bundle,
 * Sales/Support Reputation Firewall Brief, and QA 14-day Retest Schedule) and
 * persists the prepared asset to `prepared_assets` when D1 is available.
 */
export async function buildCoaseanHandoffPacket(
  env: Env,
  input: CoaseanHandoffInput,
): Promise<CoaseanHandoffPacket> {
  const cleanDomain = normalizeMemoryDomain(input.domain) || 'example.com';
  const resolvedBrand = brandNameFor(cleanDomain, input.brandName) || readableStem(cleanDomain) || cleanDomain;
  const brand = scrubEmDashes(resolvedBrand);
  const title = scrubEmDashes(
    input.findingTitle || `Publish verified llms.txt and Organization JSON-LD for ${cleanDomain}`,
  );
  const description = scrubEmDashes(
    input.findingDescription ||
      `Ensure AI answer engines cite canonical entity facts and pricing for ${brand} (${cleanDomain}).`,
  );
  const rival = input.rivalName ? scrubEmDashes(input.rivalName) : null;

  const llmsTxtContent = llmsTxtDraft(cleanDomain, {
    siteName: brand,
    description,
    facts: [
      `Primary domain: https://${cleanDomain}`,
      `Priority weekly fix: ${title}`,
    ],
  });
  const jsonLdContent = organizationJsonLd(cleanDomain, {
    siteName: brand,
    description,
  });
  const comparisonMarkdown = comparisonOutlineDraft(cleanDomain, { siteName: brand, description }, rival);

  const engineeringPrBundle = buildVerifiedRemediationPrBundle({
    domain: cleanDomain,
    brandName: brand,
    findingTitle: title,
    findingId: input.findingId || null,
    llmsTxtContent,
    jsonLdContent,
    comparisonMarkdown,
  });

  let preparedAssetId: string | null = null;
  if (env.DB) {
    try {
      const id = `pa_${crypto.randomUUID()}`;
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO prepared_assets
          (id, account_id, finding_id, weekly_decision_id, kind, title, body_md, status, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'dev_ticket_pr_bundle', ?, ?, 'ready', ?, ?)`,
      )
        .bind(
          id,
          input.accountId,
          input.findingId || null,
          engineeringPrBundle.prTitle.slice(0, 300),
          engineeringPrBundle.prBodyMarkdown.slice(0, 20000),
          now,
          now,
        )
        .run();
      preparedAssetId = id;
    } catch {
      /* schema-safe fallback if prepared_assets table is absent in isolated unit tests */
    }
  }

  const verifyByDate =
    input.verifyByDate ||
    new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  const frontDeskChecklist = [
    `Reference https://${cleanDomain} as the single source of truth for current scope and pricing.`,
    rival
      ? `When prospects mention ${rival}, use the verified side-by-side comparison outline rather than unverified AI summaries.`
      : 'Clarify core service coverage immediately if a prospect quotes an outdated AI overview.',
    `Log any customer-reported AI hallucination in Luminara Brand Memory so it compiles into a permanent constraint rule.`,
  ];

  const salesMarkdown = [
    `# Reputation Firewall & Sales Brief: ${brand} (${cleanDomain})`,
    '',
    `**Active Weekly Fix:** ${title}`,
    `**AI Visibility Risk:** ${description}`,
    `**Verified Talking Point:** Direct prospects to https://${cleanDomain} for current offerings while our machine-readable llms.txt and Schema.org graph propagate across AI engines (target re-verification: ${verifyByDate}).`,
    '',
    '## Front-Desk & Sales Checklist',
    ...frontDeskChecklist.map((item) => `- ${item}`),
  ].join('\n');

  const buyerPromptsToRetest = [
    `Who are the most trusted providers in ${cleanDomain}'s category and how do they compare?`,
    `What does ${brand} (${cleanDomain}) offer and who is their ideal customer?`,
    rival
      ? `How does ${brand} compare to ${rival} for buyer evaluation?`
      : `What are the verified facts and official site for ${brand}?`,
  ];

  return {
    domain: cleanDomain,
    preparedAssetId,
    engineeringPrBundle,
    salesSupportBrief: {
      headline: `Reputation Firewall Brief for ${brand}`,
      aiRiskSummary: description,
      verifiedTalkingPoint: `Direct prospects to https://${cleanDomain} for verified scope and pricing while the ${engineeringPrBundle.branchName} fix propagates.`,
      frontDeskChecklist,
      markdownBrief: salesMarkdown,
    },
    qaVerificationSchedule: {
      verifyByDate,
      readbackProbeUrl: `https://${cleanDomain}/llms.txt`,
      buyerPromptsToRetest,
      acceptanceCriteria: [
        `GET https://${cleanDomain}/llms.txt returns HTTP 200 with H1 "# ${brand}".`,
        `Root HTML contains valid application/ld+json Organization schema for https://${cleanDomain}.`,
        `Re-run Luminara probe by ${verifyByDate} on the 3 non-branded buyer prompts above.`,
      ],
    },
  };
}

export async function handleAgentHabitatRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith('/agent-habitat/')) return null;
  const accountId = billingId(user);

  if (path === '/agent-habitat/status' && request.method === 'GET') {
    const url = new URL(request.url);
    const domain = url.searchParams.get('domain');
    const snapshot = await getAgentHabitatStatus(env, accountId, domain);
    return json({ ok: true, ...snapshot });
  }

  if (path === '/agent-habitat/feedback-rule' && request.method === 'POST') {
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return json({ ok: false, error: read.error }, read.status);
    const body = (read.value || {}) as {
      domain?: string;
      projectId?: string;
      reason?: string;
      targetToolOrAsset?: string;
      sourceRef?: string;
    };
    const res = await compileFeedbackIntoSkillRule(env, {
      accountId,
      userId: user.id,
      domain: body.domain || null,
      projectId: body.projectId || null,
      reason: typeof body.reason === 'string' ? body.reason : '',
      targetToolOrAsset: body.targetToolOrAsset || null,
      sourceRef: body.sourceRef || 'habitat_ui',
    });
    if (!res.ok) return json({ ok: false, error: res.error }, res.status);
    return json(res);
  }

  if (path === '/agent-habitat/tokens' && request.method === 'POST') {
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return json({ ok: false, error: read.error }, read.status);
    const body = (read.value || {}) as {
      projectId?: string;
      domain?: string;
      maxRisk?: string;
      ttlMinutes?: number;
      label?: string;
    };
    const minted = await mintHabitatToken(env, user, body);
    if (!minted.ok) return json({ ok: false, error: minted.error }, minted.status);
    return json(minted, 201);
  }

  if (path === '/agent-habitat/handoff-packet' && request.method === 'POST') {
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return json({ ok: false, error: read.error }, read.status);
    const body = (read.value || {}) as {
      domain?: string;
      brandName?: string;
      findingId?: string;
      findingTitle?: string;
      findingDescription?: string;
      rivalName?: string;
      projectId?: string;
      verifyByDate?: string;
    };
    const domain = typeof body.domain === 'string' ? body.domain.trim() : '';
    if (!domain) return json({ ok: false, error: 'domain is required' }, 400);
    const packet = await buildCoaseanHandoffPacket(env, {
      accountId,
      userId: user.id,
      domain,
      brandName: body.brandName || null,
      findingId: body.findingId || null,
      findingTitle: body.findingTitle || null,
      findingDescription: body.findingDescription || null,
      rivalName: body.rivalName || null,
      projectId: body.projectId || null,
      verifyByDate: body.verifyByDate || null,
    });
    return json({ ok: true, packet });
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

function toMcpResult(
  text: string,
  structuredContent?: Record<string, unknown>,
  isError?: boolean,
): McpToolResult {
  const res: McpToolResult = { text };
  if (structuredContent !== undefined) res.structuredContent = structuredContent;
  if (isError) res.isError = true;
  return res;
}

export const SELF_DRIVING_MCP_TOOLS: McpToolDef[] = [
  {
    name: 'create_dev_ticket_from_finding',
    description:
      'Uses no credits. Builds a pre-verified Engineering PR Bundle (llms.txt + Organization JSON-LD + deterministic validation receipt), Sales Reputation Firewall Brief, and 14-day QA Retest Schedule from an audit finding.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        brandName: { type: 'string' },
        findingId: { type: 'string' },
        findingTitle: { type: 'string' },
        findingDescription: { type: 'string' },
        rivalName: { type: 'string' },
        projectId: { type: 'string' },
      },
      required: ['domain'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const domain = typeof args.domain === 'string' ? args.domain.trim() : '';
      if (!domain) return toMcpResult('domain is required', undefined, true);
      const packet = await buildCoaseanHandoffPacket(ctx.env, {
        accountId: ctx.accountId,
        userId: ctx.user.id,
        domain,
        brandName: typeof args.brandName === 'string' ? args.brandName : null,
        findingId: typeof args.findingId === 'string' ? args.findingId : null,
        findingTitle: typeof args.findingTitle === 'string' ? args.findingTitle : null,
        findingDescription: typeof args.findingDescription === 'string' ? args.findingDescription : null,
        rivalName: typeof args.rivalName === 'string' ? args.rivalName : null,
        projectId: typeof args.projectId === 'string' ? args.projectId : ctx.credential.projectId ?? null,
      });
      return toMcpResult(
        `Prepared Coasean Handoff Packet for ${packet.domain} (branch ${packet.engineeringPrBundle.branchName}, pre-flight checks passed=${packet.engineeringPrBundle.validationReceipt.allPassed}).`,
        { packet: packet as unknown as Record<string, unknown> },
      );
    },
  },
  {
    name: 'compile_review_to_skill',
    description:
      'Uses no credits. Compiles a code/content review correction or rejection reason into a permanent workspace constraint rule, bi-temporal edge, and project writing preference so future agents never repeat the mistake.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        projectId: { type: 'string' },
        reason: { type: 'string' },
        targetToolOrAsset: { type: 'string' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const reason = typeof args.reason === 'string' ? args.reason : '';
      const res = await compileFeedbackIntoSkillRule(ctx.env, {
        accountId: ctx.accountId,
        userId: ctx.user.id,
        domain: typeof args.domain === 'string' ? args.domain : null,
        projectId: typeof args.projectId === 'string' ? args.projectId : ctx.credential.projectId ?? null,
        reason,
        targetToolOrAsset: typeof args.targetToolOrAsset === 'string' ? args.targetToolOrAsset : null,
        sourceRef: 'mcp_compile_review',
      });
      if (!res.ok) return toMcpResult(res.error, undefined, true);
      return toMcpResult(
        `Compiled review feedback into permanent rule: "${res.ruleText}"`,
        res as unknown as Record<string, unknown>,
      );
    },
  },
  {
    name: 'mint_habitat_token',
    description:
      'Uses no credits. Mints a short-lived, project-scoped Agent Habitat token (lm_hab_*) bounded to read or write risk.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        domain: { type: 'string' },
        maxRisk: { type: 'string', enum: ['read', 'write'] },
        ttlMinutes: { type: 'number' },
        label: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const minted = await mintHabitatToken(ctx.env, ctx.user, {
        projectId: typeof args.projectId === 'string' ? args.projectId : ctx.credential.projectId ?? null,
        domain: typeof args.domain === 'string' ? args.domain : ctx.credential.domain ?? null,
        maxRisk: typeof args.maxRisk === 'string' ? args.maxRisk : undefined,
        ttlMinutes: typeof args.ttlMinutes === 'number' ? args.ttlMinutes : 60,
        label: typeof args.label === 'string' ? args.label : 'MCP Subagent',
      });
      if (!minted.ok) return toMcpResult(minted.error, undefined, true);
      return toMcpResult(
        `Minted ephemeral Habitat token ${minted.record.id} (maxRisk=${minted.record.maxRisk}, expiresAt=${new Date(minted.record.expiresAt).toISOString()}).`,
        { token: minted.token, record: minted.record as unknown as Record<string, unknown> },
      );
    },
  },
];
