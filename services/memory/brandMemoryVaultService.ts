/**
 * Brand Memory Vault: auto-save audits, chat insights, and competitor mentions
 * into VFS + context graph (not a user-edited wiki).
 */

import type { BusinessDNA } from '../../types';
import { vfsMemoryService } from '../vfs/vfsMemoryService';
import { contextGraphService } from '../contextGraph/contextGraphService';
import { auditHistoryService, type AuditHistoryEntry } from '../audit/auditHistoryService';
import { injectCompetitorWikiLinks, extractWikiLinks } from '../audit/wikiLinkService';
import { noteWorkspaceDirty } from '../sync/workspaceSyncService';
import { getActiveClientId } from '../workspace/agencyWorkspaceService';

const EVENT_KEY = 'luminara_brand_memory_events_v1';
const MAX_EVENTS = 200;

export type BrandMemoryEventType =
  | 'audit'
  | 'chat_insight'
  | 'competitor_mention'
  | 'dna_sync'
  | 'watchlist_alert';

export interface BrandMemoryEvent {
  id: string;
  type: BrandMemoryEventType;
  title: string;
  summary: string;
  domain?: string;
  clientId?: string | null;
  auditId?: string;
  createdAt: number;
  tags: string[];
}

let eventMemory: BrandMemoryEvent[] = [];

function canLS(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem('__bm_probe__', '1');
    localStorage.removeItem('__bm_probe__');
    return true;
  } catch {
    return false;
  }
}

function loadEvents(): BrandMemoryEvent[] {
  if (!canLS()) return [...eventMemory];
  try {
    const raw = localStorage.getItem(EVENT_KEY);
    if (!raw) return [...eventMemory];
    const parsed = JSON.parse(raw) as BrandMemoryEvent[];
    return Array.isArray(parsed) ? parsed : [...eventMemory];
  } catch {
    return [...eventMemory];
  }
}

function saveEvents(events: BrandMemoryEvent[]): void {
  eventMemory = events.slice(-MAX_EVENTS);
  if (!canLS()) return;
  try {
    localStorage.setItem(EVENT_KEY, JSON.stringify(eventMemory));
  } catch {
    /* ignore */
  }
}

function pushEvent(partial: Omit<BrandMemoryEvent, 'id' | 'createdAt'>): BrandMemoryEvent {
  const ev: BrandMemoryEvent = {
    ...partial,
    id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  const all = loadEvents();
  all.push(ev);
  saveEvents(all);
  try {
    noteWorkspaceDirty();
  } catch {
    /* sync optional */
  }
  return ev;
}

export interface IngestAuditVaultInput {
  domain: string;
  focus: string;
  reportText: string;
  title?: string;
  citationRatePercent?: number | null;
  topCompetitor?: string | null;
  dna?: BusinessDNA | null;
  planId?: string | null;
}

export function ingestAudit(input: IngestAuditVaultInput): {
  entry: AuditHistoryEntry;
  event: BrandMemoryEvent;
  linkedReport: string;
} {
  const competitors = input.dna?.competitors || [];
  const linkedReport = injectCompetitorWikiLinks(input.reportText, competitors);
  const clientId = getActiveClientId();

  const entry = auditHistoryService.record({
    domain: input.domain,
    focus: input.focus,
    reportText: linkedReport,
    title: input.title,
    citationRatePercent: input.citationRatePercent,
    topCompetitor: input.topCompetitor,
    dnaCompetitors: competitors,
    clientId,
    planId: input.planId,
  });

  try {
    vfsMemoryService.ingestAuditAsResource(linkedReport, input.domain);
  } catch (e) {
    console.warn('[BrandMemory] VFS audit ingest failed', e);
  }

  try {
    const payload = {
      url: input.domain,
      focus: input.focus,
      text: linkedReport,
      dnaName: input.dna?.name,
    };
    contextGraphService.saveLastAudit(payload);
    contextGraphService.ingestAudit(payload);
  } catch (e) {
    console.warn('[BrandMemory] graph ingest failed', e);
  }

  for (const name of extractWikiLinks(linkedReport).slice(0, 10)) {
    try {
      vfsMemoryService.addMemoryItem(
        'entities',
        `Competitor: ${name}`,
        `Mentioned in ${input.focus} audit of ${entry.domain} on ${new Date(entry.measuredAt).toISOString()}.\n\n[[${name}]]`,
        ['competitor', 'wiki-link', entry.domain],
        'AEO'
      );
    } catch {
      /* optional */
    }
  }

  const event = pushEvent({
    type: 'audit',
    title: entry.title,
    summary: entry.summary,
    domain: entry.domain,
    clientId,
    auditId: entry.id,
    tags: entry.tags,
  });

  return { entry, event, linkedReport };
}

export function ingestChatInsight(opts: {
  question: string;
  answerExcerpt: string;
  domain?: string;
  dna?: BusinessDNA | null;
}): BrandMemoryEvent {
  const clientId = getActiveClientId();
  const title = `Insight: ${opts.question.slice(0, 80)}`;
  const content = `# Chat Insight\n\n**Q:** ${opts.question}\n\n**A:** ${opts.answerExcerpt.slice(0, 2000)}`;
  try {
    vfsMemoryService.addMemoryItem('events', title, content, ['chat', 'insight'], 'STRATEGY');
  } catch {
    /* optional */
  }
  return pushEvent({
    type: 'chat_insight',
    title,
    summary: opts.answerExcerpt.slice(0, 240),
    domain: opts.domain,
    clientId,
    tags: ['chat'],
  });
}

export function syncDna(dna: BusinessDNA): BrandMemoryEvent {
  try {
    vfsMemoryService.syncFromBusinessDNA(dna);
    contextGraphService.syncFromDna(dna);
  } catch (e) {
    console.warn('[BrandMemory] DNA sync failed', e);
  }
  return pushEvent({
    type: 'dna_sync',
    title: `DNA synced: ${dna.name}`,
    summary: dna.rawContext?.slice(0, 240) || dna.mission?.slice(0, 240) || dna.name,
    clientId: getActiveClientId(),
    tags: ['dna', ...(dna.competitors || []).slice(0, 5)],
  });
}

export function listEvents(limit = 50): BrandMemoryEvent[] {
  return loadEvents()
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export const brandMemoryVaultService = {
  ingestAudit,
  ingestChatInsight,
  syncDna,
  listEvents,
  EVENT_KEY,
};
