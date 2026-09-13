/**
 * Schema.org JSON-LD safety gate for AEO remediations.
 * Blocks Critical deploys; warns on deprecated rich-result types.
 */

export type GateSeverity = 'ok' | 'warn' | 'critical';

export interface SchemaSafetyIssue {
  code: string;
  severity: GateSeverity;
  message: string;
}

export interface SchemaSafetyResult {
  okToDeploy: boolean;
  severity: GateSeverity;
  issues: SchemaSafetyIssue[];
  parsedTypes: string[];
  /** Re-serialized JSON with `<`, `>`, `&`, U+2028/9 escaped. Only set when okToDeploy; deployers must ship this, not the raw input. */
  canonicalJson?: string;
}

const DEPRECATED_RICH_RESULT_TYPES = new Set(['howto', 'faqpage']);

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

function stripFences(raw: string): { body: string; outsideFence: boolean } {
  const trimmed = (raw || '').trim();
  const fenced = trimmed.match(FENCE_RE);
  if (!fenced) return { body: trimmed, outsideFence: false };
  const outside = trimmed.replace(fenced[0], '').trim();
  return { body: fenced[1].trim(), outsideFence: outside.length > 0 };
}

// Any of these in the raw text or a decoded string can terminate a <script> block or open an HTML comment state.
const RAW_BREAKOUT_PATTERNS: RegExp[] = [
  /<\s*[\\/]+\s*script/i,
  /<!--/,
  /\\u003c\s*(?:\\u002f|\\?\/)+\s*script/i,
  /\\u003c\s*!\s*--/i,
];

const DECODED_BREAKOUT_PATTERNS: RegExp[] = [/<\s*[\\/]+\s*script/i, /<!--/];

function hasBreakout(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

function anyStringHasBreakout(node: unknown): boolean {
  if (typeof node === 'string') return hasBreakout(node, DECODED_BREAKOUT_PATTERNS);
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(anyStringHasBreakout);
  return Object.entries(node as Record<string, unknown>).some(
    ([k, v]) => hasBreakout(k, DECODED_BREAKOUT_PATTERNS) || anyStringHasBreakout(v),
  );
}

function toCanonicalJson(parsed: unknown): string {
  return JSON.stringify(parsed, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function collectTypes(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectTypes(item, out));
    return;
  }
  const obj = node as Record<string, unknown>;
  const t = obj['@type'];
  if (typeof t === 'string') out.push(t);
  else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && out.push(x));
  if (obj['@graph']) collectTypes(obj['@graph'], out);
  Object.values(obj).forEach((v) => {
    if (v && typeof v === 'object') collectTypes(v, out);
  });
}

function hasContext(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(hasContext);
  const obj = node as Record<string, unknown>;
  if (typeof obj['@context'] === 'string' || (obj['@context'] && typeof obj['@context'] === 'object')) {
    return true;
  }
  if (obj['@graph']) return hasContext(obj['@graph']);
  return false;
}

function blocked(issue: SchemaSafetyIssue): SchemaSafetyResult {
  return { okToDeploy: false, severity: 'critical', issues: [issue], parsedTypes: [] };
}

const BREAKOUT_ISSUE: SchemaSafetyIssue = {
  code: 'SCRIPT_BREAKOUT',
  severity: 'critical',
  message: 'Schema JSON-LD contains a </script> or <!-- sequence that could break out of the script tag.',
};

/**
 * Validates Schema.org JSON-LD before CMS / script-tag deployment.
 */
export function validateSchemaJsonLd(schemaJsonLd: string): SchemaSafetyResult {
  const issues: SchemaSafetyIssue[] = [];
  const parsedTypes: string[] = [];
  const input = typeof schemaJsonLd === 'string' ? schemaJsonLd : '';
  const { body: raw, outsideFence } = stripFences(input);

  if (!raw) {
    return blocked({
      code: 'EMPTY_SCHEMA',
      severity: 'critical',
      message: 'Schema JSON-LD is empty. Nothing to deploy.',
    });
  }

  if (hasBreakout(input, RAW_BREAKOUT_PATTERNS)) return blocked({ ...BREAKOUT_ISSUE });

  if (outsideFence) {
    return blocked({
      code: 'CONTENT_OUTSIDE_FENCE',
      severity: 'critical',
      message: 'Schema JSON-LD has extra text outside the JSON code block.',
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return blocked({
      code: 'INVALID_JSON',
      severity: 'critical',
      message: 'Schema JSON-LD is not valid JSON.',
    });
  }

  if (anyStringHasBreakout(parsed)) return blocked({ ...BREAKOUT_ISSUE });

  collectTypes(parsed, parsedTypes);
  const uniqueTypes = [...new Set(parsedTypes)];

  if (uniqueTypes.length === 0) {
    issues.push({
      code: 'MISSING_TYPE',
      severity: 'critical',
      message: 'No @type found on the schema graph. Entity type is required for AEO.',
    });
  }

  if (!hasContext(parsed)) {
    issues.push({
      code: 'MISSING_CONTEXT',
      severity: 'warn',
      message: 'Missing @context. Prefer "https://schema.org" for unambiguous parsing.',
    });
  }

  for (const t of uniqueTypes) {
    if (DEPRECATED_RICH_RESULT_TYPES.has(t.toLowerCase())) {
      issues.push({
        code: 'DEPRECATED_RICH_RESULT',
        severity: 'warn',
        message: `${t} no longer earns Google rich results. Prefer Organization/WebPage/Product entity graphs.`,
      });
    }
  }

  const hasCritical = issues.some((i) => i.severity === 'critical');
  const hasWarn = issues.some((i) => i.severity === 'warn');
  const severity: GateSeverity = hasCritical ? 'critical' : hasWarn ? 'warn' : 'ok';

  return {
    okToDeploy: !hasCritical,
    severity,
    issues,
    parsedTypes: uniqueTypes,
    canonicalJson: hasCritical ? undefined : toCanonicalJson(parsed),
  };
}

/**
 * Schema safety score for Trust Pack (0-100).
 * Critical = 0-40 band; warnings deduct; clean = 100.
 */
export function schemaSafetyScore(result: SchemaSafetyResult): number {
  if (!result.okToDeploy) {
    return Math.max(0, 35 - result.issues.filter((i) => i.severity === 'critical').length * 10);
  }
  const warnCount = result.issues.filter((i) => i.severity === 'warn').length;
  return Math.max(55, 100 - warnCount * 12);
}

export const schemaSafetyGate = {
  validate: validateSchemaJsonLd,
  score: schemaSafetyScore,
};
