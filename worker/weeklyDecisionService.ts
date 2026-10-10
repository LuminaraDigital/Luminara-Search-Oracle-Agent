/**
 * Durable Weekly Decision Card + WDL honesty captures (migration 0014).
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { enqueueDreamEvent } from './dreamingQueue';

function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export type MeasurementStatus = 'measured' | 'estimated' | 'not_measured';

export function assertHonestyLabel(status: string): MeasurementStatus {
  if (status === 'measured' || status === 'estimated' || status === 'not_measured') return status;
  return 'not_measured';
}

export async function handleWeeklyDecisionsRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith('/weekly-decisions') && !path.startsWith('/ai-answers') && !path.startsWith('/prepared-assets') && !path.startsWith('/reputation') && !path.startsWith('/thin-stack')) {
    return null;
  }
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const accountId = billingId(user);

  if (path === '/weekly-decisions' && request.method === 'GET') {
    const url = new URL(request.url);
    const domain = (url.searchParams.get('domain') || '').trim().toLowerCase();
    if (!domain) return json({ ok: false, error: 'domain required' }, 400);
    const week = url.searchParams.get('week') || isoWeekKey();
    const row = await env.DB.prepare(
      `SELECT * FROM weekly_decisions WHERE account_id = ? AND domain = ? AND week_key = ?`,
    )
      .bind(accountId, domain, week)
      .first();
    return json({ ok: true, decision: row, weekKey: week });
  }

  if (path === '/weekly-decisions' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      domain?: string;
      title?: string;
      whyText?: string;
      evidence?: unknown;
      findingId?: string;
      commitment?: unknown;
      confidence?: string;
      dataFreshness?: string;
      verifyBy?: number;
      projectId?: string;
    };
    const domain = (body.domain || '').trim().toLowerCase();
    const title = (body.title || '').trim();
    if (!domain || !title) return json({ ok: false, error: 'domain and title required' }, 400);
    const week = isoWeekKey();
    const now = Date.now();
    const freshness = body.dataFreshness === 'live' ? 'live' : body.dataFreshness === 'mixed' ? 'mixed' : 'sample';
    const existing = await env.DB.prepare(
      `SELECT id, version FROM weekly_decisions WHERE account_id = ? AND domain = ? AND week_key = ?`,
    )
      .bind(accountId, domain, week)
      .first<{ id: string; version: number }>();

    if (existing) {
      await env.DB.prepare(
        `UPDATE weekly_decisions SET
          title = ?, why_text = ?, evidence_json = ?, finding_id = ?, commitment_json = ?,
          confidence = ?, data_freshness = ?, verify_by = ?, version = version + 1, updated_at = ?,
          project_id = COALESCE(?, project_id)
         WHERE id = ?`,
      )
        .bind(
          title.slice(0, 300),
          (body.whyText || '').slice(0, 4000),
          JSON.stringify(body.evidence ?? []),
          body.findingId || null,
          body.commitment ? JSON.stringify(body.commitment) : null,
          body.confidence || 'medium',
          freshness,
          body.verifyBy || now + 14 * 86400000,
          now,
          body.projectId || null,
          existing.id,
        )
        .run();
      const row = await env.DB.prepare(`SELECT * FROM weekly_decisions WHERE id = ?`).bind(existing.id).first();
      try {
        await enqueueDreamEvent(env, {
          accountId,
          domain,
          eventType: 'recommendation_updated',
          sourceId: existing.id,
          payload: { title, whyText: body.whyText, status: 'updated', confidence: body.confidence },
        });
      } catch {
        /* ignore dreaming queue failure */
      }
      return json({ ok: true, decision: row });
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO weekly_decisions
        (id, account_id, project_id, domain, week_key, title, why_text, evidence_json,
         prepare_status, verify_by, finding_id, commitment_json, confidence, data_freshness,
         status, version, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?, ?, ?, 'open', 1, ?, ?, ?)`,
    )
      .bind(
        id,
        accountId,
        body.projectId || null,
        domain,
        week,
        title.slice(0, 300),
        (body.whyText || '').slice(0, 4000),
        JSON.stringify(body.evidence ?? []),
        body.verifyBy || now + 14 * 86400000,
        body.findingId || null,
        body.commitment ? JSON.stringify(body.commitment) : null,
        body.confidence || 'medium',
        freshness,
        user.id,
        now,
        now,
      )
      .run();
    const row = await env.DB.prepare(`SELECT * FROM weekly_decisions WHERE id = ?`).bind(id).first();
    try {
      await enqueueDreamEvent(env, {
        accountId,
        domain,
        eventType: 'recommendation_updated',
        sourceId: id,
        payload: { title, whyText: body.whyText, status: 'created', confidence: body.confidence },
      });
    } catch {
      /* ignore dreaming queue failure */
    }
    return json({ ok: true, decision: row });
  }

  if (path === '/ai-answers' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      domain?: string;
      captures?: Array<{
        engine?: string;
        prompt?: string;
        excerpt?: string;
        presence?: string;
        recommended?: boolean;
        cited?: boolean;
        measurementStatus?: string;
        accuracyVsDna?: string;
        sources?: unknown;
        label?: string;
      }>;
    };
    const domain = (body.domain || '').trim().toLowerCase();
    if (!domain || !Array.isArray(body.captures)) {
      return json({ ok: false, error: 'domain and captures required' }, 400);
    }
    const now = Date.now();
    const ids: string[] = [];
    for (const c of body.captures.slice(0, 50)) {
      const id = crypto.randomUUID();
      const measurement = assertHonestyLabel(String(c.measurementStatus || 'not_measured'));
      await env.DB.prepare(
        `INSERT INTO ai_answer_captures
          (id, account_id, domain, engine, prompt, excerpt, presence, recommended, cited,
           measurement_status, accuracy_vs_dna, sources_json, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          accountId,
          domain,
          String(c.engine || 'unknown').slice(0, 64),
          String(c.prompt || '').slice(0, 2000),
          String(c.excerpt || '').slice(0, 4000),
          String(c.presence || 'unknown').slice(0, 32),
          c.recommended ? 1 : 0,
          c.cited ? 1 : 0,
          measurement,
          String(c.accuracyVsDna || 'unknown').slice(0, 32),
          JSON.stringify(c.sources ?? []),
          measurement === 'measured' ? 'Live' : String(c.label || 'Sample').slice(0, 32),
          now,
        )
        .run();
      ids.push(id);
    }
    return json({ ok: true, ids });
  }

  if (path === '/ai-answers' && request.method === 'GET') {
    const url = new URL(request.url);
    const domain = (url.searchParams.get('domain') || '').trim().toLowerCase();
    if (!domain) return json({ ok: false, error: 'domain required' }, 400);
    const rows = await env.DB.prepare(
      `SELECT * FROM ai_answer_captures WHERE account_id = ? AND domain = ? ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(accountId, domain)
      .all();
    return json({ ok: true, captures: rows.results ?? [] });
  }

  // WDL5: prepared assets (never publish)
  if (path === '/prepared-assets' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      kind?: string;
      title?: string;
      bodyMd?: string;
      findingId?: string;
      weeklyDecisionId?: string;
      status?: string;
    };
    const status = body.status === 'ready' || body.status === 'exported' ? body.status : 'draft';
    if (body.status === 'published') {
      return json({ ok: false, error: 'published status is forbidden (Prepare only)', code: 'NO_PUBLISH' }, 400);
    }
    if (!body.kind || !body.title) return json({ ok: false, error: 'kind and title required' }, 400);
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO prepared_assets
        (id, account_id, finding_id, weekly_decision_id, kind, title, body_md, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        accountId,
        body.findingId || null,
        body.weeklyDecisionId || null,
        body.kind.slice(0, 64),
        body.title.slice(0, 300),
        (body.bodyMd || '').slice(0, 20000),
        status,
        now,
        now,
      )
      .run();
    return json({ ok: true, id, status });
  }

  if (path === '/prepared-assets' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT id, kind, title, status, finding_id, weekly_decision_id, created_at, updated_at
       FROM prepared_assets WHERE account_id = ? ORDER BY updated_at DESC LIMIT 100`,
    )
      .bind(accountId)
      .all();
    return json({ ok: true, assets: rows.results ?? [] });
  }

  // WDL7 reputation
  if (path === '/reputation/alerts' && request.method === 'GET') {
    const rows = await env.DB.prepare(
      `SELECT * FROM reputation_alerts WHERE account_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(accountId)
      .all();
    return json({ ok: true, alerts: rows.results ?? [] });
  }

  if (path === '/reputation/alerts' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      domain?: string;
      severity?: string;
      reason?: string;
      evidence?: unknown;
    };
    if (!body.domain || !body.reason) return json({ ok: false, error: 'domain and reason required' }, 400);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO reputation_alerts (id, account_id, domain, severity, reason, evidence_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        accountId,
        body.domain.trim().toLowerCase(),
        body.severity || 'medium',
        body.reason.slice(0, 2000),
        JSON.stringify(body.evidence ?? {}),
        Date.now(),
      )
      .run();
    return json({ ok: true, id });
  }

  const ackMatch = path.match(/^\/reputation\/alerts\/([^/]+)\/ack$/);
  if (ackMatch && request.method === 'POST') {
    await env.DB.prepare(
      `UPDATE reputation_alerts SET acknowledged = 1, ack_at = ? WHERE id = ? AND account_id = ?`,
    )
      .bind(Date.now(), ackMatch[1], accountId)
      .run();
    return json({ ok: true });
  }

  // WDL8 thin stack
  if (path === '/thin-stack' && (request.method === 'GET' || request.method === 'PUT')) {
    const url = new URL(request.url);
    const domain = (url.searchParams.get('domain') || '').trim().toLowerCase();
    if (request.method === 'GET') {
      if (!domain) return json({ ok: false, error: 'domain required' }, 400);
      const row = await env.DB.prepare(
        `SELECT * FROM thin_stack_inventory WHERE account_id = ? AND domain = ?`,
      )
        .bind(accountId, domain)
        .first();
      return json({ ok: true, inventory: row });
    }
    const body = (await request.json().catch(() => ({}))) as {
      domain?: string;
      items?: unknown;
      notes?: string;
    };
    const d = (body.domain || domain || '').trim().toLowerCase();
    if (!d) return json({ ok: false, error: 'domain required' }, 400);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO thin_stack_inventory (account_id, domain, items_json, notes, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, domain) DO UPDATE SET
         items_json = excluded.items_json, notes = excluded.notes, updated_at = excluded.updated_at`,
    )
      .bind(accountId, d, JSON.stringify(body.items ?? []), (body.notes || '').slice(0, 4000), now)
      .run();
    return json({ ok: true });
  }

  return null;
}
