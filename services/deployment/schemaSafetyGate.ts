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
}

const DEPRECATED_RICH_RESULT_TYPES = new Set(['howto', 'faqpage']);

function stripFences(raw: string): string {
  const trimmed = (raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : trimmed;
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

/**
 * Validates Schema.org JSON-LD before CMS / script-tag deployment.
 */
export function validateSchemaJsonLd(schemaJsonLd: string): SchemaSafetyResult {
  const issues: SchemaSafetyIssue[] = [];
  const parsedTypes: string[] = [];
  const raw = stripFences(schemaJsonLd);

  if (!raw) {
    issues.push({
      code: 'EMPTY_SCHEMA',
      severity: 'critical',
      message: 'Schema JSON-LD is empty. Nothing to deploy.',
    });
    return { okToDeploy: false, severity: 'critical', issues, parsedTypes };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    issues.push({
      code: 'INVALID_JSON',
      severity: 'critical',
      message: 'Schema JSON-LD is not valid JSON.',
    });
    return { okToDeploy: false, severity: 'critical', issues, parsedTypes };
  }

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
