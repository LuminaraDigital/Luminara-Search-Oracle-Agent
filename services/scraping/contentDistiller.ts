/**
 * AI/ML Content Distillation & Token Budgeting Engine
 * 
 * Preprocesses raw web scrape data (HTML / Markdown) before injecting into LLM context:
 * 1. Strips boilerplate (navbars, cookie notices, footers, tracking scripts, SVGs).
 * 2. Extracts structured semantic signals (JSON-LD schemas, OpenGraph, Canonical).
 * 3. Builds a structural heading outline (H1-H3) for architectural analysis.
 * 4. Packs distilled content within a strict token/character budget to prevent
 *    "lost-in-the-middle" LLM attention degradation.
 */

import { sanitizePii } from '../trust/piiSanitizer';
import { compressToolResult } from '../compression/toolResultCompressor';
import { stripTags } from '../../utils/html';

export interface StructuredSchema {
  type: string;
  raw: Record<string, any>;
}

export interface DistilledContentResult {
  title: string;
  description: string;
  canonicalUrl?: string;
  openGraph: Record<string, string>;
  schemas: StructuredSchema[];
  schemaTypes: string[];
  headings: { level: number; text: string }[];
  distilledText: string;
  formattedEvidence: string;
  stats: {
    rawChars: number;
    distilledChars: number;
    compressionRatio: number;
  };
}

export interface DistillationOptions {
  maxChars?: number;
  includeHeadingsOutline?: boolean;
  includeSchemaSummary?: boolean;
  /**
   * Full document HTML when `rawHtml` is only the main content.
   * Firecrawl `onlyMainContent` drops `<head>`, which is where JSON-LD lives.
   */
  schemaHtml?: string;
}

function isPlainRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function scriptMime(attrs: string): string {
  const match = attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
  return raw.split(';')[0].trim().toLowerCase();
}

function typeNames(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function rememberNode(node: unknown, out: StructuredSchema[]): void {
  if (Array.isArray(node)) {
    for (const item of node) rememberNode(item, out);
    return;
  }
  if (!isPlainRecord(node)) return;
  for (const type of typeNames(node['@type'])) out.push({ type, raw: node });
  if (node['@graph'] !== undefined) rememberNode(node['@graph'], out);
}

/**
 * JSON-LD script bodies. Attribute order does not matter. A type parameter such as
 * charset is ignored.
 * shortcut: a ">" inside an attribute value ends the tag early. Use the deploy read-back scanner if a page does that.
 */
function collectJsonLd(html: string, out: StructuredSchema[]): void {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (scriptMime(match[1] || '') !== 'application/ld+json') continue;
    try {
      const parsed: unknown = JSON.parse((match[2] || '').trim());
      rememberNode(parsed, out);
    } catch {
      // Malformed JSON-LD is not a schema.
    }
  }
}

function dedupeSchemas(schemas: StructuredSchema[]): StructuredSchema[] {
  const seen = new Set<string>();
  const out: StructuredSchema[] = [];
  for (const schema of schemas) {
    const key = `${schema.type}\n${JSON.stringify(schema.raw)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(schema);
  }
  return out;
}

export class ContentDistiller {
  private static instance: ContentDistiller;

  private constructor() {}

  public static getInstance(): ContentDistiller {
    if (!ContentDistiller.instance) {
      ContentDistiller.instance = new ContentDistiller();
    }
    return ContentDistiller.instance;
  }

  /**
   * Distills raw HTML or Markdown into structured, high-signal evidence for LLM prompts.
   */
  public distill(rawHtml: string, rawMarkdown = '', options: DistillationOptions = {}): DistilledContentResult {
    const maxChars = options.maxChars ?? 8000;
    const includeHeadings = options.includeHeadingsOutline ?? true;
    const includeSchema = options.includeSchemaSummary ?? true;

    const rawInput = rawHtml || rawMarkdown;
    const isHtml = Boolean(rawHtml && /<[a-z][\s\S]*>/i.test(rawHtml));

    let title = '';
    let description = '';
    let canonicalUrl = '';
    const openGraph: Record<string, string> = {};
    const schemas: StructuredSchema[] = [];
    const headings: { level: number; text: string }[] = [];
    let cleanedBody = '';

    if (isHtml) {
      // 1. Extract Meta & Head Information
      title = this.extractRegex(rawHtml, /<title[^>]*>([^<]+)<\/title>/i);
      description = this.extractRegex(rawHtml, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                    this.extractRegex(rawHtml, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
      canonicalUrl = this.extractRegex(rawHtml, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);

      // OpenGraph tags
      const ogRegex = /<meta[^>]+property=["']og:([a-zA-Z0-9_:]+)["'][^>]+content=["']([^"']+)["']/gi;
      let ogMatch;
      while ((ogMatch = ogRegex.exec(rawHtml)) !== null) {
        if (ogMatch[1] && ogMatch[2]) {
          openGraph[ogMatch[1].toLowerCase()] = ogMatch[2].trim();
        }
      }
      if (!openGraph.site_name) {
        const flipped = rawHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
        if (flipped?.[1]) openGraph.site_name = flipped[1].trim();
      }

      collectJsonLd(rawHtml, schemas);

      // 3. Extract Headings Hierarchy
      const headingRegex = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi;
      let hMatch;
      while ((hMatch = headingRegex.exec(rawHtml)) !== null) {
        const level = parseInt(hMatch[1].charAt(1), 10);
        const text = this.stripHtmlTags(hMatch[2]).trim();
        if (text) {
          headings.push({ level, text });
        }
      }

      // 4. Boilerplate Stripping
      cleanedBody = this.cleanHtmlBody(rawHtml);
    } else {
      // Fallback for markdown-only inputs
      cleanedBody = this.cleanMarkdownBody(rawMarkdown);
      
      // Extract headings from markdown (#, ##, ###)
      const mdHeadingRegex = /^[ \t]*(#{1,3})\s+(.+)$/gm;
      let mdHMatch;
      while ((mdHMatch = mdHeadingRegex.exec(rawMarkdown)) !== null) {
        headings.push({
          level: mdHMatch[1].length,
          text: mdHMatch[2].trim(),
        });
      }
    }

    // 5. PII Redaction Gate
    cleanedBody = sanitizePii(cleanedBody).sanitized;

    if (options.schemaHtml) collectJsonLd(options.schemaHtml, schemas);
    const foundSchemas = dedupeSchemas(schemas);

    // Deduplicate and summarize schema types
    const schemaTypes = Array.from(new Set(foundSchemas.map(s => s.type)));

    // 6. Budget allocation with RTK compression
    const compressed = compressToolResult(cleanedBody, { maxChars }).compressed;
    const truncatedBody = compressed.slice(0, maxChars);

    // Format LLM-ready structured evidence block
    let formattedEvidence = '';
    formattedEvidence += `[PAGE TITLE]: ${title || openGraph['title'] || 'N/A'}\n`;
    if (description || openGraph['description']) {
      formattedEvidence += `[META DESCRIPTION]: ${description || openGraph['description']}\n`;
    }
    if (canonicalUrl) {
      formattedEvidence += `[CANONICAL URL]: ${canonicalUrl}\n`;
    }

    if (includeSchema && schemaTypes.length > 0) {
      formattedEvidence += `[STRUCTURED DATA / JSON-LD]: Detected schemas: ${schemaTypes.join(', ')}\n`;
    } else if (includeSchema) {
      formattedEvidence += `[STRUCTURED DATA / JSON-LD]: None detected\n`;
    }

    if (includeHeadings && headings.length > 0) {
      formattedEvidence += `[HEADING OUTLINE]:\n`;
      headings.slice(0, 15).forEach(h => {
        formattedEvidence += `  ${'#'.repeat(h.level)} ${h.text}\n`;
      });
    }

    formattedEvidence += `\n[DISTILLED CONTENT CORE]:\n${truncatedBody}\n`;

    const rawChars = rawInput.length;
    const distilledChars = formattedEvidence.length;
    const compressionRatio = rawChars > 0 ? Number((distilledChars / rawChars).toFixed(2)) : 1;

    return {
      title: title || openGraph['title'] || '',
      description: description || openGraph['description'] || '',
      canonicalUrl,
      openGraph,
      schemas: foundSchemas,
      schemaTypes,
      headings,
      distilledText: truncatedBody,
      formattedEvidence,
      stats: {
        rawChars,
        distilledChars,
        compressionRatio,
      },
    };
  }

  private cleanHtmlBody(html: string): string {
    let text = html;

    // 1. Remove dangerous or non-content tags
    text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
    text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');
    text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');
    text = text.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ');

    // 2. Remove common boilerplate containers (nav, footer, cookie consent, dialogs)
    text = text.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ');
    text = text.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ');
    text = text.replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ');
    text = text.replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ');

    // Remove elements with boilerplate classes or IDs
    text = text.replace(/<div[^>]*(?:class|id)=["'][^"']*(?:cookie|consent|banner|newsletter|popup|modal|ad-|advertisement|share-buttons)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');

    // 3. Convert paragraphs, line breaks and headings to newlines
    text = text.replace(/<(?:p|br|hr|h[1-6]|li|tr)[^>]*>/gi, '\n');

    // 4. Strip all remaining HTML tags
    text = this.stripHtmlTags(text);

    // 5. Normalize whitespace and empty lines
    return this.normalizeWhitespace(text);
  }

  private cleanMarkdownBody(md: string): string {
    let text = md;
    // Strip repetitive markdown links [text](url) -> text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Strip image tags ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
    // Strip HTML tags in markdown
    text = this.stripHtmlTags(text);
    return this.normalizeWhitespace(text);
  }

  private stripHtmlTags(str: string): string {
    return stripTags(str);
  }

  private normalizeWhitespace(str: string): string {
    return str
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  private extractRegex(str: string, regex: RegExp): string {
    const match = regex.exec(str);
    return match && match[1] ? this.stripHtmlTags(match[1]).trim() : '';
  }
}

/** Keep JSON-LD found on the full document when a later distill only saw main content. */
export function keepDiscoveredSchemas(
  fresh: DistilledContentResult,
  prior: DistilledContentResult | undefined,
): DistilledContentResult {
  if (!prior || prior.schemas.length === 0) return fresh;
  const schemas = dedupeSchemas([...fresh.schemas, ...prior.schemas]);
  if (schemas.length === fresh.schemas.length) return fresh;
  const schemaTypes = Array.from(new Set(schemas.map((schema) => schema.type)));
  const line = `[STRUCTURED DATA / JSON-LD]: Detected schemas: ${schemaTypes.join(', ')}`;
  const formattedEvidence = fresh.formattedEvidence.includes('[STRUCTURED DATA / JSON-LD]:')
    ? fresh.formattedEvidence.replace(/\[STRUCTURED DATA \/ JSON-LD\]:[^\n]*/, line)
    : `${line}\n${fresh.formattedEvidence}`;
  return { ...fresh, schemas, schemaTypes, formattedEvidence };
}

export const contentDistiller = ContentDistiller.getInstance();
