/**
 * Who may start an Oracle agent turn (Blueprint section 6, section 13 items 10, 11, 17).
 *
 * Three daily meters, all failing closed: per account (by plan), per client IP, and one global
 * ceiling that works as a kill switch. A continue turn after an approval skips the account meter
 * but still counts against the IP and global meters. Over any cap the chat answers with
 * AGENT_CAP and the client falls back to today's chat.
 */
import type { Env } from '../env';
import { refundDailyQuota, spendDailyQuota } from '../quotaMiddleware';
import { globalTurnsPerDay, ipTurnsPerDay, type AgentLimits } from './limits';

export function isOracleAgentEnabled(env: Env): boolean {
  return String(env.ORACLE_AGENT_ENABLED || '').toLowerCase() === 'true';
}

export type AgentAdmission =
  | { ok: true; accountMeter: string | null; accountLimit: number }
  | { ok: false; which: 'account' | 'ip' | 'global'; message: string };

const CAP_MESSAGE: Record<'account' | 'ip' | 'global', string> = {
  account: "Today's Oracle step-by-step answers are used up on this plan. Oracle answers in the simple mode until tomorrow.",
  ip: 'Too many Oracle answers from this network today. Oracle answers in the simple mode until tomorrow.',
  global: 'Oracle is very busy today. It answers in the simple mode for now.',
};

export async function admitAgentTurn(opts: {
  env: Env;
  accountId: string;
  ip: string | null;
  limits: AgentLimits;
  isContinue: boolean;
}): Promise<AgentAdmission> {
  const { env } = opts;
  const global = await spendDailyQuota(env, 'oracle-agent-global', globalTurnsPerDay(env.ORACLE_AGENT_GLOBAL_TURNS));
  if (!global.ok) return { ok: false, which: 'global', message: CAP_MESSAGE.global };
  if (opts.ip) {
    const ipSpend = await spendDailyQuota(env, `oracle-agent-ip:${opts.ip}`, ipTurnsPerDay(env.ORACLE_AGENT_IP_TURNS));
    if (!ipSpend.ok) return { ok: false, which: 'ip', message: CAP_MESSAGE.ip };
  }
  if (opts.isContinue) return { ok: true, accountMeter: null, accountLimit: 0 };
  const account = await spendDailyQuota(env, `${opts.accountId}:oracle-agent`, opts.limits.turnsPerDay);
  if (!account.ok) return { ok: false, which: 'account', message: CAP_MESSAGE.account };
  return { ok: true, accountMeter: account.meterKey, accountLimit: opts.limits.turnsPerDay };
}

/** Give back the account's turn when the agent produced no answer (the client falls back). */
export async function refundAgentTurn(env: Env, admission: AgentAdmission): Promise<void> {
  if (!admission.ok || !admission.accountMeter) return;
  await refundDailyQuota(env, admission.accountMeter, admission.accountLimit).catch(() => undefined);
}

const SEEN_TTL_SECONDS = 8 * 24 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Counters without personal data (section 13 item 17): one log line per agent turn by plan, and one
 * "return" line when a Free account comes back between 1 and 7 days after its first agent turn.
 * The account id stays in KV with an 8-day expiry; it never goes into a log line.
 */
export async function countAgentTurn(env: Env, accountId: string, plan: string, extra: Record<string, unknown>): Promise<void> {
  console.log(JSON.stringify({ event: 'oracle_agent_turn', plan, ...extra }));
  if (plan !== 'free' || !env.LUMINARA_KV) return;
  const key = `oracle_agent_seen:${accountId}`;
  try {
    const first = Number(await env.LUMINARA_KV.get(key));
    const now = Date.now();
    if (!first) {
      await env.LUMINARA_KV.put(key, String(now), { expirationTtl: SEEN_TTL_SECONDS });
      return;
    }
    const age = now - first;
    if (age >= DAY_MS && age <= 7 * DAY_MS) {
      console.log(JSON.stringify({ event: 'oracle_agent_return', plan, days: Math.floor(age / DAY_MS) }));
      // One return per window: the next agent turn starts a new window.
      await env.LUMINARA_KV.delete(key);
    }
  } catch {
    /* counters are best effort */
  }
}
