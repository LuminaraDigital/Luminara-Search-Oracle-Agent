/**
 * Writing check: grammar / spelling / style issues plus readability for the audited page and for
 * the text inside generated schema JSON-LD.
 *
 * Grammar/style matches come from a self-hosted LanguageTool HTTP server reached through
 * `sidecarFetch('languagetool', ...)`. Readability is always computed locally, so the report is
 * still useful when the grammar service is unreachable (`available: false`).
 */
import { sidecarFetch } from '../apiClient';
import { configService } from '../configService';

export type WritingIssueCategory = 'spelling' | 'grammar' | 'style' | 'clarity' | 'other';

export interface WritingIssue {
  id: string;
  category: WritingIssueCategory;
  message: string;
  snippet: string;
  suggestion?: string;
  offset: number;
  length: number;
  ruleId: string;
  /** Schema field path (e.g. "description" or "mainEntity[1].acceptedAnswer.text") when checking JSON-LD. */
  field?: string;
}

export interface Readability {
  fleschReadingEase: number;
  gradeLevel: number;
  avgSentenceLength: number;
  longSentences: number;
  label: string;
}

export interface WritingQualityReport {
  /** false = grammar service unreachable; readability still computed locally. */
  available: boolean;
  /** 0-100 */
  score: number;
  grade: 'Excellent' | 'Good' | 'Needs work' | 'Poor';
  wordCount: number;
  sentenceCount: number;
  readability: Readability;
  issues: WritingIssue[];
  counts: Record<WritingIssueCategory, number>;
  /** <=5 plain-English fixes, deduplicated by message, most impactful first. */
  topFixes: string[];
  /** One sentence: what this means for being quoted by AI assistants. */
  aiAnswerNote: string;
  /** Detected language code from the service, if present. */
  language?: string;
  checkedChars: number;
  checkedAt: number;
}

export interface CheckTextOptions {
  language?: string;
  maxChars?: number;
  timeoutMs?: number;
}

export interface SchemaStringEntry {
  field: string;
  value: string;
}

const LONG_SENTENCE_WORDS = 25;
const DEFAULT_MAX_CHARS = 20000;
const DEFAULT_TIMEOUT_MS = 10000;

const CATEGORY_WEIGHT: Record<WritingIssueCategory, number> = {
  spelling: 6,
  grammar: 5,
  style: 2,
  clarity: 2,
  other: 1,
};

// ---- Pure helpers ----------------------------------------------------------------------------

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && /[A-Za-z0-9]/.test(s));
}

export function countWords(text: string): number {
  const m = text.match(/[A-Za-z0-9À-ÿ'’-]+/g);
  return m ? m.length : 0;
}

/** Heuristic English syllable counter (good enough for Flesch on web copy). */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  let s = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const groups = s.match(/[aeiouy]{1,2}/g);
  let count = groups ? groups.length : 0;
  if (/le$/.test(w) && !/[aeiouy]le$/.test(w) && w.length > 3) count += 1;
  return Math.max(1, count);
}

export function readabilityLabel(fre: number): string {
  if (fre >= 90) return 'Very easy to read';
  if (fre >= 80) return 'Easy to read';
  if (fre >= 70) return 'Fairly easy';
  if (fre >= 60) return 'Standard';
  if (fre >= 50) return 'Fairly hard';
  return 'Hard to read';
}

export function computeReadability(text: string): Readability & { wordCount: number; sentenceCount: number } {
  const sentences = splitSentences(text);
  const words = text.match(/[A-Za-z0-9À-ÿ'’-]+/g) || [];
  const wordCount = words.length;
  const sentenceCount = Math.max(sentences.length, wordCount > 0 ? 1 : 0);
  if (wordCount === 0) {
    return { fleschReadingEase: 0, gradeLevel: 0, avgSentenceLength: 0, longSentences: 0, label: 'Hard to read', wordCount: 0, sentenceCount: 0 };
  }
  const syllables = words.reduce((acc, w) => acc + countSyllables(w), 0);
  const wps = wordCount / sentenceCount;
  const spw = syllables / wordCount;
  const fre = Math.round(Math.max(0, Math.min(121, 206.835 - 1.015 * wps - 84.6 * spw)) * 10) / 10;
  const grade = Math.round(Math.max(0, 0.39 * wps + 11.8 * spw - 15.59) * 10) / 10;
  const longSentences = sentences.filter(s => countWords(s) > LONG_SENTENCE_WORDS).length;
  return {
    fleschReadingEase: fre,
    gradeLevel: grade,
    avgSentenceLength: Math.round(wps * 10) / 10,
    longSentences,
    label: readabilityLabel(fre),
    wordCount,
    sentenceCount,
  };
}

export function scoreReport(counts: Record<WritingIssueCategory, number>, wordCount: number, fleschReadingEase: number): { score: number; grade: WritingQualityReport['grade'] } {
  let score = 100;
  const per100 = wordCount > 0 ? 100 / wordCount : 0;
  (Object.keys(CATEGORY_WEIGHT) as WritingIssueCategory[]).forEach(cat => {
    score -= (counts[cat] || 0) * per100 * CATEGORY_WEIGHT[cat];
  });
  const readabilityPenalty = fleschReadingEase >= 60 ? 0 : Math.min(15, (60 - fleschReadingEase) / 3);
  score -= readabilityPenalty;
  score = Math.round(Math.max(0, Math.min(100, score)));
  return { score, grade: gradeFor(score) };
}

export function gradeFor(score: number): WritingQualityReport['grade'] {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Needs work';
  return 'Poor';
}

export function mapCategory(match: any): WritingIssueCategory {
  const issueType = String(match?.rule?.issueType || '').toLowerCase();
  const catId = String(match?.rule?.category?.id || '').toUpperCase();
  const ruleId = String(match?.rule?.id || '').toUpperCase();
  if (/LONG_SENTENCE|TOO_LONG|SENTENCE_LENGTH|READABILITY|PASSIVE_VOICE/.test(ruleId) || (catId === 'STYLE' && /long/i.test(String(match?.message || '')))) return 'clarity';
  if (issueType === 'misspelling' || catId === 'TYPOS' || catId === 'MISSPELLING') return 'spelling';
  if (issueType === 'grammar' || catId === 'GRAMMAR') return 'grammar';
  if (['style', 'typographical', 'register', 'redundancy', 'locale-violation', 'inconsistency'].includes(issueType) || ['STYLE', 'TYPOGRAPHY', 'REDUNDANCY', 'CASING', 'PUNCTUATION'].includes(catId)) return 'style';
  return 'other';
}

const TEXT_KEYS = new Set([
  'name', 'alternateName', 'description', 'slogan', 'headline', 'text', 'answerText',
  'articleBody', 'caption', 'abstract', 'reviewBody',
]);

function looksLikeNonProse(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (/^(https?:\/\/|mailto:|tel:|www\.)/i.test(v)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return true; // ISO date
  if (/^[#@]/.test(v)) return true;
  if (/^[\w-]+$/.test(v) && /\d/.test(v) && !/\s/.test(v)) return true; // id-like tokens
  return false;
}

/**
 * Walks a JSON-LD object and returns the human-readable string values (with their field paths).
 * URLs, @-keys, dates, and id-like values are ignored.
 */
export function extractSchemaStrings(obj: unknown, path = ''): SchemaStringEntry[] {
  const out: SchemaStringEntry[] = [];
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => out.push(...extractSchemaStrings(item, `${path}[${i}]`)));
    return out;
  }
  if (!obj || typeof obj !== 'object') return out;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key.startsWith('@')) continue;
    const childPath = path ? `${path}.${key}` : key;
    if (typeof value === 'string') {
      if (TEXT_KEYS.has(key) && !looksLikeNonProse(value)) out.push({ field: childPath, value: value.trim() });
    } else if (value && typeof value === 'object') {
      out.push(...extractSchemaStrings(value, childPath));
    }
  }
  return out;
}

function buildAiAnswerNote(r: Readability, counts: Record<WritingIssueCategory, number>): string {
  const errors = counts.spelling + counts.grammar;
  if (r.longSentences > 0 && r.fleschReadingEase < 60) {
    return `AI assistants quote short, clear sentences. ${r.longSentences} sentence${r.longSentences === 1 ? '' : 's'} here run${r.longSentences === 1 ? 's' : ''} past ${LONG_SENTENCE_WORDS} words and the text reads as "${r.label.toLowerCase()}", so answers are more likely to paraphrase than quote you.`;
  }
  if (r.longSentences > 0) {
    return `AI assistants quote short, clear sentences. ${r.longSentences} sentence${r.longSentences === 1 ? '' : 's'} here run${r.longSentences === 1 ? 's' : ''} past ${LONG_SENTENCE_WORDS} words.`;
  }
  if (errors > 0) {
    return `Clear sentence length, but ${errors} spelling/grammar slip${errors === 1 ? '' : 's'} can make AI assistants treat the page as less trustworthy to quote.`;
  }
  return 'Clear, short sentences — easy for AI assistants to quote.';
}

function emptyCounts(): Record<WritingIssueCategory, number> {
  return { spelling: 0, grammar: 0, style: 0, clarity: 0, other: 0 };
}

function isJsonResponse(res: Response): boolean {
  const ct = (res.headers?.get?.('content-type') || '').toLowerCase();
  return ct.includes('application/json') || ct.includes('+json');
}

// ---- Service ---------------------------------------------------------------------------------

export class WritingQualityService {
  private static instance: WritingQualityService;

  public static getInstance(): WritingQualityService {
    if (!WritingQualityService.instance) WritingQualityService.instance = new WritingQualityService();
    return WritingQualityService.instance;
  }

  /** Runs the grammar service (best-effort) and local readability. Never throws. */
  async checkText(text: string, opts: CheckTextOptions = {}): Promise<WritingQualityReport> {
    const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const cleaned = (text || '').replace(/\r\n/g, '\n').trim().slice(0, maxChars);
    const readability = computeReadability(cleaned);

    let available = false;
    let language: string | undefined;
    let issues: WritingIssue[] = [];

    if (cleaned.length > 0) {
      try {
        const matches = await this.fetchMatches(cleaned, opts.language, timeoutMs);
        if (matches) {
          available = true;
          language = matches.language;
          issues = this.toIssues(matches.matches);
        }
      } catch (e) {
        console.warn('[WritingCheck] grammar service unavailable', e);
      }
    }

    return this.assemble(cleaned, readability, issues, available, language);
  }

  /** Checks only the human-readable strings inside a JSON-LD block and tags issues with their field path. */
  async checkSchemaText(schemaJsonLd: string): Promise<WritingQualityReport> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(schemaJsonLd);
    } catch {
      return this.assemble('', computeReadability(''), [], false);
    }
    const entries = extractSchemaStrings(parsed);
    if (!entries.length) return this.assemble('', computeReadability(''), [], false);

    // One value per line; remember where each field starts so issues can be attributed.
    const spans: Array<{ field: string; start: number; end: number }> = [];
    let text = '';
    entries.forEach((e, i) => {
      if (i > 0) text += '\n';
      const start = text.length;
      text += e.value;
      spans.push({ field: e.field, start, end: text.length });
    });

    const report = await this.checkText(text);
    report.issues = report.issues.map(issue => {
      const span = spans.find(s => issue.offset >= s.start && issue.offset < s.end);
      return span ? { ...issue, field: span.field } : issue;
    });
    // Rebuild the fixes so they carry the field prefix.
    report.topFixes = this.topFixes(report.issues, report.readability);
    return report;
  }

  /** Compact block for the audit prompt. */
  summaryForLlm(report: WritingQualityReport): string {
    const r = report.readability;
    const lines = ['[WRITING QUALITY (measured on the scraped page)]'];
    if (report.available) {
      lines.push(`Score: ${report.score}/100 (${report.grade}). Words: ${report.wordCount}, sentences: ${report.sentenceCount}.`);
    } else {
      lines.push(`Grammar service not measured; readability was. Readability-only score: ${report.score}/100 (${report.grade}). Words: ${report.wordCount}, sentences: ${report.sentenceCount}.`);
    }
    lines.push(`Readability: ${r.label} (Flesch ${r.fleschReadingEase}, grade level ${r.gradeLevel}, avg ${r.avgSentenceLength} words/sentence, ${r.longSentences} sentences over ${LONG_SENTENCE_WORDS} words).`);
    if (report.available) {
      lines.push(`Issues: ${report.counts.spelling} spelling, ${report.counts.grammar} grammar, ${report.counts.style} style, ${report.counts.clarity} clarity, ${report.counts.other} other.`);
    }
    if (report.topFixes.length) {
      lines.push('Top fixes:');
      report.topFixes.slice(0, 5).forEach(f => lines.push(`- ${f}`));
    }
    lines.push(report.aiAnswerNote);
    lines.push('--------------------------------------------------');
    return lines.join('\n');
  }

  // ---- internals ----

  private async fetchMatches(text: string, language: string | undefined, timeoutMs: number): Promise<{ matches: any[]; language?: string } | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = new URLSearchParams({
        text,
        language: language || 'auto',
        level: 'default',
        disabledRules: 'WHITESPACE_RULE',
      }).toString();
      const res = await sidecarFetch(
        'languagetool',
        '/v2/check',
        { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: controller.signal },
        { directBase: configService.getLanguageToolUrl() || undefined },
      );
      if (!res || !res.ok) return null;
      let data: any;
      if (isJsonResponse(res)) {
        data = await res.json();
      } else {
        // Vite dev may answer with index.html and HTTP 200 when the relay target is down.
        const raw = await res.text();
        try { data = JSON.parse(raw); } catch { return null; }
      }
      if (!data || typeof data !== 'object' || !Array.isArray(data.matches)) return null;
      const lang = data.language?.detectedLanguage?.code || data.language?.code;
      return { matches: data.matches, language: typeof lang === 'string' ? lang : undefined };
    } finally {
      clearTimeout(timer);
    }
  }

  private toIssues(matches: any[]): WritingIssue[] {
    const issues: WritingIssue[] = [];
    const seen: Array<{ message: string; offset: number }> = [];
    matches.forEach((m, i) => {
      const message = String(m?.shortMessage || m?.message || m?.rule?.description || 'Writing issue').trim();
      const offset = Number(m?.offset) || 0;
      const length = Number(m?.length) || 0;
      if (seen.some(s => s.message === message && Math.abs(s.offset - offset) <= 5)) return;
      seen.push({ message, offset });
      const ctx = m?.context;
      let snippet = '';
      if (ctx && typeof ctx.text === 'string') {
        const cs = Number(ctx.offset) || 0;
        const cl = Number(ctx.length) || length;
        snippet = ctx.text.slice(cs, cs + cl) || ctx.text;
      }
      const suggestion = Array.isArray(m?.replacements) && m.replacements.length ? String(m.replacements[0]?.value ?? '') : undefined;
      issues.push({
        id: `wq-${i}-${offset}`,
        category: mapCategory(m),
        message: String(m?.message || message),
        snippet: snippet.trim(),
        suggestion: suggestion || undefined,
        offset,
        length,
        ruleId: String(m?.rule?.id || 'UNKNOWN'),
      });
    });
    return issues;
  }

  private assemble(text: string, readabilityFull: ReturnType<typeof computeReadability>, issues: WritingIssue[], available: boolean, language?: string): WritingQualityReport {
    const { wordCount, sentenceCount, ...readability } = readabilityFull;
    const counts = emptyCounts();
    issues.forEach(i => { counts[i.category] += 1; });
    const { score, grade } = scoreReport(counts, wordCount, readability.fleschReadingEase);
    return {
      available,
      score,
      grade,
      wordCount,
      sentenceCount,
      readability,
      issues,
      counts,
      topFixes: this.topFixes(issues, readability),
      aiAnswerNote: buildAiAnswerNote(readability, counts),
      language,
      checkedChars: text.length,
      checkedAt: Date.now(),
    };
  }

  private topFixes(issues: WritingIssue[], r: Readability): string[] {
    const fixes: string[] = [];
    const seen = new Set<string>();
    const ordered = [...issues].sort((a, b) => CATEGORY_WEIGHT[b.category] - CATEGORY_WEIGHT[a.category]);
    for (const issue of ordered) {
      const key = issue.message.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      let line = issue.message;
      if (issue.snippet && issue.suggestion) line = `${issue.message} — change "${issue.snippet}" to "${issue.suggestion}"`;
      else if (issue.snippet) line = `${issue.message} — near "${issue.snippet}"`;
      if (issue.field) line = `${issue.field}: ${line}`;
      fixes.push(line);
      if (fixes.length >= 5) break;
    }
    if (fixes.length < 5 && r.longSentences > 0) {
      fixes.push(`Split the ${r.longSentences} sentence${r.longSentences === 1 ? '' : 's'} longer than ${LONG_SENTENCE_WORDS} words into two.`);
    }
    if (fixes.length < 5 && r.fleschReadingEase < 50 && r.fleschReadingEase > 0) {
      fixes.push('Swap long words for everyday ones so the page reads at a general-audience level.');
    }
    return fixes.slice(0, 5);
  }
}

export const writingQualityService = WritingQualityService.getInstance();
