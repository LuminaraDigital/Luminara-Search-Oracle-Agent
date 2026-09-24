/**
 * Hosted memory facts API (W8 incremental before Vectorize).
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { randomId } from '../services/projects/projectUtils';

const DAILY_INSERT_CAP = 100;

export async function listMemoryFacts(env: Env, user: HostedIdentity): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const accountId = billingId(user);
  const res = await env.DB.prepare(
    `SELECT id, account_id, text, source, created_at FROM memory_facts
     WHERE account_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(accountId)
    .all<{ id: string; account_id: string; text: string; source: string; created_at: number }>();

  return json({
    ok: true,
    facts: (res.results || []).map((r) => ({
      id: r.id,
      accountId: r.account_id,
      text: r.text,
      source: r.source,
      createdAt: r.created_at,
    })),
  });
}

export async function createMemoryFact(
  request: Request,
  env: Env,
  user: HostedIdentity,
): Promise<Response> {
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const body = (await request.json().catch(() => ({}))) as { text?: string; accountId?: unknown; userId?: unknown };
  // Reject client-supplied tenancy fields (mass assignment / IDOR).
  if (body.accountId !== undefined || body.userId !== undefined) {
    return json(
      { ok: false, error: 'accountId/userId are not accepted; identity comes from auth', code: 'INVALID_PAYLOAD' },
      400,
    );
  }
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
  if (!text) return json({ ok: false, error: 'text required' }, 400);

  const accountId = billingId(user);

  if (env.LUMINARA_KV) {
    const day = new Date().toISOString().slice(0, 10);
    const quotaKey = `memory_daily:${accountId}:${day}`;
    const used = Number((await env.LUMINARA_KV.get(quotaKey)) || 0);
    if (used >= DAILY_INSERT_CAP) {
      return json(
        {
          ok: false,
          error: `Daily memory write limit of ${DAILY_INSERT_CAP} reached.`,
          code: 'MEMORY_DAILY_CAP',
        },
        429,
      );
    }
    await env.LUMINARA_KV.put(quotaKey, String(used + 1), { expirationTtl: 2 * 86400 });
  }

  const id = randomId('mem', 10);
  const createdAt = Date.now();
  await env.DB.prepare(
    `INSERT INTO memory_facts (id, account_id, text, source, created_at) VALUES (?, ?, ?, 'hosted', ?)`,
  )
    .bind(id, accountId, text, createdAt)
    .run();

  return json({
    ok: true,
    fact: { id, accountId, text, source: 'hosted', createdAt },
  });
}
