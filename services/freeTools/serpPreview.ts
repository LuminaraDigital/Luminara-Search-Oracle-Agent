/**
 * Free SERP preview: estimated pixel widths and truncation for a Google result.
 * Google sets titles in Arial 20px and snippets in Arial 14px. Widths use Arial's advance
 * widths (units per 1000 em) so the result is the same in the browser and in tests.
 * Google can rewrite or cut any snippet, so every figure here is an estimate.
 */
import { escapeHtml } from '../../utils/html';
import { toHttpUrl } from './httpUrl';

/** Arial advance widths for printable ASCII, from space (32) to tilde (126). */
const ARIAL_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
] as const;

/** Anything outside printable ASCII is counted as a digit-width character. */
const DEFAULT_ADVANCE = 556;

export const TITLE_FONT_PX = 20;
export const DESCRIPTION_FONT_PX = 14;
/** Desktop title width before Google adds an ellipsis. */
export const TITLE_MAX_PX = 600;
/** Two snippet lines on desktop and on mobile. */
export const DESCRIPTION_MAX_PX = { desktop: 920, mobile: 680 } as const;
/** Below these lengths a field is flagged short. */
const TITLE_MIN_CHARS = 30;
const DESCRIPTION_MIN_CHARS = 70;

export type SerpDevice = keyof typeof DESCRIPTION_MAX_PX;
export type LengthVerdict = 'empty' | 'short' | 'good' | 'truncated';

export function textWidthPx(text: string, fontPx: number): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    units += code >= 32 && code <= 126 ? ARIAL_ASCII[code - 32] : DEFAULT_ADVANCE;
  }
  return Math.round((units * fontPx) / 1000);
}

/** Cut `text` so it plus an ellipsis fits in `maxPx`. Returns the text unchanged when it fits. */
export function truncateToPx(text: string, fontPx: number, maxPx: number): { text: string; truncated: boolean } {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (textWidthPx(clean, fontPx) <= maxPx) return { text: clean, truncated: false };
  const room = maxPx - textWidthPx('...', fontPx);
  let cut = '';
  for (const ch of clean) {
    if (textWidthPx(cut + ch, fontPx) > room) break;
    cut += ch;
  }
  // Google cuts at a word boundary when one is close.
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > cut.length * 0.7) cut = cut.slice(0, lastSpace);
  return { text: `${cut.trimEnd()}...`, truncated: true };
}

export interface SerpFieldCheck {
  chars: number;
  px: number;
  maxPx: number;
  verdict: LengthVerdict;
  shown: string;
}

function verdictFor(chars: number, truncated: boolean, minChars: number): LengthVerdict {
  if (chars === 0) return 'empty';
  if (truncated) return 'truncated';
  return chars < minChars ? 'short' : 'good';
}

/** Desktop title cut. Mobile wraps titles over two lines, so the desktop width is the stricter limit. */
export function checkTitle(title: string): SerpFieldCheck {
  const clean = title.replace(/\s+/g, ' ').trim();
  const cut = truncateToPx(clean, TITLE_FONT_PX, TITLE_MAX_PX);
  return {
    chars: clean.length,
    px: textWidthPx(clean, TITLE_FONT_PX),
    maxPx: TITLE_MAX_PX,
    verdict: verdictFor(clean.length, cut.truncated, TITLE_MIN_CHARS),
    shown: cut.text,
  };
}

export function checkDescription(description: string, device: SerpDevice): SerpFieldCheck {
  const clean = description.replace(/\s+/g, ' ').trim();
  const maxPx = DESCRIPTION_MAX_PX[device];
  const cut = truncateToPx(clean, DESCRIPTION_FONT_PX, maxPx);
  return {
    chars: clean.length,
    px: textWidthPx(clean, DESCRIPTION_FONT_PX),
    maxPx,
    verdict: verdictFor(clean.length, cut.truncated, DESCRIPTION_MIN_CHARS),
    shown: cut.text,
  };
}

function decodeSegment(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** Google's breadcrumb line: the full host, then path segments. Falls back to example.com for a non-web address. */
export function serpBreadcrumb(rawUrl: string): { site: string; crumbs: string[] } {
  const href = toHttpUrl(rawUrl);
  if (!href) return { site: 'example.com', crumbs: [] };
  const url = new URL(href);
  return { site: url.hostname, crumbs: url.pathname.split('/').filter(Boolean).map(decodeSegment) };
}

/** The two head tags, ready to paste. */
export function serpHeadHtml(title: string, description: string): string {
  const lines = [`<title>${escapeHtml(title.trim())}</title>`];
  if (description.trim()) lines.push(`<meta name="description" content="${escapeHtml(description.trim())}">`);
  return lines.join('\n');
}
