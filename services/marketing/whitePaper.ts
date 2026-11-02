/**
 * White paper copy. Numeric claims live inside a cited span so the page can
 * show Fact, Estimate, or Speculation plus a source link.
 */
import { PLAY_STORE_URL, TELEGRAM_BOT_URL, TELEGRAM_MINI_APP_PUBLIC_URL } from './platformSurfaces';
import { compareSourceIds, type SourceId } from './whitePaperSources';

export const WHITE_PAPER_PATH = '/white-paper';

export const WHITE_PAPER_SECTION_IDS = [
  'executive-summary',
  'problem',
  'market-category',
  'how-measurement-works',
  'competitive-map',
  'product-surfaces-gtm',
  'monetization',
  'onchain-telegram-adjacency',
  'architecture',
  'risks-open-questions',
  'glossary',
  'sources',
] as const;

export type ClaimLabel = 'Fact' | 'Estimate' | 'Speculation';

export interface Cited {
  text: string;
  label: ClaimLabel;
  sources: readonly [SourceId, ...SourceId[]];
  note?: string;
}

export type Rich = string | Cited;

export const WHITE_PAPER_SHOTS = {
  'web-landing.png': {
    alt: 'Luminara Suite home page with the headline Be the answer AI gives and a domain field.',
    caption: 'Web Suite at luminarasuite.com. The free check reads a homepage, robots.txt, and llms.txt. Card passes are bought here.',
    illustrative: false,
  },
  'web-product.png': {
    alt: 'Illustrative sample report for an example agency. Not a measurement.',
    caption: 'Illustrative example, not a measurement. The rows show the report shape on the sample report page.',
    illustrative: true,
  },
  'play-listing.png': {
    alt: 'Google Play listing page for the Luminara Suite companion app.',
    caption: 'Google Play listing for the free companion. The app does not sell passes. Traction: Unknown.',
    illustrative: false,
  },
  'play-listing-screenshots.png': {
    alt: 'Google Play listing screenshots of the Luminara Suite companion.',
    caption: 'Store screenshots of the Play companion. These frames are the listing, not a client measurement.',
    illustrative: false,
  },
  'telegram-bot.png': {
    alt: 'Telegram bot page for @LuminaraSuiteBot with buttons to open the Mini App.',
    caption: 'Telegram bot @LuminaraSuiteBot. It opens the Mini App. Paid passes in Telegram use Stars.',
    illustrative: false,
  },
  'telegram-miniapp.png': {
    alt: 'Telegram Mini App Instant Audit screen with a Not measured checklist.',
    caption: 'Telegram Mini App, Instant Audit. Checklist rows stay Not measured until a live check records them.',
    illustrative: false,
  },
  'telegram-miniapp-2.png': {
    alt: 'Telegram Mini App Ask screen.',
    caption: 'Telegram Mini App, Ask. Live answers from specific AI products stay Not measured unless the plan or a connected search login allows them.',
    illustrative: false,
  },
} as const;

export type ShotFile = keyof typeof WHITE_PAPER_SHOTS;

export const WHITE_PAPER_PRODUCT_LINKS = [
  { label: 'Web Suite', href: 'https://luminarasuite.com' },
  { label: 'Telegram Mini App', href: TELEGRAM_MINI_APP_PUBLIC_URL },
  { label: 'Telegram bot', href: TELEGRAM_BOT_URL },
  { label: 'Google Play', href: PLAY_STORE_URL },
  { label: 'Windows', href: '/desktop' },
] as const;

export type WhitePaperBlock =
  | { kind: 'p'; parts: readonly Rich[] }
  | { kind: 'ul'; items: readonly (readonly Rich[])[] }
  | { kind: 'table'; caption: string; columns: readonly string[]; rows: readonly (readonly Rich[])[] }
  | { kind: 'shots'; files: readonly ShotFile[] }
  | { kind: 'links' };

export interface WhitePaperSection {
  id: (typeof WHITE_PAPER_SECTION_IDS)[number];
  nav: string;
  title: string;
  blocks: readonly WhitePaperBlock[];
}

export function fact(text: string, sources: readonly [SourceId, ...SourceId[]], note?: string): Cited {
  return { text, label: 'Fact', sources, note };
}

export function estimate(text: string, sources: readonly [SourceId, ...SourceId[]], note?: string): Cited {
  return { text, label: 'Estimate', sources, note };
}

export function speculation(text: string, sources: readonly [SourceId, ...SourceId[]], note?: string): Cited {
  return { text, label: 'Speculation', sources, note };
}


export function isCited(part: Rich): part is Cited {
  return typeof part !== 'string';
}

export function collectSourceIds(section: WhitePaperSection): SourceId[] {
  const seen = new Set<SourceId>();
  const ids: SourceId[] = [];
  const add = (part: Rich) => {
    if (!isCited(part)) return;
    for (const id of part.sources) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  };
  for (const block of section.blocks) {
    if (block.kind === 'p') block.parts.forEach(add);
    if (block.kind === 'ul') block.items.forEach((item) => item.forEach(add));
    if (block.kind === 'table') block.rows.forEach((row) => row.forEach(add));
  }
  return ids.sort(compareSourceIds);
}
