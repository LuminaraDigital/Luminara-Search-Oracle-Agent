/**
 * Self-driving agent loop:
 *
 * 1. Review rules (`compileFeedbackIntoSkillRule`): an owner's correction or MCP denial
 *    becomes a scoped constraint fact, a `never_bring_up` edge, a Dreaming event and a
 *    line in the project's `writing_preferences`.
 * 2. Habitat tokens (`mintHabitatToken`, `identifyHabitatToken`, `enforceHabitatScope`):
 *    short-lived `lm_hab_*` credentials locked to one owned project with a risk ceiling
 *    of `read` or `write`, never `destructive`.
 * 3. Control plane (`getAgentHabitatStatus`): pending approvals, recent runs, budget and rules.
 * 4. Handoff packet (`buildCoaseanHandoffPacket`): one finding becomes an engineering PR
 *    bundle, a front-desk brief and a 14-day retest schedule.
 */
import type { Env } from './env';
import type { HostedIdentity, McpCredential } from './userTypes';
import type { McpToolDef, McpToolResult } from './mcpServer';
import { billingId, json, sha256Hex } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { randomId } from '../services/projects/projectUtils';
import {
  listActiveConstraints,
  normalizeMemoryDomain,
  rememberConstraint,
  rememberRuleEdge,
  resolveProjectScope,
} from './scopedMemory';
import { enqueueDreamEvent } from './dreamingQueue';
import { getProjectContext, updateProjectContext } from './projectContextService';
import { governanceFor, listActionRequests, type ActionRequestRow } from './mcpGovernance';
import { listRunsForAccount, type RunRow } from './runProvenance';
import { getBudgetStatus, type BudgetStatus } from './budgets';
import { getActiveSubscription } from './quotaMiddleware';
import { entitlementsFor } from '../services/plans/planEntitlements';
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
const MAX_RULE_CHARS = 480;
const MAX_PREFERENCES_CHARS = 3900;

/** Read nothing beyond the token's own project, so they need no project argument. */
const HABITAT_ACCOUNT_SAFE_TOOLS = new Set(['whoami', 'list_projects', 'get_report']);
/**
 * Would widen the token's reach or let an agent write rules for other agents. Browser
 * sessions are not tied to a project and can navigate off the bound domain.
 */
const HABITAT_FORBIDDEN_TOOLS = new Set([
  'create_project',
  'compile_review_to_skill',
  'mint_habitat_token',
  'browse_observe',
  'browse_act',
]);

export type HabitatRiskCeiling = 'read' | 'write';

export interface HabitatTokenRecord {
  id: string;
  accountId: string;
  userId: string;
  projectId: string;
  domain: string | null;
  maxRisk: HabitatRiskCeiling;
  label: string;
  createdAt: number;
  expiresAt: number;
}

function scrubEmDashes(input: string): string {
  return input.replace(/\u2014/g, '-').replace(/\s+/g, ' ').trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function habitatTokenKey(tokenHash: string): string {
  return `${HABITAT_KV_PREFIX}${tokenHash}`;
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
  factId: string;
  edgeId: string | null;
  dreamEventId: string | null;
  updatedProjectPreferences: boolean;
}

/** Appends a rule and drops the oldest lines when the section would overflow. */
function appendPreference(current: string, bullet: string): string {
  const lines = [...current.split('\n').filter(Boolean), bullet];
  while (lines.length > 1 && lines.join('\n').length > MAX_PREFERENCES_CHARS) lines.shift();
  return lines.join('\n');
}

async function addRuleToWritingPreferences(
  env: Env,
  accountId: string,
  projectId: string,
  ruleText: string,
): Promise<boolean> {
  try {
    const context = await getProjectContext(env, accountId, projectId);
    if (!context) return false;
    const current = context.sections.find((s) => s.key === 'writing_preferences')?.content?.trim() || '';
    const bullet = `- ${ruleText}`;
    if (current.split('\n').includes(bullet)) return true;
    const patched = await updateProjectContext(
      env,
      accountId,
      projectId,
      [{ section: 'writing_preferences', content: appendPreference(current, bullet) }],
      'mcp',
    );
    return patched.ok;
  } catch (err) {
    console.error('[habitat] writing_preferences update failed:', err);
    return false;
  }
}

/**
 * Turns an owner's rejection or edit note into a durable rule. The constraint fact is the
 * rule itself, so a failed fact write fails the call. The edge, Dreaming event and
 * preferences line follow it and report their own outcome.
 */
export async function compileFeedbackIntoSkillRule(
  env: Env,
  input: CompileFeedbackInput,
): Promise<CompileFeedbackResult | { ok: false; error: string; status: number }> {
  const cleanReason = scrubEmDashes(input.reason || '').slice(0, MAX_RULE_CHARS);
  if (cleanReason.length < 4) {
    return {
      ok: false,
      error: 'Review reason must be at least 4 characters to compile into a team rule.',
      status: 400,
    };
  }

  const { accountId } = input;
  const scope = await resolveProjectScope(env, accountId, { projectId: input.projectId, domain: input.domain });
  const target = input.targetToolOrAsset ? scrubEmDashes(input.targetToolOrAsset).slice(0, 60) : null;
  const ruleText = `${target ? `[Rule from ${target}]` : '[Review rule]'} ${cleanReason}`;
  const sourceRef = input.sourceRef || 'review_compiler';
  const subjectEntity = scope.domain || 'workspace';

  const fact = await rememberConstraint(env, { ...scope, accountId, text: ruleText, source: sourceRef });
  if (!fact.ok) return { ok: false, error: fact.error, status: 503 };

  const [edgeId, dream, updatedProjectPreferences] = await Promise.all([
    rememberRuleEdge(env, { ...scope, accountId, subjectEntity, objectEntity: cleanReason.slice(0, 200), sourceRef }),
    enqueueDreamEvent(env, {
      accountId,
      projectId: scope.projectId,
      domain: subjectEntity,
      eventType: 'feedback_received',
      sourceId: input.sourceRef || null,
      payload: { ruleText, targetToolOrAsset: target, compiledBy: input.userId },
    }).catch((err) => {
      console.error('[habitat] dream event failed:', err);
      return null;
    }),
    scope.projectId ? addRuleToWritingPreferences(env, accountId, scope.projectId, ruleText) : false,
  ]);

  return {
    ok: true,
    ruleText,
    factId: fact.factId,
    edgeId,
    dreamEventId: dream && dream.ok ? dream.event.id : null,
    updatedProjectPreferences,
  };
}

/**
 * Mints a short-lived token locked to one project the account owns. A connector's OAuth token
 * cannot mint: the new token would carry more than `mcp:free` and outlive the connector's
 * revocation.
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
  credential?: McpCredential,
): Promise<{ ok: true; token: string; record: HabitatTokenRecord } | { ok: false; error: string; status: number }> {
  if (credential?.kind === 'habitat' || credential?.kind === 'oauth') {
    return { ok: false, error: 'This connection cannot mint Agent Habitat tokens.', status: 403 };
  }

  const sub = await getActiveSubscription(env, user);
  if (entitlementsFor(sub?.plan || 'free').mcpDailyCallLimit > 0) {
    return { ok: false, error: 'Minting Agent Habitat tokens requires a Growth or Agency plan.', status: 403 };
  }

  if (params.maxRisk != null && params.maxRisk !== 'read' && params.maxRisk !== 'write') {
    return {
      ok: false,
      error: 'maxRisk must be "read" or "write". Destructive risk is never granted to Habitat tokens.',
      status: 400,
    };
  }

  if (!env.LUMINARA_KV) return { ok: false, error: 'Token store unavailable', status: 503 };

  const accountId = billingId(user);
  const scope = await resolveProjectScope(env, accountId, params);
  const requestedDomain = normalizeMemoryDomain(params.domain);
  if (!scope.projectId || (requestedDomain && requestedDomain !== scope.domain)) {
    return {
      ok: false,
      error: 'A Habitat token needs a project in this account. Create a project for this domain first.',
      status: 400,
    };
  }

  const maxRisk: HabitatRiskCeiling = params.maxRisk === 'write' ? 'write' : 'read';
  const rawTtl = Number(params.ttlMinutes ?? 60);
  const ttlMinutes = Number.isFinite(rawTtl) ? Math.min(Math.max(5, Math.floor(rawTtl)), 1440) : 60;
  const now = Date.now();
  const token = `${HABITAT_TOKEN_PREFIX}${randomId('h', 24).replace(/^h_/, '')}`;
  const tokenHash = await sha256Hex(`luminara-habitat-token:${token}`);
  const label = scrubEmDashes(params.label || '').slice(0, 64) || 'Scoped Habitat Agent';

  const record: HabitatTokenRecord = {
    id: randomId('hab'),
    accountId,
    userId: user.id,
    projectId: scope.projectId,
    domain: scope.domain,
    maxRisk,
    label,
    createdAt: now,
    expiresAt: now + ttlMinutes * 60 * 1000,
  };

  await env.LUMINARA_KV.put(habitatTokenKey(tokenHash), JSON.stringify(record), {
    expirationTtl: ttlMinutes * 60,
  });
  return { ok: true, token, record };
}

/** Resolves `Bearer lm_hab_*` to the owning account plus a project and risk-locked credential. */
export async function identifyHabitatToken(
  env: Env,
  bearer: string | null,
): Promise<{ user: HostedIdentity; credential: McpCredential; record: HabitatTokenRecord } | null> {
  if (!bearer || !bearer.startsWith(HABITAT_TOKEN_PREFIX) || !env.LUMINARA_KV) return null;
  const tokenHash = await sha256Hex(`luminara-habitat-token:${bearer}`);
  const raw = await env.LUMINARA_KV.get(habitatTokenKey(tokenHash));
  if (!raw) return null;

  let record: HabitatTokenRecord;
  try {
    record = JSON.parse(raw) as HabitatTokenRecord;
  } catch {
    return null;
  }
  if (record.expiresAt <= Date.now()) return null;

  return {
    user: {
      id: `hab:${record.id}`,
      source: 'firebase',
      accountId: record.accountId,
      name: record.label,
    },
    credential: {
      kind: 'habitat',
      id: record.id,
      scopes: record.maxRisk === 'read' ? ['mcp:free'] : ['mcp:free', 'mcp:research'],
      projectId: record.projectId,
      domain: record.domain,
      maxRisk: record.maxRisk,
    },
    record,
  };
}

function scopeViolation(message: string, detail: Record<string, unknown>): { blocked: McpToolResult } {
  return {
    blocked: {
      text: `Tool blocked by Agent Habitat scope: ${message}`,
      structuredContent: { code: 'HABITAT_PROJECT_SCOPE_VIOLATION', ...detail },
      isError: true,
    },
  };
}

function urlHost(raw: string): string | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The one gate for Habitat tokens on `/mcp`. It fails closed: a tool with no project or
 * domain argument is refused unless it is listed as safe, because nothing else could keep
 * such a call inside the token's project. Other credentials pass through unchanged.
 */
export function enforceHabitatScope(
  tool: McpToolDef | undefined,
  name: string,
  args: Record<string, unknown>,
  credential: McpCredential,
): { args: Record<string, unknown> } | { blocked: McpToolResult } {
  if (credential.kind !== 'habitat' || !tool) return { args };
  const boundProjectId = credential.projectId ?? null;
  const boundDomain = credential.domain ?? null;

  const toolRisk = governanceFor(name).risk;
  const { maxRisk } = credential;
  if ((maxRisk === 'read' && toolRisk !== 'read') || toolRisk === 'destructive') {
    return {
      blocked: {
        text: `Tool blocked by Agent Habitat risk ceiling: this token allows "${maxRisk}" tools and ${name} is "${toolRisk}".`,
        structuredContent: { code: 'HABITAT_RISK_CEILING_EXCEEDED', maxRisk, toolRisk },
        isError: true,
      },
    };
  }

  if (HABITAT_FORBIDDEN_TOOLS.has(name)) {
    return scopeViolation(`${name} is not available to Habitat tokens.`, { tool: name });
  }

  const properties = ((tool.inputSchema.properties ?? {}) as Record<string, unknown>);
  const takesProject = 'projectId' in properties;
  const takesDomain = 'domain' in properties;
  if (!takesProject && !takesDomain && !HABITAT_ACCOUNT_SAFE_TOOLS.has(name)) {
    return scopeViolation(`${name} cannot be limited to one project.`, { tool: name });
  }

  const requestedProjectId = optionalString(args.projectId);
  if (requestedProjectId && requestedProjectId !== boundProjectId) {
    return scopeViolation(`token is bound to project "${boundProjectId}".`, { boundProjectId, requestedProjectId });
  }
  const requestedDomain = normalizeMemoryDomain(optionalString(args.domain));
  if (boundDomain && requestedDomain && requestedDomain !== boundDomain) {
    return scopeViolation(`token is bound to domain "${boundDomain}".`, { boundDomain, requestedDomain });
  }

  const url = optionalString(args.url);
  if (url && boundDomain) {
    const host = urlHost(url);
    if (host !== boundDomain && !host?.endsWith(`.${boundDomain}`)) {
      return scopeViolation(`token is bound to domain "${boundDomain}".`, { boundDomain, requestedUrl: url });
    }
  }

  return {
    args: {
      ...args,
      ...(takesProject && boundProjectId ? { projectId: boundProjectId } : {}),
      ...(takesDomain && boundDomain && !requestedDomain ? { domain: boundDomain } : {}),
    },
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
  const scope = await resolveProjectScope(env, accountId, { domain });
  const [allRequests, recentRuns, budget, compiledRules] = await Promise.all([
    listActionRequests(env, accountId, 25),
    listRunsForAccount(env, accountId, 12),
    getBudgetStatus(env, accountId),
    listActiveConstraints(env, accountId, scope),
  ]);

  const now = Date.now();
  return {
    pendingRequests: allRequests.filter((r) => r.status === 'pending' && r.expires_at > now),
    recentRuns,
    budget,
    compiledRules,
  };
}

export interface CoaseanHandoffInput {
  accountId: string;
  domain: string;
  brandName?: string | null;
  findingId?: string | null;
  findingTitle?: string | null;
  findingDescription?: string | null;
  rivalName?: string | null;
  verifyByDate?: string | null;
}

export interface CoaseanHandoffPacket {
  domain: string;
  preparedAssetId: string | null;
  engineeringPrBundle: VerifiedPrHandoffBundle;
  salesSupportBrief: {
    headline: string;
    aiRiskSummary: string;
    talkingPoint: string;
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

/** Stores all three role artifacts. Returns null when the write fails so callers can say so. */
async function savePreparedPacket(
  env: Env,
  input: { accountId: string; findingId: string | null; title: string; bodyMd: string },
): Promise<string | null> {
  if (!env.DB) return null;
  const id = `pa_${crypto.randomUUID()}`;
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO prepared_assets
        (id, account_id, finding_id, weekly_decision_id, kind, title, body_md, status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'dev_ticket_pr_bundle', ?, ?, 'ready', ?, ?)`,
    )
      .bind(id, input.accountId, input.findingId, input.title.slice(0, 300), input.bodyMd.slice(0, 20000), now, now)
      .run();
    return id;
  } catch (err) {
    console.error('[habitat] prepared asset write failed:', err);
    return null;
  }
}

/** Builds the three role artifacts from one finding and saves them to `prepared_assets`. */
export async function buildCoaseanHandoffPacket(
  env: Env,
  input: CoaseanHandoffInput,
): Promise<CoaseanHandoffPacket> {
  const cleanDomain = normalizeMemoryDomain(input.domain) || 'example.com';
  const resolvedBrand = brandNameFor(cleanDomain, input.brandName) || readableStem(cleanDomain) || cleanDomain;
  const brand = scrubEmDashes(resolvedBrand);
  const title = scrubEmDashes(
    input.findingTitle || `Publish llms.txt and Organization JSON-LD for ${cleanDomain}`,
  );
  const description = scrubEmDashes(
    input.findingDescription ||
      `Help AI answer engines cite canonical entity facts and pricing for ${brand} (${cleanDomain}).`,
  );
  const rival = input.rivalName ? scrubEmDashes(input.rivalName) : null;

  const engineeringPrBundle = buildVerifiedRemediationPrBundle({
    domain: cleanDomain,
    brandName: brand,
    findingTitle: title,
    findingId: input.findingId || null,
    llmsTxtContent: llmsTxtDraft(cleanDomain, {
      siteName: brand,
      description,
      facts: [`Primary domain: https://${cleanDomain}`, `Priority weekly fix: ${title}`],
    }),
    jsonLdContent: organizationJsonLd(cleanDomain, { siteName: brand, description }),
    comparisonMarkdown: comparisonOutlineDraft(cleanDomain, { siteName: brand, description }, rival),
  });

  const verifyByDate =
    input.verifyByDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

  const frontDeskChecklist = [
    `Reference https://${cleanDomain} as the single source of truth for current scope and pricing.`,
    rival
      ? `When prospects mention ${rival}, use the side-by-side comparison outline rather than unchecked AI summaries.`
      : 'Clarify core service coverage immediately if a prospect quotes an outdated AI overview.',
    'Log any wrong claim a customer reports from an AI answer in Luminara Brand Memory so it becomes a saved rule.',
  ];
  const talkingPoint = `Direct prospects to https://${cleanDomain} for current scope and pricing while the ${engineeringPrBundle.branchName} fix goes live.`;

  const markdownBrief = [
    `# Reputation Firewall and Sales Brief: ${brand} (${cleanDomain})`,
    '',
    `**Active Weekly Fix:** ${title}`,
    `**AI Visibility Risk:** ${description}`,
    `**Talking Point:** ${talkingPoint} Target re-check: ${verifyByDate}.`,
    '',
    '## Front-Desk and Sales Checklist',
    ...frontDeskChecklist.map((item) => `- ${item}`),
  ].join('\n');

  const buyerPromptsToRetest = [
    `Who are the most trusted providers in ${cleanDomain}'s category and how do they compare?`,
    `What does ${brand} (${cleanDomain}) offer and who is their ideal customer?`,
    rival
      ? `How does ${brand} compare to ${rival} for buyer evaluation?`
      : `What are the official site and main services of ${brand}?`,
  ];
  const acceptanceCriteria = [
    `GET https://${cleanDomain}/llms.txt returns HTTP 200 with H1 "# ${brand}".`,
    `Root HTML contains valid application/ld+json Organization schema for https://${cleanDomain}.`,
    `Re-run the Luminara probe by ${verifyByDate} on the 3 buyer prompts below.`,
  ];

  const preparedAssetId = await savePreparedPacket(env, {
    accountId: input.accountId,
    findingId: input.findingId || null,
    title: engineeringPrBundle.prTitle,
    bodyMd: [
      markdownBrief,
      engineeringPrBundle.prBodyMarkdown,
      `## QA Retest by ${verifyByDate}`,
      ...acceptanceCriteria.map((item) => `- ${item}`),
      ...buyerPromptsToRetest.map((item) => `- Prompt: ${item}`),
    ].join('\n\n'),
  });

  return {
    domain: cleanDomain,
    preparedAssetId,
    engineeringPrBundle,
    salesSupportBrief: {
      headline: `Reputation Firewall Brief for ${brand}`,
      aiRiskSummary: description,
      talkingPoint,
      frontDeskChecklist,
      markdownBrief,
    },
    qaVerificationSchedule: {
      verifyByDate,
      readbackProbeUrl: `https://${cleanDomain}/llms.txt`,
      buyerPromptsToRetest,
      acceptanceCriteria,
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
    const domain = new URL(request.url).searchParams.get('domain');
    const snapshot = await getAgentHabitatStatus(env, accountId, domain);
    return json({ ok: true, ...snapshot });
  }

  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const read = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const body = (read.value || {}) as Record<string, unknown>;

  if (path === '/agent-habitat/feedback-rule') {
    const res = await compileFeedbackIntoSkillRule(env, {
      accountId,
      userId: user.id,
      domain: optionalString(body.domain),
      projectId: optionalString(body.projectId),
      reason: optionalString(body.reason) ?? '',
      targetToolOrAsset: optionalString(body.targetToolOrAsset),
      sourceRef: optionalString(body.sourceRef) ?? 'habitat_ui',
    });
    if (!res.ok) return json({ ok: false, error: res.error }, res.status);
    return json(res);
  }

  if (path === '/agent-habitat/tokens') {
    const minted = await mintHabitatToken(env, user, {
      projectId: optionalString(body.projectId),
      domain: optionalString(body.domain),
      maxRisk: typeof body.maxRisk === 'string' ? body.maxRisk : null,
      ttlMinutes: typeof body.ttlMinutes === 'number' ? body.ttlMinutes : null,
      label: optionalString(body.label),
    });
    if (!minted.ok) return json({ ok: false, error: minted.error }, minted.status);
    return json(minted, 201);
  }

  if (path === '/agent-habitat/handoff-packet') {
    const domain = optionalString(body.domain);
    if (!domain) return json({ ok: false, error: 'domain is required' }, 400);
    const packet = await buildCoaseanHandoffPacket(env, {
      accountId,
      domain,
      brandName: optionalString(body.brandName),
      findingId: optionalString(body.findingId),
      findingTitle: optionalString(body.findingTitle),
      findingDescription: optionalString(body.findingDescription),
      rivalName: optionalString(body.rivalName),
      verifyByDate: optionalString(body.verifyByDate),
    });
    return json({ ok: true, packet });
  }

  return json({ ok: false, error: 'Not found' }, 404);
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
      'Uses no credits. Builds a PR bundle (llms.txt, Organization JSON-LD and a deterministic pre-flight receipt), a front-desk brief, and a 14-day retest schedule from an audit finding.',
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
      },
      required: ['domain'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const domain = optionalString(args.domain);
      if (!domain) return toMcpResult('domain is required', undefined, true);
      const packet = await buildCoaseanHandoffPacket(ctx.env, {
        accountId: ctx.accountId,
        domain,
        brandName: optionalString(args.brandName),
        findingId: optionalString(args.findingId),
        findingTitle: optionalString(args.findingTitle),
        findingDescription: optionalString(args.findingDescription),
        rivalName: optionalString(args.rivalName),
      });
      return toMcpResult(
        `Prepared handoff packet for ${packet.domain} (branch ${packet.engineeringPrBundle.branchName}, pre-flight checks passed=${packet.engineeringPrBundle.validationReceipt.allPassed}, saved=${Boolean(packet.preparedAssetId)}).`,
        { packet: packet as unknown as Record<string, unknown> },
      );
    },
  },
  {
    name: 'compile_review_to_skill',
    description:
      'Uses no credits. Saves a review correction or rejection reason as a workspace rule and a project writing preference so future agents inherit it.',
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
      // A connector acts for the owner but must not write rules into the owner's own prompts.
      if (ctx.credential.kind === 'oauth') {
        return toMcpResult('Review rules cannot be saved over an OAuth connection.', undefined, true);
      }
      const res = await compileFeedbackIntoSkillRule(ctx.env, {
        accountId: ctx.accountId,
        userId: ctx.user.id,
        domain: optionalString(args.domain),
        projectId: optionalString(args.projectId),
        reason: optionalString(args.reason) ?? '',
        targetToolOrAsset: optionalString(args.targetToolOrAsset),
        sourceRef: 'mcp_compile_review',
      });
      if (!res.ok) return toMcpResult(res.error, undefined, true);
      return toMcpResult(`Saved review rule: "${res.ruleText}"`, res as unknown as Record<string, unknown>);
    },
  },
  {
    name: 'mint_habitat_token',
    description:
      'Uses no credits. Mints a short-lived Agent Habitat token (lm_hab_*) locked to one project in this account, with a risk ceiling of read or write. Needs Growth or Agency. Not available to OAuth connections.',
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
      const minted = await mintHabitatToken(
        ctx.env,
        ctx.user,
        {
          projectId: optionalString(args.projectId),
          domain: optionalString(args.domain),
          maxRisk: typeof args.maxRisk === 'string' ? args.maxRisk : null,
          ttlMinutes: typeof args.ttlMinutes === 'number' ? args.ttlMinutes : null,
          label: optionalString(args.label) ?? 'MCP Subagent',
        },
        ctx.credential,
      );
      if (!minted.ok) return toMcpResult(minted.error, undefined, true);
      return toMcpResult(
        `Minted Habitat token ${minted.record.id} (maxRisk=${minted.record.maxRisk}, expiresAt=${new Date(minted.record.expiresAt).toISOString()}).`,
        { token: minted.token, record: minted.record as unknown as Record<string, unknown> },
      );
    },
  },
];
