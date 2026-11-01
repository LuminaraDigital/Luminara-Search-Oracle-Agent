/**
 * KV storage for `lm_hab_*` tokens. Each token has a record keyed by its hash, and an account
 * index entry so the owner can list and revoke tokens without the store holding any secret.
 * Kept apart from selfDrivingHabitat.ts so account erasure can use it without importing MCP.
 */
import type { Env } from './env';

const HABITAT_KV_PREFIX = 'hab_token:';
const HABITAT_INDEX_PREFIX = 'hab_account:';

export type HabitatRiskCeiling = 'read' | 'write';

/** What the owner sees for a live token. */
export interface HabitatTokenSummary {
  id: string;
  label: string;
  domain: string | null;
  maxRisk: HabitatRiskCeiling;
  expiresAt: number;
}

export type HabitatIndexEntry = HabitatTokenSummary & { tokenHash: string };

export function habitatTokenKey(tokenHash: string): string {
  return `${HABITAT_KV_PREFIX}${tokenHash}`;
}

function habitatIndexPrefix(accountId: string): string {
  return `${HABITAT_INDEX_PREFIX}${accountId}:`;
}

export function habitatIndexKey(accountId: string, id: string): string {
  return `${habitatIndexPrefix(accountId)}${id}`;
}

export async function readHabitatIndex(env: Env, accountId: string): Promise<HabitatIndexEntry[]> {
  const kv = env.LUMINARA_KV;
  if (!kv) return [];
  const listed = await kv.list({ prefix: habitatIndexPrefix(accountId) });
  const values = await Promise.all(listed.keys.map((k) => kv.get(k.name)));
  return values.flatMap((raw) => (raw ? [JSON.parse(raw) as HabitatIndexEntry] : []));
}

async function deleteHabitatToken(env: Env, accountId: string, entry: HabitatIndexEntry): Promise<void> {
  await Promise.all([
    env.LUMINARA_KV?.delete(habitatTokenKey(entry.tokenHash)),
    env.LUMINARA_KV?.delete(habitatIndexKey(accountId, entry.id)),
  ]);
}

/** KV reads are eventually consistent, so a revoked token can work for up to a minute more. */
export async function revokeHabitatToken(env: Env, accountId: string, id: string): Promise<boolean> {
  const entry = (await readHabitatIndex(env, accountId)).find((t) => t.id === id);
  if (!entry) return false;
  await deleteHabitatToken(env, accountId, entry);
  return true;
}

export async function revokeAllHabitatTokens(env: Env, accountId: string): Promise<number> {
  const entries = await readHabitatIndex(env, accountId);
  await Promise.all(entries.map((entry) => deleteHabitatToken(env, accountId, entry)));
  return entries.length;
}
