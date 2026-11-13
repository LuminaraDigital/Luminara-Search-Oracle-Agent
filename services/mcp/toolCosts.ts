/**
 * Machine-readable MCP tool cost declarations and Agent Plugins v1 manifest validators.
 *
 * Adapted from NousResearch/hermes-agent (`tools/mcp_tool_costs.py` and
 * `hermes_cli/agent_plugins.py`) at commit ca2269588fd028adb41f3cc45875b04f3c0b88b4.
 * Copyright (c) 2025 Nous Research (MIT).
 */

export const PLUGIN_SCHEMA_V1 = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
export const MCP_SCHEMA_V1 = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
export const HERMES_EXTENSION_NAMESPACE = 'com.nousresearch.hermes';

export const TOOL_COSTS_HOSTED_CENTS = 1;
export const TOOL_COSTS_BYOK_CENTS = 0;
export const DEFAULT_SPEND_LIMIT_CENTS = 100;
export const DEFAULT_COST_UNIT = 'cents';

export type McpRequiredScope = 'mcp:free' | 'mcp:research';

export interface ToolCostEntry {
  low: number;
  high: number;
  note: string;
  requiredScope: McpRequiredScope;
}

export interface ParsedToolCost {
  low: number;
  high: number;
  note: string;
}

export interface CostPolicy {
  costs: Record<string, ParsedToolCost>;
  limit: number;
  unit: string;
}

export type HermesRawCostValue =
  | number
  | [number, number]
  | { credits: number | [number, number]; note?: string };

const FREE_STD: ToolCostEntry = {
  low: 0,
  high: 0,
  note: '',
  requiredScope: 'mcp:free',
};

const PAID_RESEARCH: ToolCostEntry = {
  low: TOOL_COSTS_BYOK_CENTS,
  high: TOOL_COSTS_HOSTED_CENTS,
  note: '1 cent hosted (Agency mcp:research); 0 cents with x-provider-key DataForSEO BYOK.',
  requiredScope: 'mcp:research',
};

const PAID_BROWSER: ToolCostEntry = {
  low: TOOL_COSTS_BYOK_CENTS,
  high: TOOL_COSTS_HOSTED_CENTS,
  note: '1 cent hosted crawler action (Agency mcp:research); 0 cents with x-provider-key BYOK.',
  requiredScope: 'mcp:research',
};

/** Canonical cost table for all 37 Luminara MCP tools. */
export const LUMINARA_MCP_TOOL_COSTS: Readonly<Record<string, ToolCostEntry>> = {
  whoami: FREE_STD,
  list_projects: FREE_STD,
  create_project: FREE_STD,
  get_project_context: FREE_STD,
  get_project_history: FREE_STD,
  compare_snapshots: FREE_STD,
  get_project_outcomes: FREE_STD,
  mark_project_action_done: FREE_STD,
  update_project_context: FREE_STD,
  list_reports: FREE_STD,
  get_report: FREE_STD,
  save_report: FREE_STD,
  dream_status: FREE_STD,
  dream_consolidate: {
    low: 0,
    high: 0,
    note: '0 billed cents; waking a hosted consolidation run on Free plan uses 1 daily request unit.',
    requiredScope: 'mcp:free',
  },
  get_business_memory: FREE_STD,
  review_dream_proposal: FREE_STD,
  draft_fix: {
    low: 0,
    high: 0,
    note: '0 billed cents; consumes 1 daily ask quota unit on metered plans.',
    requiredScope: 'mcp:free',
  },
  list_enquiries: FREE_STD,
  ingest_enquiry: FREE_STD,
  propose_booking_slots: FREE_STD,
  decide_booking_signoff: FREE_STD,
  get_outcomes_funnel: FREE_STD,
  classify_cms_remediation: FREE_STD,
  prepare_cms_mcp_call: FREE_STD,
  create_dev_ticket_from_finding: FREE_STD,
  compile_review_to_skill: {
    low: 0,
    high: 0,
    note: '0 billed cents; requires user session or API key (blocked for OAuth/habitat tokens).',
    requiredScope: 'mcp:free',
  },
  mint_habitat_token: {
    low: 0,
    high: 0,
    note: '0 billed cents; requires Growth+ session or API key (blocked for OAuth/habitat tokens).',
    requiredScope: 'mcp:free',
  },
  research_keywords: PAID_RESEARCH,
  get_domain_overview: PAID_RESEARCH,
  get_serp_results: PAID_RESEARCH,
  get_backlinks_overview: PAID_RESEARCH,
  get_visibility_snapshot: PAID_RESEARCH,
  get_pagespeed_summary: PAID_RESEARCH,
  browse_observe: {
    low: 0,
    high: 0,
    note: '0 billed cents; requires Growth+ plan or x-provider-key BYOK.',
    requiredScope: 'mcp:free',
  },
  browse_act: PAID_BROWSER,
  browse_goal: PAID_BROWSER,
  browse_close: FREE_STD,
};

export function mcpDeclaredCostsEnabled(
  env: { MCP_DECLARED_COSTS_ENABLED?: string } | null | undefined,
): boolean {
  return String(env?.MCP_DECLARED_COSTS_ENABLED ?? '').trim().toLowerCase() === 'true';
}

export function toolCostAnnotationFor(toolName: string): {
  costCents: number | [number, number];
  costUnit: string;
  requiredScope: McpRequiredScope;
  costNote?: string;
} | null {
  const entry = LUMINARA_MCP_TOOL_COSTS[toolName];
  if (!entry) return null;
  const costCents: number | [number, number] =
    entry.low === entry.high ? entry.high : [entry.low, entry.high];
  return {
    costCents,
    costUnit: DEFAULT_COST_UNIT,
    requiredScope: entry.requiredScope,
    ...(entry.note ? { costNote: entry.note } : {}),
  };
}

/** Serialize `LUMINARA_MCP_TOOL_COSTS` into Hermes `extensions["com.nousresearch.hermes"].servers.luminara.costs`. */
export function buildHermesManifestCosts(): Record<string, HermesRawCostValue> {
  const out: Record<string, HermesRawCostValue> = {};
  for (const [name, entry] of Object.entries(LUMINARA_MCP_TOOL_COSTS)) {
    const credits: number | [number, number] =
      entry.low === entry.high ? entry.high : [entry.low, entry.high];
    out[name] = entry.note ? { credits, note: entry.note } : credits;
  }
  return out;
}

function parseNonNegativeNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${where} must be a non-negative finite number.`);
  }
  return value;
}

function parseSingleCost(value: unknown, where: string): ParsedToolCost {
  let raw = value;
  let note = '';
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (!('credits' in obj) || keys.some((k) => k !== 'credits' && k !== 'note')) {
      throw new Error(`${where} must be a number, [min, max], or {"credits": ..., "note": "..."}.`);
    }
    if (obj.note !== undefined && typeof obj.note !== 'string') {
      throw new Error(`${where} note must be a string.`);
    }
    note = String(obj.note ?? '').trim();
    raw = obj.credits;
  }
  if (Array.isArray(raw)) {
    if (raw.length !== 2) throw new Error(`${where} range must be [min, max].`);
    const low = parseNonNegativeNumber(raw[0], where);
    const high = parseNonNegativeNumber(raw[1], where);
    if (low > high) throw new Error(`${where} range must satisfy min <= max.`);
    return { low, high, note };
  }
  const amount = parseNonNegativeNumber(raw, where);
  return { low: amount, high: amount, note };
}

/** Validate a Hermes `costs` / `spend_limit` / `cost_unit` declaration. */
export function parseCostPolicy(input: {
  costs?: unknown;
  spendLimit?: unknown;
  costUnit?: unknown;
  where: string;
}): CostPolicy | null {
  const { costs, spendLimit, costUnit, where } = input;
  if (costs !== undefined && costs !== null && (typeof costs !== 'object' || Array.isArray(costs))) {
    throw new Error(`${where} costs must be an object mapping MCP tool names to costs.`);
  }
  const table: Record<string, ParsedToolCost> = {};
  for (const [tool, val] of Object.entries((costs as Record<string, unknown>) || {})) {
    if (!tool.trim()) throw new Error(`${where} costs keys must be non-empty MCP tool names.`);
    table[tool] = parseSingleCost(val, `${where} cost of '${tool}'`);
  }
  const limit =
    spendLimit === undefined || spendLimit === null
      ? 0
      : parseNonNegativeNumber(spendLimit, `${where} spend_limit`);
  const unit = costUnit === undefined || costUnit === null ? 'credits' : costUnit;
  if (typeof unit !== 'string' || !unit.trim() || unit.length > 32) {
    throw new Error(`${where} cost_unit must be a non-empty string up to 32 chars.`);
  }
  if (!Object.values(table).some((c) => c.high > 0)) return null;
  return { costs: table, limit, unit: unit.trim() };
}

/** Return cost-table keys that do not match any live tool exposed by `tools/list`. */
export function unknownCostKeys(
  policy: CostPolicy | null,
  liveToolNames: Iterable<string>,
): string[] {
  if (!policy) return [];
  const live = new Set(liveToolNames);
  return Object.keys(policy.costs)
    .filter((k) => !live.has(k))
    .sort();
}

const PLUGIN_NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SKILL_NAME_RE = /^(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_PLUGIN_FIELDS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'skills',
  'mcp',
  'extensions',
]);
const ALLOWED_SERVER_KEYS = new Set([
  'app',
  'requires',
  'liveness',
  'trust',
  'timeout',
  'costs',
  'spend_limit',
  'cost_unit',
]);

function isSafeRelativePluginPath(rel: unknown): boolean {
  if (typeof rel !== 'string' || !rel.trim()) return false;
  if (rel.startsWith('/') || rel.startsWith('\\') || /^[a-zA-Z]:/.test(rel)) return false;
  const segments = rel.split(/[\\/]+/);
  return !segments.includes('..');
}

function hasValidMcpTransport(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const srv = entry as Record<string, unknown>;
  if (typeof srv.command === 'string' && srv.command.trim().length > 0) return true;
  if (typeof srv.url === 'string' && srv.url.trim().length > 0) {
    return /^(?:https:\/\/|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$))/i.test(srv.url.trim());
  }
  return false;
}

export function validateAgentPluginManifest(
  manifest: unknown,
  mcpServers: Record<string, unknown>,
): { ok: true; costPolicies: Record<string, CostPolicy | null> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['plugin.json must contain a JSON object.'] };
  }
  const obj = manifest as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_PLUGIN_FIELDS.has(key)) {
      errors.push(`Unknown top-level plugin.json field: ${key}`);
    }
  }
  if (obj.$schema !== PLUGIN_SCHEMA_V1) {
    errors.push(`plugin.json $schema must equal ${PLUGIN_SCHEMA_V1}`);
  }
  if (typeof obj.name !== 'string' || obj.name.length < 1 || obj.name.length > 64 || !PLUGIN_NAME_RE.test(obj.name)) {
    errors.push('plugin.json name violates Agent Plugins v1 constraints.');
  }
  for (const field of ['version', 'description', 'homepage', 'repository', 'license'] as const) {
    if (obj[field] !== undefined && typeof obj[field] !== 'string') {
      errors.push(`plugin.json ${field} must be a string.`);
    }
  }
  if (obj.author !== undefined) {
    if (
      !obj.author ||
      typeof obj.author !== 'object' ||
      Array.isArray(obj.author) ||
      typeof (obj.author as Record<string, unknown>).name !== 'string' ||
      !(obj.author as Record<string, string>).name.trim()
    ) {
      errors.push('plugin.json author must be an object with a non-empty string name.');
    }
  }
  if (obj.skills !== undefined) {
    const skillPaths = typeof obj.skills === 'string' ? [obj.skills] : Array.isArray(obj.skills) ? obj.skills : null;
    if (!skillPaths || skillPaths.some((p) => !isSafeRelativePluginPath(p))) {
      errors.push('plugin.json skills paths must be safe relative paths without ".." traversal.');
    }
  }
  if (obj.mcp !== undefined && (typeof obj.mcp !== 'string' || !isSafeRelativePluginPath(obj.mcp))) {
    errors.push('plugin.json mcp path must be a safe relative path without ".." traversal.');
  }
  if (obj.keywords !== undefined) {
    if (!Array.isArray(obj.keywords) || obj.keywords.some((k) => typeof k !== 'string')) {
      errors.push('plugin.json keywords must be an array of strings.');
    }
  }
  const costPolicies: Record<string, CostPolicy | null> = {};
  const extensions = obj.extensions as Record<string, unknown> | undefined;
  const hermes = extensions?.[HERMES_EXTENSION_NAMESPACE] as Record<string, unknown> | undefined;
  const servers = hermes?.servers as Record<string, unknown> | undefined;
  if (servers !== undefined) {
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      errors.push(`extensions.${HERMES_EXTENSION_NAMESPACE}.servers must be an object.`);
    } else {
      for (const [serverName, rawDecl] of Object.entries(servers)) {
        if (!(serverName in mcpServers)) {
          errors.push(`Server declaration '${serverName}' has no matching mcp.json server.`);
          continue;
        }
        if (!hasValidMcpTransport(mcpServers[serverName])) {
          errors.push(`mcp.json server '${serverName}' must declare an https/loopback url or non-empty command.`);
        }
        if (!rawDecl || typeof rawDecl !== 'object' || Array.isArray(rawDecl)) {
          errors.push(`Server declaration '${serverName}' must be an object.`);
          continue;
        }
        const decl = rawDecl as Record<string, unknown>;
        for (const k of Object.keys(decl)) {
          if (!ALLOWED_SERVER_KEYS.has(k)) {
            errors.push(`Server declaration '${serverName}' contains unknown key '${k}'.`);
          }
        }
        if (decl.trust !== undefined && decl.trust !== 'trusted' && decl.trust !== 'untrusted') {
          errors.push(`Server declaration '${serverName}' trust must be 'trusted' or 'untrusted'.`);
        }
        if (
          decl.timeout !== undefined &&
          (typeof decl.timeout !== 'number' || !Number.isFinite(decl.timeout) || decl.timeout <= 0)
        ) {
          errors.push(`Server declaration '${serverName}' timeout must be a positive finite number.`);
        }
        if ('costs' in decl || 'spend_limit' in decl || 'cost_unit' in decl) {
          try {
            costPolicies[serverName] = parseCostPolicy({
              costs: decl.costs,
              spendLimit: decl.spend_limit,
              costUnit: decl.cost_unit,
              where: `server declaration '${serverName}'`,
            });
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
      }
    }
  }
  return errors.length === 0 ? { ok: true, costPolicies } : { ok: false, errors };
}

export function validatePortableMcpJson(
  config: unknown,
): { ok: true; servers: Record<string, Record<string, unknown>> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, errors: ['mcp.json must be a JSON object.'] };
  }
  const obj = config as Record<string, unknown>;
  const topKeys = Object.keys(obj).sort();
  if (topKeys.length !== 2 || topKeys[0] !== '$schema' || topKeys[1] !== 'mcpServers') {
    errors.push('mcp.json must have exact top-level keys {"$schema", "mcpServers"}.');
  }
  if (obj.$schema !== MCP_SCHEMA_V1) {
    errors.push(`mcp.json $schema must equal ${MCP_SCHEMA_V1}`);
  }
  const rawServers = obj.mcpServers;
  if (!rawServers || typeof rawServers !== 'object' || Array.isArray(rawServers)) {
    return { ok: false, errors: [...errors, 'mcpServers must be an object.'] };
  }
  const servers: Record<string, Record<string, unknown>> = {};
  for (const [name, entry] of Object.entries(rawServers as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`mcpServers.${name} must be an object.`);
      continue;
    }
    const srv = entry as Record<string, unknown>;
    if (srv.type === 'streamable-http') {
      for (const k of Object.keys(srv)) {
        if (k !== 'type' && k !== 'url' && k !== 'headers') {
          errors.push(`mcpServers.${name} contains unsupported remote field '${k}'.`);
        }
      }
      if (typeof srv.url !== 'string' || !srv.url) {
        errors.push(`mcpServers.${name}.url must be a non-empty string.`);
      } else {
        try {
          const parsed = new URL(srv.url);
          if (parsed.username || parsed.password) {
            errors.push(`mcpServers.${name}.url must not contain userinfo credentials.`);
          }
          if (parsed.hash) {
            errors.push(`mcpServers.${name}.url must not contain a URL fragment.`);
          }
          if (
            parsed.protocol !== 'https:' &&
            !(parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
          ) {
            errors.push(`mcpServers.${name}.url must use https for non-loopback hosts.`);
          }
        } catch {
          errors.push(`mcpServers.${name}.url is not a valid URL.`);
        }
      }
      if (srv.headers !== undefined) {
        errors.push(
          `mcpServers.${name}.headers should be omitted in portable mcp.json (configure user tokens in ~/.hermes/config.yaml).`,
        );
      }
      servers[name] = srv;
    } else {
      errors.push(`mcpServers.${name}.type '${String(srv.type)}' is not streamable-http.`);
    }
  }
  return errors.length === 0 ? { ok: true, servers } : { ok: false, errors };
}

export function validateSkillFrontmatter(
  frontmatter: Record<string, unknown>,
  directoryName: string,
): string | null {
  const name = frontmatter.name;
  if (
    typeof name !== 'string' ||
    name !== directoryName ||
    name.length < 1 ||
    name.length > 64 ||
    !SKILL_NAME_RE.test(name)
  ) {
    return `Skill '${directoryName}' frontmatter name must match directory and satisfy Agent Skills constraints.`;
  }
  const description = frontmatter.description;
  if (typeof description !== 'string' || description.length < 1 || description.length > 1024) {
    return `Skill '${directoryName}' description must be 1..1024 characters.`;
  }
  return null;
}
