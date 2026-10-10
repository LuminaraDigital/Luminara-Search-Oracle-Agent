/**
 * Event Ingestion Queue for Luminara Dreaming memory consolidation.
 */
import type { Env } from './env';
import type { DreamEvent, DreamEventType } from './dreamingTypes';
import { sha256Hex } from './workerUtils';

export interface EnqueueEventInput {
  accountId: string;
  projectId?: string | null;
  domain: string;
  eventType: DreamEventType;
  sourceId?: string | null;
  payload: Record<string, unknown>;
  signalWeight?: number;
}

const DEFAULT_SIGNAL_WEIGHTS: Record<DreamEventType, number> = {
  client_profile_changed: 2.5,
  recommendation_updated: 2.0,
  feedback_received: 1.5,
  audit_completed: 1.0,
};

export async function enqueueDreamEvent(
  env: Env,
  input: EnqueueEventInput,
): Promise<{ ok: true; event: DreamEvent; duplicate: boolean } | { ok: false; error: string }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable' };

  const cleanDomain = input.domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
  if (!cleanDomain) return { ok: false, error: 'Domain required' };

  const payloadStr = JSON.stringify(input.payload || {});
  const contentHash = await sha256Hex(`${cleanDomain}:${input.eventType}:${payloadStr}`);
  const now = Date.now();

  // Deduplication check: Discard identical payload queued within last 15 minutes
  const recentWindow = now - 15 * 60 * 1000;
  const existing = await env.DB.prepare(
    `SELECT id, created_at, dream_run_id FROM dream_events
     WHERE account_id = ? AND domain = ? AND content_hash = ? AND created_at > ?
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(input.accountId, cleanDomain, contentHash, recentWindow)
    .first<{ id: string; created_at: number; dream_run_id: string | null }>();

  if (existing) {
    return {
      ok: true,
      duplicate: true,
      event: {
        id: existing.id,
        accountId: input.accountId,
        projectId: input.projectId || null,
        domain: cleanDomain,
        eventType: input.eventType,
        sourceId: input.sourceId || null,
        payload: input.payload,
        contentHash,
        signalWeight: 0,
        dreamRunId: existing.dream_run_id,
        createdAt: existing.created_at,
      },
    };
  }

  const id = `devt_${crypto.randomUUID()}`;
  const weight = input.signalWeight ?? DEFAULT_SIGNAL_WEIGHTS[input.eventType] ?? 1.0;

  await env.DB.prepare(
    `INSERT INTO dream_events (
      id, account_id, project_id, domain, event_type, source_id,
      payload_json, content_hash, signal_weight, dream_run_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      id,
      input.accountId,
      input.projectId || null,
      cleanDomain,
      input.eventType,
      input.sourceId || null,
      payloadStr,
      contentHash,
      weight,
      now,
    )
    .run();

  const event: DreamEvent = {
    id,
    accountId: input.accountId,
    projectId: input.projectId || null,
    domain: cleanDomain,
    eventType: input.eventType,
    sourceId: input.sourceId || null,
    payload: input.payload,
    contentHash,
    signalWeight: weight,
    dreamRunId: null,
    createdAt: now,
  };

  return { ok: true, duplicate: false, event };
}

export async function getPendingDreamEvents(
  env: Env,
  accountId: string,
  domain: string,
  limit = 20,
): Promise<DreamEvent[]> {
  if (!env.DB) return [];
  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];

  const rows = await env.DB.prepare(
    `SELECT id, account_id, project_id, domain, event_type, source_id,
            payload_json, content_hash, signal_weight, dream_run_id, created_at
     FROM dream_events
     WHERE account_id = ? AND domain = ? AND dream_run_id IS NULL
     ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(accountId, cleanDomain, limit)
    .all<{
      id: string;
      account_id: string;
      project_id: string | null;
      domain: string;
      event_type: DreamEventType;
      source_id: string | null;
      payload_json: string;
      content_hash: string;
      signal_weight: number;
      dream_run_id: string | null;
      created_at: number;
    }>();

  return (rows.results || []).map((r) => {
    let parsedPayload: Record<string, unknown> = {};
    try {
      parsedPayload = JSON.parse(r.payload_json);
    } catch {
      /* fallback */
    }
    return {
      id: r.id,
      accountId: r.account_id,
      projectId: r.project_id,
      domain: r.domain,
      eventType: r.event_type,
      sourceId: r.source_id,
      payload: parsedPayload,
      contentHash: r.content_hash,
      signalWeight: r.signal_weight,
      dreamRunId: r.dream_run_id,
      createdAt: r.created_at,
    };
  });
}

export async function markEventsConsolidated(
  env: Env,
  eventIds: string[],
  dreamRunId: string,
): Promise<void> {
  if (!env.DB || eventIds.length === 0) return;
  const placeholders = eventIds.map(() => '?').join(',');
  await env.DB.prepare(
    `UPDATE dream_events SET dream_run_id = ? WHERE id IN (${placeholders})`,
  )
    .bind(dreamRunId, ...eventIds)
    .run();
}
