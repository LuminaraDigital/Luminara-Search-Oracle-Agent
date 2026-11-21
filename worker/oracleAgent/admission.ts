/**
 * Who may start an Oracle agent turn (Blueprint section 6, section 13 items 10, 11, 17).
 *
 * Three daily meters, all failing closed: one global ceiling (a kill switch), per client IP, and
 * per account (by plan). A continue turn after an approval skips the account meter but still
 * counts against the IP and global meters. When a later meter refuses, the earlier ones are given
 * back; a turn that produced no answer gives all of them back. Over any cap the chat answers
 * AGENT_CAP and the client falls back to today's chat.
 */
import type { Env } from '../env';
import { refundDailyQuota, spendDailyQuota } from '../quotaMiddleware';
import { globalTurnsPerDay, ipTurnsPerDay, type AgentLimits } from './limits';

export function isOracleAgentEnabled(env: Env): boolean {
  return String(env.ORACLE_AGENT_ENABLED || '').toLowerCase() === 'true';
}

type SpentMeter = { key: string; limit: number };
type MeterName = 'global' | 'ip' | 'account';

export type AgentAdmission = { ok: true; spent: SpentMeter[] } | { ok: false; which: MeterName; message: string };

const CAP_MESSAGE: Record<MeterName, string> = {
  account: "Today's step-by-step Oracle answers are used up on this plan. Oracle answers in the simple mode until tomorrow.",
  ip: 'Too many Oracle answers from this network today. Oracle answers in the simple mode until tomorrow.',
  global: 'Oracle is very busy today. It answers in the simple mode for now.',
};

async function refundAll(env: Env, spent: SpentMeter[]): Promise<void> {
  await Promise.all(spent.map((m) => refundDailyQuota(env, m.key, m.limit).catch(() => undefined)));
}

export async function admitAgentTurn(opts: {
  env: Env;
  accountId: string;
  ip: string | null;
  limits: AgentLimits;
  isContinue: boolean;
}): Promise<AgentAdmission> {
  const { env } = opts;
  const meters: Array<{ which: MeterName; id: string; limit: number }> = [
    { which: 'global', id: 'oracle-agent-global', limit: globalTurnsPerDay(env.ORACLE_AGENT_GLOBAL_TURNS) },
    ...(opts.ip ? [{ which: 'ip' as const, id: `oracle-agent-ip:${opts.ip}`, limit: ipTurnsPerDay(env.ORACLE_AGENT_IP_TURNS) }] : []),
    ...(opts.isContinue ? [] : [{ which: 'account' as const, id: `${opts.accountId}:oracle-agent`, limit: opts.limits.turnsPerDay }]),
  ];
  const spent: SpentMeter[] = [];
  for (const meter of meters) {
    const result = await spendDailyQuota(env, meter.id, meter.limit);
    if (!result.ok) {
      await refundAll(env, spent);
      return { ok: false, which: meter.which, message: CAP_MESSAGE[meter.which] };
    }
    spent.push({ key: result.meterKey, limit: meter.limit });
  }
  return { ok: true, spent };
}

/** Give back every meter a turn spent, when it produced no answer (the client falls back). */
export async function refundAgentTurn(env: Env, admission: AgentAdmission | null): Promise<void> {
  if (admission?.ok) await refundAll(env, admission.spent);
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
