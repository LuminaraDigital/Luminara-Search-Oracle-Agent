/**
 * Scoped threat-pattern scanner and two-tier scheduled-prompt guard.
 *
 * Adapted from NousResearch/hermes-agent (`tools/threat_patterns.py` and
 * `tools/cronjob_prompt_scan.py`) at commit ca2269588fd028adb41f3cc45875b04f3c0b88b4.
 * Copyright (c) 2025 Nous Research. Licensed under the MIT License (see THIRD_PARTY_NOTICES.md).
 *
 * Scope inclusion is cumulative (`all` subset of `context` subset of `strict`):
 * - `all`: unambiguous injection / exfiltration patterns everywhere.
 * - `context`: adds role hijack, C2 / promptware, and anti-forensic rules for
 *   untrusted context and tool results (warn-only; never bricks a legitimate read).
 * - `strict`: adds persistence, config mutation, context exfiltration, and
 *   hardcoded-secret rules for user-mediated writes (memory, skills, watches).
 */

export const MAX_SCAN_CHARS = 65_536;

export type ThreatScope = 'all' | 'context' | 'strict';
export type ThreatScanMode = 'off' | 'warn' | 'strict';

export interface ThreatEnvLike {
  THREAT_SCAN_MODE?: string;
}

export interface ThreatGateDecision {
  mode: ThreatScanMode;
  blocked: boolean;
  findings: string[];
  reason: string | null;
}

const FILLER = String.raw`(?:\w+\s+){0,8}`;
const SECRET_VAR = String.raw`\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)S?\b`;
const MODIFY = String.raw`(update|modify|edit|write|change|append|add\s+to)\s+[^\n]{0,2048}`;

interface PatternSpec {
  id: string;
  scope: ThreatScope;
  match: (normalised: string) => boolean;
}

function regexSpec(source: string, id: string, scope: ThreatScope): PatternSpec {
  const re = new RegExp(source, 'i');
  return { id, scope, match: (normalised: string) => re.test(normalised) };
}

const SECRET_ASSIGNMENT_RE = /(?:api[_-]?key|token|secret|password)\s*[=:]\s*(["'])/gi;
const SHOUTY_SNAKE_ENV_NAME_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+["']/;
const SECRET_VALUE_BODY_RE = /^[A-Za-z0-9+/=_-]{20,}/;

/**
 * Matches embedded secret literals (>= 20 base64/token chars) while skipping
 * SHOUTY_SNAKE environment variable names with >= 2 segments (such as
 * `ENV_PASSWORD = "MYPLUGIN_APP_PASSWORD"`). Implemented without Python-only
 * inline `(?-i:...)` flags so Node and Cloudflare Workers V8 behave identically.
 */
function matchesHardcodedSecret(normalised: string): boolean {
  SECRET_ASSIGNMENT_RE.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = SECRET_ASSIGNMENT_RE.exec(normalised)) !== null) {
    const rest = normalised.slice(hit.index + hit[0].length);
    if (SHOUTY_SNAKE_ENV_NAME_RE.test(rest)) continue;
    if (SECRET_VALUE_BODY_RE.test(rest)) return true;
  }
  return false;
}

const PATTERN_SPECS: readonly PatternSpec[] = [
  // Classic prompt injection (applies everywhere)
  regexSpec(String.raw`ignore\s+${FILLER}(previous|all|above|prior)\s+${FILLER}instructions`, 'prompt_injection', 'all'),
  regexSpec(String.raw`system\s+prompt\s+override`, 'sys_prompt_override', 'all'),
  regexSpec(String.raw`disregard\s+${FILLER}(your|all|any)\s+${FILLER}(instructions|rules|guidelines)`, 'disregard_rules', 'all'),
  regexSpec(
    String.raw`act\s+as\s+(if|though)\s+${FILLER}you\s+${FILLER}(have\s+no|don't\s+have)\s+${FILLER}(restrictions|limits|rules)`,
    'bypass_restrictions',
    'all',
  ),
  regexSpec(String.raw`<!--[^>]{0,512}(?:ignore|override|system|secret|hidden)[^>]{0,512}-->`, 'html_comment_injection', 'all'),
  regexSpec(String.raw`<\s*div\s+style\s*=\s*["'][^>]{0,2048}display\s*:\s*none`, 'hidden_div', 'all'),
  regexSpec(
    String.raw`translate\s+[^\n]{0,512}\s+into\s+\w+(?:[\s-]+\w+){0,2}\s+and\s+(execute|run|eval)\b`,
    'translate_execute',
    'all',
  ),
  regexSpec(String.raw`do\s+not\s+${FILLER}tell\s+${FILLER}the\s+user`, 'deception_hide', 'all'),

  // Role-play / identity hijack (scraped web content, untrusted context, tool results)
  regexSpec(String.raw`you\s+are\s+${FILLER}now\s+(?:a|an|the)\s+`, 'role_hijack', 'context'),
  regexSpec(String.raw`pretend\s+${FILLER}(you\s+are|to\s+be)\s+`, 'role_pretend', 'context'),
  regexSpec(String.raw`output\s+${FILLER}(system|initial)\s+prompt`, 'leak_system_prompt', 'context'),
  regexSpec(String.raw`(respond|answer|reply)\s+without\s+${FILLER}(restrictions|limitations|filters|safety)`, 'remove_filters', 'context'),
  regexSpec(String.raw`you\s+have\s+been\s+${FILLER}(updated|upgraded|patched)\s+to`, 'fake_update', 'context'),
  regexSpec(String.raw`\bname\s+yourself\s+\w+`, 'identity_override', 'context'),

  // C2 / Brainworm-style promptware (context scope: warn on read, block on strict write)
  regexSpec(String.raw`register\s+(as\s+)?a?\s*node`, 'c2_node_registration', 'context'),
  regexSpec(
    String.raw`(?:heartbeat|beacon)\s+(?:to|with)\s+|\bcheck[\s-]?in\s+(?:to|with)\s+(?:https?:\/\/|(?:\d{1,3}\.){3}\d{1,3}|\bc2\b|(?:the\s+)?(?:operator|command\s+server|listener)\b)`,
    'c2_heartbeat',
    'context',
  ),
  regexSpec(
    String.raw`\bpull\s+(?:down\s+)?(?:new\s+)?tasking\b|\bpull\s+(?:down\s+)?(?:new\s+)?tasks?\s+from\s+(?:https?:\/\/|(?:\d{1,3}\.){3}\d{1,3}|(?:the\s+)?(?:c2|beacon|implant|command\s+server|operator)\b)`,
    'c2_task_pull',
    'context',
  ),
  regexSpec(String.raw`connect\s+to\s+the\s+network\b`, 'c2_network_connect', 'context'),
  regexSpec(String.raw`you\s+must\s+(?:\w+\s+){0,3}(register|connect|report|beacon)\b`, 'forced_action', 'context'),
  regexSpec(String.raw`only\s+use\s+one[\s-]?liners?\b`, 'anti_forensic_oneliner', 'context'),
  regexSpec(String.raw`never\s+${FILLER}(?:create|write)\s+${FILLER}(?:script|file)\s+${FILLER}disk`, 'anti_forensic_disk', 'context'),
  regexSpec(String.raw`unset\s+\w*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC|LUMINARA)\w*`, 'env_var_unset_agent', 'context'),

  // Known C2 / offensive framework names
  regexSpec(
    String.raw`\b(?:cobalt\s*strike|metasploit|meterpreter|brainworm)\b|\b(?:sliver|havoc|mythic)\s+(?:c2|implant|beacon|listener|agent|server|framework)\b`,
    'known_c2_framework',
    'context',
  ),
  regexSpec(String.raw`\bc2\s+(?:server|channel|infrastructure|beacon)\b`, 'c2_explicit', 'context'),
  regexSpec(String.raw`\bcommand\s+and\s+control\b`, 'c2_explicit_long', 'context'),

  // Exfiltration via curl/wget/cat with secrets
  regexSpec(String.raw`curl\s+[^\n]{0,2048}${SECRET_VAR}`, 'exfil_curl', 'all'),
  regexSpec(String.raw`wget\s+[^\n]{0,2048}${SECRET_VAR}`, 'exfil_wget', 'all'),
  regexSpec(String.raw`cat\s+[^\n]{0,2048}(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)`, 'read_secrets', 'all'),
  regexSpec(
    String.raw`(send|post|upload|transmit)\s+[^\n]{0,2048}\b(?:secrets?|credentials?|tokens?|keys?|passwords?|\.env|env\s+vars?|cookies?|session|conversation|chat\s+history|messages?|memory|context|system\s+prompt|ssh|private)\b[^\n]{0,512}\s+(to|at)\s+https?://`,
    'send_to_url',
    'strict',
  ),
  regexSpec(
    String.raw`(include|output|print|share)\s+${FILLER}(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)`,
    'context_exfil',
    'strict',
  ),

  // Persistence / SSH / agent config modification (strict scope: writes only)
  regexSpec(String.raw`authorized_keys`, 'ssh_backdoor', 'strict'),
  regexSpec(
    String.raw`(?:\b(?:echo|cat|cp|mv|dd|tee|install|printf|rsync|scp|ln|append|add|write|sed|chmod|chown|truncate|rm|touch|curl|wget|git)\b|\bopen\s*\(|>>?)[^\n]{0,512}(?:\$HOME/\.ssh|~/\.ssh)`,
    'ssh_access',
    'strict',
  ),
  regexSpec(String.raw`\$HOME/\.hermes/\.env|~/\.hermes/\.env`, 'hermes_env', 'strict'),
  regexSpec(String.raw`${MODIFY}(?:AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.clinerules)`, 'agent_config_mod', 'strict'),
  regexSpec(String.raw`${MODIFY}\.hermes/(config\.yaml|SOUL\.md)`, 'hermes_config_mod', 'strict'),

  // Hardcoded secrets
  { id: 'hardcoded_secret', scope: 'strict', match: matchesHardcodedSecret },
];

export const INVISIBLE_CHAR_LIST: readonly string[] = [
  '\u00ad',
  '\u034f',
  '\u061c',
  '\u200b',
  '\u200c',
  '\u200d',
  '\u2060',
  '\u2061',
  '\u2062',
  '\u2063',
  '\u2064',
  '\ufeff',
  '\u202a',
  '\u202b',
  '\u202c',
  '\u202d',
  '\u202e',
  '\u2066',
  '\u2067',
  '\u2068',
  '\u2069',
];

export const INVISIBLE_CHARS: ReadonlySet<string> = new Set(INVISIBLE_CHAR_LIST);

function isVariationSelectorCp(cp: number): boolean {
  return cp >= 0xfe00 && cp <= 0xfe0f;
}

function isUnicodeTagCp(cp: number): boolean {
  return cp >= 0xe0000 && cp <= 0xe007f;
}

const SCOPE_TARGETS: Record<ThreatScope, readonly ThreatScope[]> = {
  all: ['all', 'context', 'strict'],
  context: ['context', 'strict'],
  strict: ['strict'],
};

function buildCompiledByScope(): Record<ThreatScope, PatternSpec[]> {
  const out: Record<ThreatScope, PatternSpec[]> = { all: [], context: [], strict: [] };
  for (const spec of PATTERN_SPECS) {
    for (const target of SCOPE_TARGETS[spec.scope]) {
      out[target].push(spec);
    }
  }
  return out;
}

const COMPILED = buildCompiledByScope();

const EMOJI_NEIGHBOUR_CP_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1f000, 0x1ffff],
  [0x2600, 0x27bf],
  [0x2300, 0x23ff],
  [0x1f1e6, 0x1f1ff],
  [0x20e3, 0x20e3],
];
const VARIATION_SELECTOR_CP = 0xfe0f;

function isEmojiNeighbourCodepoint(cp: number): boolean {
  return EMOJI_NEIGHBOUR_CP_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/**
 * Operates on Unicode codepoint arrays (`Array.from(str)`) rather than UTF-16
 * indices so astral-plane emojis (`U+1F468` etc.) are inspected accurately.
 */
function zwjHasEmojiNeighbour(codepoints: readonly string[], idx: number): boolean {
  let left = idx - 1;
  while (left >= 0 && codepoints[left].codePointAt(0) === VARIATION_SELECTOR_CP) left -= 1;
  let right = idx + 1;
  while (right < codepoints.length && codepoints[right].codePointAt(0) === VARIATION_SELECTOR_CP) right += 1;
  if (left < 0 || right >= codepoints.length) return false;
  const leftCp = codepoints[left].codePointAt(0) ?? 0;
  const rightCp = codepoints[right].codePointAt(0) ?? 0;
  return isEmojiNeighbourCodepoint(leftCp) && isEmojiNeighbourCodepoint(rightCp);
}

function formatCodepoint(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Strip invisible-unicode codepoints while preserving ZWJ (`U+200D`) and emoji
 * presentation selectors (`U+FE0E`/`U+FE0F`) inside emoji grapheme clusters.
 */
export function stripInvisibleUnicode(text: string): { cleaned: string; removed: string[] } {
  if (!text) return { cleaned: text, removed: [] };
  const cps = Array.from(text);
  const removed = new Set<string>();
  const kept: string[] = [];
  for (let idx = 0; idx < cps.length; idx += 1) {
    const ch = cps[idx];
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '\u200d' && zwjHasEmojiNeighbour(cps, idx)) {
      kept.push(ch);
      continue;
    }
    if ((cp === 0xfe0e || cp === 0xfe0f) && idx > 0 && isEmojiNeighbourCodepoint(cps[idx - 1].codePointAt(0) ?? 0)) {
      kept.push(ch);
      continue;
    }
    if (INVISIBLE_CHARS.has(ch) || isVariationSelectorCp(cp) || isUnicodeTagCp(cp)) {
      removed.add(formatCodepoint(ch));
      continue;
    }
    kept.push(ch);
  }
  return { cleaned: kept.join(''), removed: [...removed].sort() };
}

/**
 * Scan `content` for threat pattern IDs in `scope` (`'context'` by default).
 * Invisible unicode is checked and stripped on raw input before NFKC normalization
 * so smuggled characters (soft hyphens, variation selectors, Unicode tags) neither
 * disappear silently nor split keywords across regex boundaries.
 */
export function scanForThreats(content: string, scope: ThreatScope = 'context'): string[] {
  if (!content) return [];
  const patterns = COMPILED[scope];
  if (!patterns) {
    throw new Error(`scanForThreats: unknown scope "${String(scope)}"`);
  }
  const bounded = content.slice(0, MAX_SCAN_CHARS);
  const { cleaned, removed } = stripInvisibleUnicode(bounded);
  const findings: string[] = removed.map((cp) => `invisible_unicode_${cp}`);
  const normalised = cleaned.normalize('NFKC');
  for (const spec of patterns) {
    if (spec.match(normalised)) findings.push(spec.id);
  }
  return findings;
}

export function formatFirstThreatFinding(findings: readonly string[]): string | null {
  if (!findings.length) return null;
  const pid = findings[0];
  if (pid === 'payload_exceeds_scan_limit') {
    return `Blocked: content exceeds maximum threat-scan length (${MAX_SCAN_CHARS} chars).`;
  }
  if (pid.startsWith('invisible_unicode_')) {
    const codepoint = pid.slice('invisible_unicode_'.length);
    return `Blocked: content contains invisible unicode character ${codepoint} (possible injection).`;
  }
  return (
    `Blocked: content matches threat pattern '${pid}'. ` +
    'Content enters an agent prompt context and must not contain injection or exfiltration payloads.'
  );
}

/** User-facing error for the first threat found, or `null` when clean. */
export function firstThreatMessage(content: string, scope: ThreatScope = 'strict'): string | null {
  return formatFirstThreatFinding(scanForThreats(content, scope));
}

// ---------------------------------------------------------------------------
// Two-tier scheduled prompt scanning (`cronjob_prompt_scan.py`)
// ---------------------------------------------------------------------------

const CRON_SECRET_VAR_RE = String.raw`\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)\w*\}?`;

const CRON_THREAT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ignore\s+(?:\w+\s+){0,8}(?:previous|all|above|prior)\s+(?:\w+\s+){0,8}instructions/i, 'prompt_injection'],
  [/do\s+not\s+(?:\w+\s+){0,8}tell\s+(?:\w+\s+){0,8}the\s+user/i, 'deception_hide'],
  [/system\s+prompt\s+override/i, 'sys_prompt_override'],
  [/disregard\s+(?:\w+\s+){0,8}(?:your|all|any)\s+(?:\w+\s+){0,8}(?:instructions|rules|guidelines)/i, 'disregard_rules'],
  [/cat\s+[^\n]{0,2048}(\.env|credentials|\.netrc|\.pgpass|id_rsa|id_ed25519|id_ecdsa)/i, 'read_secrets'],
  [/authorized_keys/i, 'ssh_backdoor'],
  [/\/etc\/sudoers|visudo/i, 'sudoers_mod'],
  [/rm\s+-rf\s+\//i, 'destructive_root_rm'],
];

const CRON_SKILL_ASSEMBLED_PATTERNS = CRON_THREAT_PATTERNS.slice(0, 4);

const CRON_EXFIL_COMMAND_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [new RegExp(String.raw`curl\s+[^\n]{0,2048}https?://[^\s"'` + '`' + String.raw`]*${CRON_SECRET_VAR_RE}`, 'i'), 'exfil_curl_url'],
  [new RegExp(String.raw`wget\s+[^\n]{0,2048}https?://[^\s"'` + '`' + String.raw`]*${CRON_SECRET_VAR_RE}`, 'i'), 'exfil_wget_url'],
  [
    new RegExp(String.raw`curl\s+[^\n]{0,2048}(?:--data(?:-raw|-binary|-urlencode)?|-d|--form|-F)\s+[^\n]{0,2048}${CRON_SECRET_VAR_RE}`, 'i'),
    'exfil_curl_data',
  ],
  [new RegExp(String.raw`wget\s+[^\n]{0,2048}--post-(?:data|file)=[^\n]{0,2048}${CRON_SECRET_VAR_RE}`, 'i'), 'exfil_wget_post'],
  [
    new RegExp(String.raw`curl\s+[^\n]{0,2048}(?:-H|--header)\s+["']Authorization:\s*(?:Bearer|token)\s+${CRON_SECRET_VAR_RE}["']`, 'i'),
    'exfil_curl_auth_header',
  ],
];

const SAFE_GITHUB_CURL_RE = new RegExp(
  String.raw`curl\s+[^\n;&|$` +
    '`' +
    String.raw`]*(?:-H|--header)\s+["']Authorization:\s*token\s+${CRON_SECRET_VAR_RE}["']\s+["']?https://api\.github\.com(?::\d+)?(?:/|\s|$|["'])[^\s;&|$` +
    '`' +
    String.raw`]*`,
  'gi',
);

function stripCronSafeConstructs(prompt: string): string {
  return prompt.replace(SAFE_GITHUB_CURL_RE, 'curl https://api.github.com/user');
}

function firstCronPatternError(
  text: string,
  ...sets: ReadonlyArray<ReadonlyArray<readonly [RegExp, string]>>
): { pid: string; message: string } | null {
  const normalised = text.normalize('NFKC');
  for (const patterns of sets) {
    for (const [re, pid] of patterns) {
      if (re.test(normalised)) {
        return {
          pid,
          message: `Blocked: prompt matches threat pattern '${pid}'. Scheduled prompts must not contain injection or exfiltration payloads.`,
        };
      }
    }
  }
  return null;
}

/**
 * Strict scan of a user-supplied scheduled prompt (Citation Watch / scheduled job).
 * Returns `null` when clean, or `{ pid, message }` when blocked.
 */
export function scanScheduledPrompt(prompt: string): { pid: string; message: string } | null {
  if (!prompt) return null;
  if (prompt.length > MAX_SCAN_CHARS) {
    return {
      pid: 'payload_exceeds_scan_limit',
      message: `Blocked: prompt exceeds maximum threat-scan length (${MAX_SCAN_CHARS} chars).`,
    };
  }
  const safeStripped = stripCronSafeConstructs(prompt);
  const { cleaned, removed } = stripInvisibleUnicode(safeStripped);
  if (removed.length > 0) {
    const cp = removed[0];
    return {
      pid: `invisible_unicode_${cp}`,
      message: `Blocked: prompt contains invisible unicode ${cp} (possible injection).`,
    };
  }
  const cronHit = firstCronPatternError(cleaned, CRON_THREAT_PATTERNS, CRON_EXFIL_COMMAND_PATTERNS);
  if (cronHit) return cronHit;
  const strictHits = scanForThreats(cleaned, 'strict');
  if (strictHits.length > 0) {
    const pid = strictHits[0];
    return {
      pid,
      message: `Blocked: prompt matches threat pattern '${pid}'. Scheduled prompts must not contain injection or exfiltration payloads.`,
    };
  }
  return null;
}

/**
 * Loose scan of an assembled scheduled prompt (including vetted playbook/skill prose).
 * Invisible unicode is sanitized rather than hard-blocking the scheduled run, and
 * command-shape rules are omitted so security runbooks do not false-positive.
 */
export function scanAssembledScheduledPrompt(assembled: string): {
  cleaned: string;
  strippedUnicode: string[];
  error: { pid: string; message: string } | null;
} {
  if (!assembled) return { cleaned: assembled, strippedUnicode: [], error: null };
  const bounded = assembled.slice(0, MAX_SCAN_CHARS);
  const { cleaned, removed } = stripInvisibleUnicode(bounded);
  const error = firstCronPatternError(stripCronSafeConstructs(cleaned), CRON_SKILL_ASSEMBLED_PATTERNS);
  return { cleaned, strippedUnicode: removed, error };
}

// ---------------------------------------------------------------------------
// Runtime mode resolution & unified write/cron gates
// ---------------------------------------------------------------------------

/** Operator kill-switch: defaults to `'off'` until `THREAT_SCAN_MODE` is `'warn'` or `'strict'`. */
export function resolveThreatScanMode(env?: ThreatEnvLike | null): ThreatScanMode {
  const raw = String(env?.THREAT_SCAN_MODE || '').trim().toLowerCase();
  if (raw === 'warn' || raw === 'strict') return raw;
  return 'off';
}

/** Evaluate a user-mediated write (`strict` scope) under `env.THREAT_SCAN_MODE`. */
export function evaluateStrictWriteGate(env: ThreatEnvLike | null | undefined, content: string): ThreatGateDecision {
  const mode = resolveThreatScanMode(env);
  if (mode === 'off') return { mode, blocked: false, findings: [], reason: null };
  const findings = scanForThreats(content, 'strict');
  if (content.length > MAX_SCAN_CHARS) {
    findings.unshift('payload_exceeds_scan_limit');
  }
  if (!findings.length) return { mode, blocked: false, findings: [], reason: null };
  return {
    mode,
    blocked: mode === 'strict',
    findings,
    reason: formatFirstThreatFinding(findings),
  };
}

/** Evaluate a list of scheduled user prompts (`scanScheduledPrompt`) under `env.THREAT_SCAN_MODE`. */
export function evaluateScheduledPromptsGate(
  env: ThreatEnvLike | null | undefined,
  prompts: readonly string[],
): ThreatGateDecision {
  const mode = resolveThreatScanMode(env);
  if (mode === 'off') return { mode, blocked: false, findings: [], reason: null };
  for (const prompt of prompts) {
    const hit = scanScheduledPrompt(prompt);
    if (hit) {
      return {
        mode,
        blocked: mode === 'strict',
        findings: [hit.pid],
        reason: hit.message,
      };
    }
  }
  return { mode, blocked: false, findings: [], reason: null };
}
