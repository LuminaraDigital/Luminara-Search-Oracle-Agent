/**
 * Agency / Growth API keys for MCP (hashed at rest).
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, sha256Hex } from './workerUtils';
import { randomId } from '../services/projects/projectUtils';

const KEY_PREFIX = 'lm_live_';

export type ApiKeyMeta = {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export async function createApiKey(
  env: Env,
  user: HostedIdentity,
  name: string,
): Promise<{ ok: true; key: string; meta: ApiKeyMeta } | { ok: false; error: string; status: number }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable', status: 503 };
  const accountId = billingId(user);
  const label = String(name || 'MCP key').trim().slice(0, 64) || 'MCP key';
  const secret = randomId('k', 24).replace(/^k_/, '');
  const key = `${KEY_PREFIX}${secret}`;
  const keyHash = await sha256Hex(`luminara-api-key:${key}`);
  const id = randomId('apk');
  const now = Date.now();
  const prefix = key.slice(0, 12);

  await env.DB.prepare(
    `INSERT INTO api_keys (id, account_id, key_hash, name, key_prefix, last_used_at, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL)`,
  )
    .bind(id, accountId, keyHash, label, prefix, now)
    .run();

  return {
    ok: true,
    key,
    meta: { id, name: label, prefix, createdAt: now, lastUsedAt: null },
  };
}

export async function listApiKeys(env: Env, user: HostedIdentity): Promise<ApiKeyMeta[]> {
  if (!env.DB) return [];
  const accountId = billingId(user);
  const res = await env.DB.prepare(
    `SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys
     WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(accountId)
    .all<{ id: string; name: string; key_prefix: string | null; created_at: number; last_used_at: number | null }>();
  return (res.results || []).map((r) => ({
    id: r.id,
    name: r.name,
    // Prefer stored prefix from create; legacy rows without key_prefix stay opaque.
    prefix: r.key_prefix || `${KEY_PREFIX}...`,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function revokeApiKey(
  env: Env,
  user: HostedIdentity,
  keyId: string,
): Promise<boolean> {
  if (!env.DB) return false;
  const accountId = billingId(user);
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
  )
    .bind(now, keyId, accountId)
    .run();
  return Number(result.meta?.changes || 0) > 0;
}

/**
 * Resolve Bearer lm_live_* to a HostedIdentity scoped to the key's account.
 */
export async function identifyApiKey(
  env: Env,
  bearer: string | null,
): Promise<HostedIdentity | null> {
  if (!env.DB || !bearer || !bearer.startsWith(KEY_PREFIX)) return null;
  const keyHash = await sha256Hex(`luminara-api-key:${bearer}`);
  const row = await env.DB.prepare(
    `SELECT id, account_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL`,
  )
    .bind(keyHash)
    .first<{ id: string; account_id: string }>();
  if (!row) return null;
  await env.DB.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`)
    .bind(Date.now(), row.id)
    .run();
  return {
    id: `apk:${row.id}`,
    source: 'firebase',
    accountId: row.account_id,
    name: 'API key',
  };
}
