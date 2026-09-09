/**
 * Foam-inspired wiki links for generated AEO reports: [[Competitor Name]].
 * Inject into LLM prompts and render as navigable chips in the UI.
 */

export function injectCompetitorWikiLinks(reportText: string, competitors: string[]): string {
  if (!reportText || !competitors?.length) return reportText;
  let out = reportText;
  const sorted = [...competitors].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Skip if already wrapped as [[Name]]
    const already = new RegExp(`\\[\\[${escaped}\\]\\]`, 'i');
    if (already.test(out)) continue;
    // Avoid wrapping names already inside [[...]]
    const re = new RegExp(`\\b(${escaped})\\b`, 'gi');
    out = out.replace(re, (match, _g1, offset: number, full: string) => {
      const before = full.slice(Math.max(0, offset - 2), offset);
      const after = full.slice(offset + match.length, offset + match.length + 2);
      if (before === '[[' || after === ']]') return match;
      return `[[${match}]]`;
    });
  }
  return out;
}

export function extractWikiLinks(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const name = m[1].trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    found.push(name);
  }
  return found;
}

/** Split markdown segment into text / wiki-link parts for React rendering. */
export function splitWikiParts(text: string): Array<{ type: 'text' | 'wiki'; value: string }> {
  const parts: Array<{ type: 'text' | 'wiki'; value: string }> = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    parts.push({ type: 'wiki', value: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  if (!parts.length) parts.push({ type: 'text', value: text });
  return parts;
}

export const WIKI_LINK_PROMPT_HINT = `
When mentioning a competitor from the Business DNA list, wrap the exact competitor name in double brackets, e.g. [[Acme Corp]]. Do this on first mention in each section. Do not invent wiki links for brands not in the competitor list.
`.trim();

export const wikiLinkService = {
  inject: injectCompetitorWikiLinks,
  extract: extractWikiLinks,
  split: splitWikiParts,
  promptHint: WIKI_LINK_PROMPT_HINT,
};
