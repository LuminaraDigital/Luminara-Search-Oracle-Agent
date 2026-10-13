/**
 * Account-scoped search over indexed audits and chats, plus a nudge to save
 * a brand fact. The vault write stays on the client. Search does not save it.
 */

export type MemoryDocKind = 'audit' | 'chat';

export interface MemoryDocument {
  id: string;
  kind: MemoryDocKind;
  domain: string | null;
  title: string;
  body: string;
  sourceId: string | null;
  createdAt: number;
}

export interface MemorySearchHit extends MemoryDocument {
  score: number;
}

export interface BrandFactNudge {
  shouldSave: boolean;
  title?: string;
  summary?: string;
  domain?: string | null;
}

const FACT_PATTERNS: Array<{ re: RegExp; title: string }> = [
  { re: /our usp is ([^.]+)/i, title: 'USP' },
  { re: /we sell ([^.]+)/i, title: 'Offer' },
  { re: /competitors include ([^.]+)/i, title: 'Competitors' },
  { re: /our audience is ([^.]+)/i, title: 'Audience' },
];

function tokens(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2))].slice(0, 12);
}

export function searchMemoryDocuments(docs: readonly MemoryDocument[], query: string, limit = 20): MemorySearchHit[] {
  const words = tokens(query);
  if (words.length === 0) return [];
  const hits: MemorySearchHit[] = [];
  for (const doc of docs) {
    const title = doc.title.toLowerCase();
    const body = doc.body.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (title.includes(word)) score += 2;
      if (body.includes(word)) score += 1;
    }
    if (score > 0) hits.push({ ...doc, score });
  }
  hits.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  return hits.slice(0, limit);
}

export function brandFactNudge(hits: readonly MemorySearchHit[]): BrandFactNudge {
  const chat = hits.find((hit) => hit.kind === 'chat');
  if (!chat) return { shouldSave: false };
  for (const pattern of FACT_PATTERNS) {
    const match = chat.body.match(pattern.re);
    const summary = match?.[1]?.trim().slice(0, 240);
    if (summary && summary.length >= 3) {
      return { shouldSave: true, title: pattern.title, summary, domain: chat.domain };
    }
  }
  return { shouldSave: false };
}
