/**
 * Monday curator: archive stale unpinned skills. One account failure does not stop the sweep.
 */
import type { Env } from './env';
import { curateRsiAccount, listCuratorAccountIds } from './rsiSkillStore';

export async function runRsiSkillCurator(env: Env): Promise<{ accounts: number; staled: number; archived: number }> {
  if (!env.DB) return { accounts: 0, staled: 0, archived: 0 };
  const accounts = await listCuratorAccountIds(env);
  let staled = 0;
  let archived = 0;
  for (const accountId of accounts) {
    try {
      const result = await curateRsiAccount(env, accountId);
      staled += result.staled;
      archived += result.archived;
    } catch (err) {
      console.error('[RSI] skill curator failed for an account', err instanceof Error ? err.message : 'error');
    }
  }
  return { accounts: accounts.length, staled, archived };
}
