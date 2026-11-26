/**
 * Rakazo-Style Deterministic External Effects Ledger Service
 *
 * Ensures retried webhooks, outbound recovery steps, CRM sync calls, and CMS MCP mutations
 * never double-execute across the Worker.
 */

import type { Env } from './env';
import { computeExternalEffectKey } from '../services/enquiries/playbookQualificationService';
import { safeJsonParse } from '../services/llm/safeJsonParse';

export const DEFAULT_EXTERNAL_EFFECT_LEASE_MS = 5 * 60 * 1000;

export async function checkOrRecordExternalEffect<T>(
  env: Env,
  args: {
    accountId: string;
    projectId: string;
    targetSystem: string;
    actionKind: string;
    payload: unknown;
    now?: number;
    staleLeaseMs?: number;
  },
): Promise<
  | { duplicate: true; effectKey: string; cachedResult: T | null; inProgress?: boolean }
  | { duplicate: false; effectKey: string; payloadHash: string }
> {
  const { effectKey, payloadHash } = await computeExternalEffectKey(args);
  if (!env.DB) {
    return { duplicate: false, effectKey, payloadHash };
  }

  const now = args.now ?? Date.now();
  const staleLeaseMs = args.staleLeaseMs ?? DEFAULT_EXTERNAL_EFFECT_LEASE_MS;

  const inserted = await env.DB.prepare(
    `INSERT INTO external_effects (
      effect_key, account_id, project_id, target_system, action_kind, payload_hash, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(effect_key) DO NOTHING`,
  )
    .bind(
      effectKey,
      args.accountId,
      args.projectId,
      args.targetSystem,
      args.actionKind,
      payloadHash,
      now,
      now,
    )
    .run();

  if (Number(inserted.meta?.changes ?? 0) === 1) {
    return { duplicate: false, effectKey, payloadHash };
  }

  const existing = await env.DB.prepare(
    `SELECT status, result_json, updated_at FROM external_effects WHERE effect_key = ? AND account_id = ?`,
  )
    .bind(effectKey, args.accountId)
    .first<{ status: string; result_json: string | null; updated_at: number }>();

  if (!existing) {
    return { duplicate: true, effectKey, cachedResult: null, inProgress: true };
  }

  if (existing.status === 'completed' || existing.status === 'succeeded') {
    const cachedResult = existing.result_json
      ? safeJsonParse<T | null>(existing.result_json, null)
      : null;
    return { duplicate: true, effectKey, cachedResult };
  }

  if (existing.status === 'pending' && Number(existing.updated_at) < now - staleLeaseMs) {
    const takeover = await env.DB.prepare(
      `UPDATE external_effects
       SET updated_at = ?, payload_hash = ?
       WHERE effect_key = ? AND account_id = ? AND status = 'pending' AND updated_at = ?`,
    )
      .bind(now, payloadHash, effectKey, args.accountId, existing.updated_at)
      .run();
    if (Number(takeover.meta?.changes ?? 0) === 1) {
      return { duplicate: false, effectKey, payloadHash };
    }
  }

  return { duplicate: true, effectKey, cachedResult: null, inProgress: true };
}

export async function finalizeExternalEffect(
  env: Env,
  effectKey: string,
  accountId: string,
  result: unknown,
  now = Date.now(),
): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(
    `UPDATE external_effects SET status = 'completed', result_json = ?, updated_at = ?
     WHERE effect_key = ? AND account_id = ?`,
  )
    .bind(JSON.stringify(result), now, effectKey, accountId)
    .run();
}
