/**
 * Rakazo-Style Deterministic External Effects Ledger Service
 *
 * Ensures retried webhooks, outbound recovery steps, CRM sync calls, and CMS MCP mutations
 * never double-execute across the Worker.
 */

import type { Env } from './env';
import { computeExternalEffectKey } from '../services/enquiries/playbookQualificationService';
import { safeJsonParse } from '../services/llm/safeJsonParse';

export async function checkOrRecordExternalEffect<T>(
  env: Env,
  args: {
    accountId: string;
    projectId: string;
    targetSystem: string;
    actionKind: string;
    payload: unknown;
    now?: number;
  },
): Promise<
  | { duplicate: true; effectKey: string; cachedResult: T | null }
  | { duplicate: false; effectKey: string; payloadHash: string }
> {
  const { effectKey, payloadHash } = await computeExternalEffectKey(args);
  if (!env.DB) {
    return { duplicate: false, effectKey, payloadHash };
  }

  const existing = await env.DB.prepare(
    `SELECT status, result_json FROM external_effects WHERE effect_key = ? AND account_id = ?`,
  )
    .bind(effectKey, args.accountId)
    .first<{ status: string; result_json: string | null }>();

  if (existing && existing.status === 'completed') {
    const cachedResult = existing.result_json
      ? safeJsonParse<T | null>(existing.result_json, null)
      : null;
    return { duplicate: true, effectKey, cachedResult };
  }

  const now = args.now ?? Date.now();
  await env.DB.prepare(
    `INSERT INTO external_effects (
      effect_key, account_id, project_id, target_system, action_kind, payload_hash, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(effect_key) DO UPDATE SET updated_at = excluded.updated_at`,
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

  return { duplicate: false, effectKey, payloadHash };
}

/**
 * Single-use claim for an approved Oracle action (worker/oracleAgent/approvals.ts). Unlike
 * checkOrRecordExternalEffect this is a lock: the key is the action id, the insert does nothing
 * on conflict, and only the caller whose insert changed a row may run the action. A second caller
 * gets the existing row's status and must not run it (an unknown outcome is never retried).
 */
export async function claimExternalEffect(
  env: Env,
  args: {
    actionId: string;
    accountId: string;
    projectId: string | null;
    targetSystem: string;
    actionKind: string;
    payloadHash: string;
    now?: number;
  },
): Promise<{ claimed: true; effectKey: string } | { claimed: false; effectKey: string; status: string | null }> {
  const effectKey = `oracle_action:${args.actionId}`;
  if (!env.DB) return { claimed: false, effectKey, status: null };
  const now = args.now ?? Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO external_effects (
      effect_key, account_id, project_id, target_system, action_kind, payload_hash, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(effect_key) DO NOTHING`,
  )
    .bind(effectKey, args.accountId, args.projectId ?? '', args.targetSystem, args.actionKind, args.payloadHash, now, now)
    .run();
  if (Number(res.meta?.changes ?? 0) === 1) return { claimed: true, effectKey };
  const existing = await env.DB.prepare(`SELECT status FROM external_effects WHERE effect_key = ? AND account_id = ?`)
    .bind(effectKey, args.accountId)
    .first<{ status: string }>();
  return { claimed: false, effectKey, status: existing?.status ?? null };
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
