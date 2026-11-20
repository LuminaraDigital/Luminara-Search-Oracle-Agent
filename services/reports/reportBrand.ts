/**
 * Workspace brand for PDF, print, and shared reports.
 * A project with no workspace stays on the Luminara Suite brand.
 * The powered-by line stays unless the plan flag says it can come off.
 */
import { escapeHtml } from '../../utils/html';
import { safePublicHostname } from '../security/publicHostname';

export const LUMINARA_DISPLAY_NAME = 'Luminara Suite';
export const LUMINARA_PRIMARY_COLOUR = '#BF953F';
/** Sample a workspace can save. The settings form uses it as the empty-picker fallback. */
export const BRAND_COLOUR_EXAMPLE = '#1b4d3e';
export const POWERED_BY_LINE = 'Powered by Luminara Suite';
export const LOGO_MAX_BYTES = 512 * 1024;

export interface ReportBrand {
  kind: 'workspace' | 'luminara';
  displayName: string;
  logoUrl: string | null;
  primaryColour: string;
  showPoweredBy: boolean;
}

export function luminaraReportBrand(showPoweredBy: boolean): ReportBrand {
  return {
    kind: 'luminara',
    displayName: LUMINARA_DISPLAY_NAME,
    logoUrl: null,
    primaryColour: LUMINARA_PRIMARY_COLOUR,
    showPoweredBy,
  };
}

export function reportBrandFromWorkspace(
  workspace: { name: string; displayName: string | null; logoUrl: string | null; primaryColour: string | null },
  showPoweredBy: boolean,
): ReportBrand {
  const displayName = (workspace.displayName || workspace.name || LUMINARA_DISPLAY_NAME).trim().slice(0, 120)
    || LUMINARA_DISPLAY_NAME;
  return {
    kind: 'workspace',
    displayName,
    logoUrl: safeLogoSrc(workspace.logoUrl),
    primaryColour: safePrimaryColour(workspace.primaryColour),
    showPoweredBy,
  };
}

export function safePrimaryColour(raw: string | null | undefined): string {
  return raw && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : LUMINARA_PRIMARY_COLOUR;
}

/** https image URL safe to put in an img src. SVG is refused so a logo cannot carry a script. */
export function safeLogoSrc(raw: string | null | undefined): string | null {
  const parsed = parseLogoUrl(typeof raw === 'string' ? raw : '');
  return parsed.ok ? parsed.url : null;
}

export function parseLogoUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'logoUrl must be an https URL or null.' };
  if (trimmed.length > 500) return { ok: false, error: 'logoUrl must be an https URL or null.' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'logoUrl must be an https URL or null.' };
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    return { ok: false, error: 'logoUrl must be an https URL or null.' };
  }
  if (url.pathname.toLowerCase().endsWith('.svg')) {
    return { ok: false, error: 'SVG logos are not allowed.' };
  }
  if (!safePublicHostname(url.hostname)) {
    return { ok: false, error: 'logoUrl must be a public https URL.' };
  }
  return { ok: true, url: url.toString() };
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((byte, index) => bytes[index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

export type LogoKind = 'png' | 'jpeg' | 'gif' | 'webp';

export function sniffLogo(bytes: Uint8Array): LogoKind | null {
  if (startsWith(bytes, PNG)) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return 'gif';
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return 'webp';
  return null;
}

const LOGO_TYPE: Record<LogoKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** Raster logos only. The type has to match the file bytes, and SVG or markup is refused. */
export function logoPayloadOk(bytes: Uint8Array, contentType: string): { ok: true } | { ok: false; error: string } {
  if (bytes.length === 0 || bytes.length > LOGO_MAX_BYTES) {
    return { ok: false, error: 'The logo must be a PNG, JPEG, WEBP, or GIF under 512 KB.' };
  }
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type.includes('svg') || type === 'text/html' || type === 'text/xml' || type === 'application/xml') {
    return { ok: false, error: 'SVG logos are not allowed.' };
  }
  const kind = sniffLogo(bytes);
  if (!kind) return { ok: false, error: 'The logo must be a PNG, JPEG, WEBP, or GIF under 512 KB.' };
  const expected = LOGO_TYPE[kind];
  const jpegAlias = kind === 'jpeg' && type === 'image/jpg';
  if (type !== expected && !jpegAlias) {
    return { ok: false, error: 'The logo type does not match the file.' };
  }
  return { ok: true };
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio. 1 is the same colour. Black on white is 21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(safePrimaryColour(foreground));
  const b = luminance(safePrimaryColour(background));
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export function textOnColour(background: string): { text: '#111111' | '#ffffff'; ratio: number } {
  const colour = safePrimaryColour(background);
  const black = contrastRatio('#111111', colour);
  const white = contrastRatio('#ffffff', colour);
  return white >= black ? { text: '#ffffff', ratio: white } : { text: '#111111', ratio: black };
}

export function contrastLabel(hex: string): { ok: boolean; text: string } {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return { ok: false, text: 'Use a colour like #1B4D3E.' };
  const ink = textOnColour(hex);
  const rounded = Math.round(ink.ratio * 10) / 10;
  const shown = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  const name = ink.text === '#ffffff' ? 'White' : 'Black';
  if (ink.ratio < 4.5) return { ok: false, text: `${name} text, ${shown}:1. Does not pass WCAG AA.` };
  return { ok: true, text: `${name} text, ${shown}:1. Passes WCAG AA.` };
}

function logoImg(brand: ReportBrand): string {
  const src = safeLogoSrc(brand.logoUrl);
  if (!src) return '';
  return `<img src="${escapeHtml(src)}" alt="" style="display:block;max-height:48px;width:auto;margin-bottom:8px" referrerpolicy="no-referrer" />`;
}

/** Header and footer inserted into a full HTML report. Markup only, no script. */
export function applyReportBrandHtml(html: string, brand: ReportBrand): string {
  if (html.includes('data-luminara-brand="1"')) return html;
  const colour = safePrimaryColour(brand.primaryColour);
  const ink = textOnColour(colour);
  const header = `<header data-luminara-brand="1" style="background:${colour};color:${ink.text};padding:16px 20px;font-family:Georgia,serif">`
    + `<meta name="luminara-report-brand" content="${escapeHtml(brand.displayName)}" />`
    + logoImg(brand)
    + `<div style="font-size:20px;font-weight:700">${escapeHtml(brand.displayName)}</div>`
    + `</header>`;
  const footer = brand.showPoweredBy
    ? `<footer data-luminara-brand="1" style="margin-top:32px;padding-top:12px;border-top:1px solid #e2e8f0;font:12px/1.4 Georgia,serif;color:#64748b">${POWERED_BY_LINE}</footer>`
    : '';
  const withHeader = /<body[^>]*>/i.test(html)
    ? html.replace(/<body[^>]*>/i, (open) => `${open}${header}`)
    : html.replace(/<html[^>]*>/i, (open) => `${open}${header}`);
  if (/<\/body>/i.test(withHeader)) return withHeader.replace(/<\/body>/i, `${footer}</body>`);
  return withHeader.replace(/<\/html>/i, `${footer}</html>`);
}

export function readReportBrandName(html: string): string | null {
  const match = html.match(/<meta name="luminara-report-brand" content="([^"]*)"/);
  if (!match) return null;
  return match[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
