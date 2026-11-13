/**
 * Deterministic agent output validators.
 *
 * Pure functions only: no I/O, no env imports, no LLM calls.
 * Wired into Oracle SSE via worker/oracleChat.ts: findings land on the
 * provenance event (v1 never blocks the stream).
 */

import {
  UNVERIFIED_SECTION_HEADING,
  detectUnverifiedFactLeakage,
  parseUnverifiedSection,
} from '../services/trust/epistemicStance';
import type { GroundedCitationLedger } from '../services/audit/groundedCitations';

export type ValidatorFinding = {
  validator: string;
  severity: 'info' | 'warn' | 'block';
  span: { start: number; end: number };
  excerpt: string;
  detail: string;
};

export const BANNED_VENDOR_TERMS: readonly string[] = [
  'wger',
  'openfoodfacts',
  'coincompass',
  'paperclip',
  'dataforseo sandbox',
];

const LONG_METRIC_TERMS: readonly string[] = [
  'domain authority',
  'authority score',
  'domain rating',
  'trust flow',
  'citation flow',
  'page authority',
  'spam score',
  'organic traffic',
  'keyword difficulty',
  'backlink count',
  'visibility score',
];

// Compiled once at module scope.
const LONG_METRIC_RE = new RegExp(
  LONG_METRIC_TERMS.map((t) => t.replace(/ /g, '\\s+')).join('|'),
  'gi',
);
const SHORT_DR_RE = /\bDR\b/g;
const SHORT_KD_RE = /\bKD\b/g;
const NUMBER_RE = /\d+(?:\.\d+)?%?/g;

const ATTRIBUTION_RE =
  /according to|source:|studies show|data shows|research indicates/gi;
const MD_LINK_RE = /\[[^\]]+\]\(https?:\/\/[^)]+\)/;
const BARE_URL_RE = /https?:\/\/\S+/;
const FOOTNOTE_RE = /\[\d+\]/;

const UNMEASURED_RE = /not_measured|not_configured/g;

const VENDOR_RE = new RegExp(
  `\\b(?:${BANNED_VENDOR_TERMS.map((t) => t.replace(/ /g, '\\s+')).join('|')})\\b`,
  'gi',
);

const PROXIMITY_CHARS = 40;
const AFTER_WINDOW_CHARS = 200;
const EXCERPT_RADIUS = 40;

function normalizeExcerpt(text: string, start: number, end: number): string {
  const from = Math.max(0, start - EXCERPT_RADIUS);
  const to = Math.min(text.length, end + EXCERPT_RADIUS);
  return text.slice(from, to).replace(/\s+/g, ' ').trim().slice(0, 80);
}

function findMetricSpans(text: string): Array<{ start: number; end: number; term: string }> {
  const spans: Array<{ start: number; end: number; term: string }> = [];
  for (const re of [LONG_METRIC_RE, SHORT_DR_RE, SHORT_KD_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, term: m[0] });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return spans;
}

function findNumberSpans(text: string): Array<{ start: number; end: number; raw: string; value: number }> {
  const spans: Array<{ start: number; end: number; raw: string; value: number }> = [];
  NUMBER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_RE.exec(text)) !== null) {
    const raw = m[0];
    const numeric = parseFloat(raw.replace(/%$/, ''));
    spans.push({ start: m.index, end: m.index + raw.length, raw, value: numeric });
  }
  return spans;
}

export function noInventedMetrics(
  text: string,
  ctx?: { evidenceNumbers?: number[] },
): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];
  if (!text) return findings;
  const metrics = findMetricSpans(text);
  if (metrics.length === 0) return findings;
  const numbers = findNumberSpans(text);
  const evidence = new Set(ctx?.evidenceNumbers ?? []);
  for (const num of numbers) {
    for (const met of metrics) {
      // Number within 40 chars before or after the metric term span.
      const before = num.end <= met.start && met.start - num.end <= PROXIMITY_CHARS;
      const after = num.start >= met.end && num.start - met.end <= PROXIMITY_CHARS;
      if (!before && !after) continue;
      if (evidence.has(num.value)) continue;
      findings.push({
        validator: 'noInventedMetrics',
        severity: 'warn',
        span: { start: num.start, end: num.end },
        excerpt: normalizeExcerpt(text, num.start, num.end),
        detail: `Numeric value "${num.raw}" appears near metric term "${met.term}" without backing evidence.`,
      });
    }
  }
  return findings;
}

export function hasCitationsWhenClaiming(text: string): ValidatorFinding[] {
  if (!text) return [];
  ATTRIBUTION_RE.lastIndex = 0;
  const first = ATTRIBUTION_RE.exec(text);
  if (!first) return [];
  const hasCitation =
    MD_LINK_RE.test(text) || BARE_URL_RE.test(text) || FOOTNOTE_RE.test(text);
  if (hasCitation) return [];
  return [
    {
      validator: 'hasCitationsWhenClaiming',
      severity: 'warn',
      span: { start: first.index, end: first.index + first[0].length },
      excerpt: normalizeExcerpt(text, first.index, first.index + first[0].length),
      detail: `Attribution phrase "${first[0]}" used without any citation marker (link, URL, or footnote ref).`,
    },
  ];
}

export function notMeasuredHonesty(text: string): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];
  if (!text) return findings;
  UNMEASURED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const tokens: Array<{ start: number; end: number; token: string }> = [];
  while ((m = UNMEASURED_RE.exec(text)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, token: m[0] });
  }
  if (tokens.length === 0) return findings;

  LONG_METRIC_RE.lastIndex = 0;
  const metricSpans: Array<{ start: number; end: number; term: string }> = [];
  let mm: RegExpExecArray | null;
  while ((mm = LONG_METRIC_RE.exec(text)) !== null) {
    metricSpans.push({ start: mm.index, end: mm.index + mm[0].length, term: mm[0] });
  }
  if (metricSpans.length === 0) return findings;
  const numbers = findNumberSpans(text);

  for (const tok of tokens) {
    const windowEnd = Math.min(text.length, tok.end + AFTER_WINDOW_CHARS);
    for (const met of metricSpans) {
      if (met.start < tok.end || met.start > windowEnd) continue;
      for (const num of numbers) {
        const before = num.end <= met.start && met.start - num.end <= PROXIMITY_CHARS;
        const after = num.start >= met.end && num.start - met.end <= PROXIMITY_CHARS;
        if (!before && !after) continue;
        findings.push({
          validator: 'notMeasuredHonesty',
          severity: 'block',
          span: { start: num.start, end: num.end },
          excerpt: normalizeExcerpt(text, num.start, num.end),
          detail: `Metric "${met.term}" restated as number "${num.raw}" within 200 chars after "${tok.token}".`,
        });
      }
    }
  }
  return findings;
}

export function noVendorNames(text: string): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];
  if (!text) return findings;
  VENDOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VENDOR_RE.exec(text)) !== null) {
    findings.push({
      validator: 'noVendorNames',
      severity: 'info',
      span: { start: m.index, end: m.index + m[0].length },
      excerpt: normalizeExcerpt(text, m.index, m.index + m[0].length),
      detail: `Banned vendor term "${m[0]}" appears in user-visible copy.`,
    });
  }
  return findings;
}

export function epistemicStanceHonesty(
  text: string,
  opts?: { requireSection?: boolean; blockOnLeakage?: boolean },
): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];
  if (!text) return findings;

  const parsed = parseUnverifiedSection(text);
  if (opts?.requireSection && !parsed.hasSection) {
    findings.push({
      validator: 'epistemicStanceHonesty',
      severity: 'warn',
      span: { start: 0, end: Math.min(text.length, 40) },
      excerpt: normalizeExcerpt(text, 0, Math.min(text.length, 40)),
      detail: `Missing required "${UNVERIFIED_SECTION_HEADING}" section.`,
    });
  }

  for (const hit of detectUnverifiedFactLeakage(text)) {
    findings.push({
      validator: 'epistemicStanceHonesty',
      severity: opts?.blockOnLeakage ? 'block' : 'warn',
      span: hit.span,
      excerpt: hit.excerpt,
      detail:
        hit.kind === 'inline_unverified_outside_section'
          ? `Inline "UNVERIFIED:" marker emitted outside "${UNVERIFIED_SECTION_HEADING}".`
          : `Unverified hypothesis "${hit.claim}" restated as unqualified fact in main body.`,
    });
  }

  return findings;
}

export function groundedCitationsHonesty(
  text: string,
  ledger: GroundedCitationLedger,
  opts?: { requireEvidenceQuotes?: boolean },
): ValidatorFinding[] {
  const findings: ValidatorFinding[] = [];
  if (!text) return findings;
  const check = ledger.verifyDraft(text, {
    requireEvidenceQuotes: opts?.requireEvidenceQuotes,
  });

  for (const unknownId of check.unknownIds) {
    const marker = `[${unknownId}]`;
    const idx = Math.max(0, text.indexOf(marker));
    findings.push({
      validator: 'groundedCitationsHonesty',
      severity: 'block',
      span: { start: idx, end: idx + marker.length },
      excerpt: normalizeExcerpt(text, idx, idx + marker.length),
      detail: `Citation marker [${unknownId}] does not match any registered source in the ledger.`,
    });
  }

  for (const missingId of check.missingEvidenceIds) {
    const marker = `[${missingId}]`;
    const idx = Math.max(0, text.indexOf(marker));
    findings.push({
      validator: 'groundedCitationsHonesty',
      severity: 'warn',
      span: { start: idx, end: idx + marker.length },
      excerpt: normalizeExcerpt(text, idx, idx + marker.length),
      detail: `Cited source [${missingId}] has no verified verbatim quote attached.`,
    });
  }

  for (const mismatch of check.mismatchedSources) {
    findings.push({
      validator: 'groundedCitationsHonesty',
      severity: 'warn',
      span: { start: 0, end: Math.min(text.length, 40) },
      excerpt: normalizeExcerpt(text, 0, Math.min(text.length, 40)),
      detail: mismatch,
    });
  }

  return findings;
}

const SEVERITY_ORDER: Record<ValidatorFinding['severity'], number> = {
  block: 0,
  warn: 1,
  info: 2,
};

export function runAllValidators(
  text: string,
  ctx?: {
    evidenceNumbers?: number[];
    requireEpistemicSection?: boolean;
    groundedLedger?: GroundedCitationLedger;
    requireEvidenceQuotes?: boolean;
  },
): { ok: boolean; findings: ValidatorFinding[] } {
  const findings: ValidatorFinding[] = [
    ...noInventedMetrics(text, ctx),
    ...hasCitationsWhenClaiming(text),
    ...notMeasuredHonesty(text),
    ...noVendorNames(text),
    ...epistemicStanceHonesty(text, { requireSection: ctx?.requireEpistemicSection }),
    ...(ctx?.groundedLedger
      ? groundedCitationsHonesty(text, ctx.groundedLedger, {
          requireEvidenceQuotes: ctx.requireEvidenceQuotes,
        })
      : []),
  ];
  findings.sort(
    (a, b) =>
      a.span.start - b.span.start ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  const blocks = findings.reduce((n, f) => (f.severity === 'block' ? n + 1 : n), 0);
  return { ok: blocks === 0, findings };
}

export function summarizeFindings(findings: ValidatorFinding[]): {
  block: number;
  warn: number;
  info: number;
} {
  let block = 0;
  let warn = 0;
  let info = 0;
  for (const f of findings) {
    if (f.severity === 'block') block++;
    else if (f.severity === 'warn') warn++;
    else info++;
  }
  return { block, warn, info };
}
