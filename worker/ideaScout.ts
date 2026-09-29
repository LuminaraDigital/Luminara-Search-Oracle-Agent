/**
 * Idea Scout: a metered hypothesis card for founders who do not have a domain yet.
 * Hosted generation requires Telegram initData or a Firebase session.
 * Anonymous callers are rejected before any fetch or model call.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, identify, json } from './workerUtils';
import { checkHostedQuota, isUserSubscribed } from './quotaMiddleware';
import {
  MAX_SMALL_BODY_BYTES,
  readBody,
  resolvesToPublicAddress,
  safePublicUrl,
  type DohFetch,
} from './security';
import { safePublicHostname } from '../services/security/publicHostname';
import {
  FREE_IDEA_CARDS_PER_UTC_DAY,
  IDEA_ID_RE,
  applyModelSketch,
  assessContinuumLink,
  buildIdeaScoutCard,
  extractPageSample,
  formatNichePulseMessage,
  ideaCardSlot,
  ideaScoutQuotaKey,
  parseIdeaScoutRequest,
  plainPulseField,
  stripPercentageTheater,
  validateIdeaScoutCard,
  type CompetitorSnapshot,
  type IdeaScoutCard,
} from '../services/ideaScout/rules';

const FETCH_MS = 5_000;
const MAX_HTML_BYTES = 48_000;
const IDEA_SYSTEM = [
  'You draft an Idea Scout card for a founder who does not have a domain yet.',
  'Return one JSON object and nothing else.',
  'Fields: problem (string), whoAsksAi (label must be "model_inference", persona, promptPatterns), contentBets (exactly 3 items, each label "hypothesis" and hypothesis).',
  'Do not include percentages, SERP share, citation rates, scores, or status measured.',
  'Missing evidence is not_measured. These lines are hypotheses, not rankings.',
].join(' ');

export interface IdeaScoutDeps {
  fetcher?: typeof fetch;
  now?: () => number;
  completeModel?: (prompt: string, byokKey: string | null) => Promise<string | null>;
}

type PulseRow = { niche: string; lastTip: string | null; enabled: boolean };

function missingTable(err: unknown): boolean {
  return /no such table: (idea_scouts|niche_pulse_subs)/i.test(String((err as Error)?.message || err));
}

function dbRequired(): Response {
  return json({
    ok: false,
    error: 'Idea Scout needs D1 migration 0013_idea_scout.sql. Apply it on staging, then production, only after merge.',
    code: 'MIGRATION_REQUIRED',
  }, 503);
}

async function openAiSketch(
  url: string,
  key: string,
  prompt: string,
  fetcher: typeof fetch,
  extraHeaders: Record<string, string> = {},
): Promise<string | null> {
  try {
    const res = await fetcher(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: url.includes('openrouter.ai') ? 'openai/gpt-4o-mini' : 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: IDEA_SYSTEM },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 700,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

async function geminiSketch(key: string, prompt: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const res = await fetcher(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: IDEA_SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
        }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

/** Hosted keys are used only when byokKey is null. A caller key never falls through to env secrets. */
export async function completeIdeaSketch(
  env: Env,
  prompt: string,
  byokKey: string | null,
  fetcher: typeof fetch,
): Promise<string | null> {
  if (byokKey) {
    return openAiSketch('https://api.groq.com/openai/v1/chat/completions', byokKey, prompt, fetcher);
  }
  const groq = env.GROQ_API_KEY || env.GROQ_API_KEY_FALLBACK;
  if (groq) {
    const text = await openAiSketch('https://api.groq.com/openai/v1/chat/completions', groq, prompt, fetcher);
    if (text) return text;
  }
  if (env.GEMINI_API_KEY) {
    const text = await geminiSketch(env.GEMINI_API_KEY, prompt, fetcher);
    if (text) return text;
  }
  if (env.OPENROUTER_API_KEY) {
    const text = await openAiSketch(
      'https://openrouter.ai/api/v1/chat/completions',
      env.OPENROUTER_API_KEY,
      prompt,
      fetcher,
      { 'HTTP-Referer': env.WEBAPP_URL || 'https://luminarasuite.com', 'X-Title': 'Luminara Suite' },
    );
    if (text) return text;
  }
  return null;
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_HTML_BYTES);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_HTML_BYTES) {
      const step = await reader.read();
      if (step.done) break;
      if (!step.value) continue;
      chunks.push(step.value);
      total += step.value.byteLength;
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  const buf = new Uint8Array(Math.min(total, MAX_HTML_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, buf.length - offset);
    if (take <= 0) break;
    buf.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return new TextDecoder().decode(buf);
}

function emptySnapshot(url: string, hostname: string): CompetitorSnapshot {
  return { url, hostname, title: null, metaDescription: null, headings: [], fetchStatus: 'not_measured' };
}

export async function fetchCompetitorSnapshots(urls: string[], fetcher: typeof fetch = fetch): Promise<CompetitorSnapshot[]> {
  const snapshots: CompetitorSnapshot[] = [];
  for (const raw of urls) {
    const page = safePublicUrl(raw);
    if (!page) continue;
    const hostname = page.hostname;
    const pub = await resolvesToPublicAddress(hostname, fetcher as DohFetch);
    if (!pub) {
      snapshots.push(emptySnapshot(page.toString(), hostname));
      continue;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_MS);
    try {
      const res = await fetcher(page.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: { accept: 'text/html, text/plain;q=0.5' },
      });
      if (res.status >= 300 && res.status < 400) {
        snapshots.push(emptySnapshot(page.toString(), hostname));
        continue;
      }
      if (!res.ok) {
        snapshots.push(emptySnapshot(page.toString(), hostname));
        continue;
      }
      const type = (res.headers.get('content-type') || '').toLowerCase();
      if (type && !type.includes('text/html') && !type.includes('text/plain')) {
        snapshots.push(emptySnapshot(page.toString(), hostname));
        continue;
      }
      const sample = extractPageSample(await readCapped(res));
      const fetched = Boolean(sample.title || sample.headings.length);
      snapshots.push({
        url: page.toString(),
        hostname,
        title: sample.title,
        metaDescription: sample.metaDescription,
        headings: sample.headings,
        fetchStatus: fetched ? 'fetched' : 'not_measured',
      });
    } catch {
      snapshots.push(emptySnapshot(page.toString(), hostname));
    } finally {
      clearTimeout(timer);
    }
  }
  return snapshots;
}

function sketchPrompt(idea: string, niche: string | null, snapshots: CompetitorSnapshot[]): string {
  const lines = snapshots
    .filter((row) => row.fetchStatus === 'fetched')
    .map((row) => `${row.hostname}: ${stripPercentageTheater(row.title || row.headings[0] || 'page fetched')}`)
    .join('\n');
  return [
    `Idea: ${idea}`,
    `Niche: ${niche || 'not provided'}`,
    lines ? `Fetched page titles only (not rankings):\n${lines}` : 'No competitor page was fetched. Leave competitor claims unmeasured.',
  ].join('\n');
}

async function readIdeaCount(env: Env, accountId: string, now: number): Promise<number> {
  if (!env.LUMINARA_KV) return 0;
  const key = ideaScoutQuotaKey(accountId, new Date(now));
  return Number((await env.LUMINARA_KV.get(key)) || 0);
}

async function writeIdeaCount(env: Env, accountId: string, now: number, used: number): Promise<void> {
  if (!env.LUMINARA_KV) return;
  const key = ideaScoutQuotaKey(accountId, new Date(now));
  await env.LUMINARA_KV.put(key, String(used), { expirationTtl: 2 * 86400 });
}

function newIdeaId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `is_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function requireUser(request: Request, env: Env): Promise<{ user: HostedIdentity; accountId: string } | Response> {
  const who = await identify(request, env);
  if (!who.user) {
    return json({
      ok: false,
      error: who.error || 'Sign in with Telegram or your web account. Anonymous browsers cannot use hosted Idea Scout.',
      code: 'AUTH_REQUIRED',
    }, 401);
  }
  const user = { ...who.user, accountId: who.user.accountId || billingId(who.user) };
  return { user, accountId: billingId(user) };
}

export async function loadNichePulse(env: Env, accountId: string): Promise<PulseRow | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT niche, last_tip, enabled FROM niche_pulse_subs WHERE account_id = ?`,
  ).bind(accountId).first<{ niche: string; last_tip: string | null; enabled: number }>();
  if (!row) return null;
  return { niche: row.niche, lastTip: row.last_tip, enabled: row.enabled === 1 };
}

export async function saveNichePulse(env: Env, input: {
  accountId: string;
  niche: string;
  tip?: string | null;
  enabled: boolean;
}): Promise<void> {
  if (!env.DB) throw new Error('D1 is not configured');
  const now = Date.now();
  const niche = plainPulseField(input.niche, 80);
  if (!niche) throw new Error('Niche Pulse needs a niche name without percentages.');
  const tip = input.tip ? plainPulseField(input.tip, 200) : null;
  await env.DB.prepare(
    `INSERT INTO niche_pulse_subs (account_id, niche, last_tip, last_sent_at, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       niche = excluded.niche,
       last_tip = COALESCE(excluded.last_tip, niche_pulse_subs.last_tip),
       last_sent_at = excluded.last_sent_at,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  ).bind(input.accountId, niche, tip, now, input.enabled ? 1 : 0, now, now).run();
}

async function markPulseSent(env: Env, accountId: string): Promise<void> {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE niche_pulse_subs SET last_sent_at = ?, updated_at = ? WHERE account_id = ?`,
  ).bind(now, now, accountId).run();
}

function cardFromRow(raw: string): IdeaScoutCard | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const verdict = validateIdeaScoutCard(parsed);
    return verdict.ok ? verdict.card : null;
  } catch {
    return null;
  }
}

async function createIdea(request: Request, env: Env, user: HostedIdentity, accountId: string, deps: IdeaScoutDeps): Promise<Response> {
  if (!env.DB) return dbRequired();
  const read = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const parsed = parseIdeaScoutRequest(read.value);
  if (!parsed.ok) return json({ ok: false, error: parsed.error, code: parsed.code }, 400);

  const byokKey = request.headers.get('x-provider-key')?.trim() || '';
  if (byokKey.length > 512) {
    return json({ ok: false, error: 'Provider key is too long.', code: 'BAD_BYOK' }, 400);
  }
  const byok = byokKey.length > 0;
  const now = deps.now ? deps.now() : Date.now();
  let remaining: number | null = null;
  const hosted = !byok;

  if (!byok) {
    if (!env.LUMINARA_KV) {
      return json({
        ok: false,
        error: 'Quota store unavailable. Try again later or pass your own provider key.',
        code: 'QUOTA_STORE',
      }, 503);
    }
    const subscribed = await isUserSubscribed(env, user);
    const used = await readIdeaCount(env, accountId, now);
    const slot = ideaCardSlot({ subscribed, byok: false, usedToday: used });
    if (!slot.ok) return json({ ok: false, error: slot.error, code: slot.code, limit: FREE_IDEA_CARDS_PER_UTC_DAY }, 429);
    const quota = await checkHostedQuota(env, user);
    if (!quota.ok) return json({ ok: false, error: quota.error || 'Hosted limit reached.', code: 'HOSTED_QUOTA' }, 429);
    if (!subscribed) await writeIdeaCount(env, accountId, now, used + 1);
    remaining = slot.remaining;
  }

  const fetcher = deps.fetcher || fetch;
  let snapshots: CompetitorSnapshot[] = [];
  try {
    snapshots = await fetchCompetitorSnapshots(parsed.competitorUrls, fetcher);
  } catch {
    snapshots = [];
  }
  const base = buildIdeaScoutCard({ idea: parsed.idea, niche: parsed.niche, snapshots });
  const baseVerdict = validateIdeaScoutCard(base);
  if (!baseVerdict.ok) {
    return json({ ok: false, error: 'Could not build an honesty-safe card.', code: baseVerdict.code }, 500);
  }
  let card = baseVerdict.card;
  try {
    const sketch = deps.completeModel
      ? await deps.completeModel(sketchPrompt(parsed.idea, parsed.niche, snapshots), byok ? byokKey : null)
      : await completeIdeaSketch(env, sketchPrompt(parsed.idea, parsed.niche, snapshots), byok ? byokKey : null, fetcher);
    if (sketch) card = applyModelSketch(card, sketch);
  } catch {
    card = baseVerdict.card;
  }
  const finalVerdict = validateIdeaScoutCard(card);
  const stored = finalVerdict.ok ? finalVerdict.card : baseVerdict.card;

  const id = newIdeaId();
  try {
    await env.DB.prepare(
      `INSERT INTO idea_scouts (id, account_id, idea_text, niche, competitor_urls_json, card_json, status, created_at, linked_domain, linked_audit_run_id)
       VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, NULL, NULL)`,
    ).bind(
      id,
      accountId,
      parsed.idea,
      parsed.niche,
      JSON.stringify(parsed.competitorUrls),
      JSON.stringify(stored),
      now,
    ).run();
  } catch (err) {
    if (missingTable(err)) return dbRequired();
    return json({ ok: false, error: 'Could not store the idea card.', code: 'STORE_FAILED' }, 503);
  }

  let pulseEnabled = false;
  if (parsed.pulseOptIn && parsed.niche) {
    try {
      await saveNichePulse(env, {
        accountId,
        niche: parsed.niche,
        tip: stored.contentBets[0]?.hypothesis || null,
        enabled: true,
      });
      pulseEnabled = true;
    } catch {
      pulseEnabled = false;
    }
  }

  return json({
    ok: true,
    id,
    card: stored,
    status: 'ready',
    hosted,
    ideaCardsRemaining: remaining,
    pulseEnabled,
  });
}

async function linkIdea(request: Request, env: Env, accountId: string, id: string): Promise<Response> {
  if (!env.DB) return dbRequired();
  if (!IDEA_ID_RE.test(id)) return json({ ok: false, error: 'Unknown idea card.', code: 'NOT_FOUND' }, 404);
  const read = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const body = (read.value && typeof read.value === 'object' && !Array.isArray(read.value))
    ? { ...(read.value as Record<string, unknown>), callerIsGuest: false }
    : null;
  if (!body) return json({ ok: false, error: 'Send a JSON object with a public domain.', code: 'BAD_BODY' }, 400);
  const verdict = assessContinuumLink(body, safePublicHostname);
  if (!verdict.ok) return json({ ok: false, error: verdict.error, code: verdict.code }, 400);

  const owned = await env.DB.prepare(
    `SELECT id FROM idea_scouts WHERE id = ? AND account_id = ?`,
  ).bind(id, accountId).first<{ id: string }>();
  if (!owned) return json({ ok: false, error: 'Unknown idea card.', code: 'NOT_FOUND' }, 404);

  let linkedAuditRunId: string | null = null;
  if (verdict.auditRunId) {
    const run = await env.DB.prepare(
      `SELECT id FROM audit_runs WHERE id = ? AND account_id = ?`,
    ).bind(verdict.auditRunId, accountId).first<{ id: string }>();
    if (run) linkedAuditRunId = run.id;
  }
  if (!linkedAuditRunId) {
    const latest = await env.DB.prepare(
      `SELECT id FROM audit_runs WHERE account_id = ? AND domain = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(accountId, verdict.domain).first<{ id: string }>();
    if (latest) linkedAuditRunId = latest.id;
  }

  try {
    await env.DB.prepare(
      `UPDATE idea_scouts
       SET linked_domain = ?, linked_audit_run_id = COALESCE(?, linked_audit_run_id), status = 'linked'
       WHERE id = ? AND account_id = ?`,
    ).bind(verdict.domain, linkedAuditRunId, id, accountId).run();
  } catch (err) {
    if (missingTable(err)) return dbRequired();
    return json({ ok: false, error: 'Could not link this idea to Instant Audit.', code: 'STORE_FAILED' }, 503);
  }

  const row = await env.DB.prepare(
    `SELECT linked_audit_run_id FROM idea_scouts WHERE id = ? AND account_id = ?`,
  ).bind(id, accountId).first<{ linked_audit_run_id: string | null }>();

  return json({
    ok: true,
    linkedDomain: verdict.domain,
    linkedAuditRunId: row?.linked_audit_run_id || null,
    startParam: `audit_${verdict.domain}`,
  });
}

async function getIdea(env: Env, accountId: string, id: string): Promise<Response> {
  if (!env.DB) return dbRequired();
  if (!IDEA_ID_RE.test(id)) return json({ ok: false, error: 'Unknown idea card.', code: 'NOT_FOUND' }, 404);
  try {
    const row = await env.DB.prepare(
      `SELECT id, idea_text, niche, card_json, status, created_at, linked_domain, linked_audit_run_id
       FROM idea_scouts WHERE id = ? AND account_id = ?`,
    ).bind(id, accountId).first<{
      id: string;
      idea_text: string;
      niche: string | null;
      card_json: string;
      status: string;
      created_at: number;
      linked_domain: string | null;
      linked_audit_run_id: string | null;
    }>();
    if (!row) return json({ ok: false, error: 'Unknown idea card.', code: 'NOT_FOUND' }, 404);
    const card = cardFromRow(row.card_json);
    if (!card) return json({ ok: false, error: 'Stored card failed honesty checks.', code: 'CARD_REJECTED' }, 500);
    return json({
      ok: true,
      id: row.id,
      ideaText: row.idea_text,
      niche: row.niche,
      card,
      status: row.status,
      createdAt: row.created_at,
      linkedDomain: row.linked_domain,
      linkedAuditRunId: row.linked_audit_run_id,
    });
  } catch (err) {
    if (missingTable(err)) return dbRequired();
    return json({ ok: false, error: 'Could not read the idea card.', code: 'STORE_FAILED' }, 503);
  }
}

async function listIdeas(env: Env, accountId: string): Promise<Response> {
  if (!env.DB) return dbRequired();
  try {
    const rows = await env.DB.prepare(
      `SELECT id, idea_text, niche, status, created_at, linked_domain, linked_audit_run_id
       FROM idea_scouts WHERE account_id = ? ORDER BY created_at DESC LIMIT 20`,
    ).bind(accountId).all<{
      id: string;
      idea_text: string;
      niche: string | null;
      status: string;
      created_at: number;
      linked_domain: string | null;
      linked_audit_run_id: string | null;
    }>();
    return json({
      ok: true,
      ideas: (rows.results || []).map((row) => ({
        id: row.id,
        ideaText: row.idea_text,
        niche: row.niche,
        status: row.status,
        createdAt: row.created_at,
        linkedDomain: row.linked_domain,
        linkedAuditRunId: row.linked_audit_run_id,
      })),
    });
  } catch (err) {
    if (missingTable(err)) return dbRequired();
    return json({ ok: false, error: 'Could not list idea cards.', code: 'STORE_FAILED' }, 503);
  }
}

async function upsertPulse(request: Request, env: Env, accountId: string): Promise<Response> {
  if (!env.DB) return dbRequired();
  const read = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!read.ok) return json({ ok: false, error: read.error }, read.status);
  const body = (read.value && typeof read.value === 'object' && !Array.isArray(read.value))
    ? read.value as Record<string, unknown>
    : {};
  const enabled = body.enabled !== false;
  const existing = await loadNichePulse(env, accountId).catch(() => null);
  const niche = typeof body.niche === 'string' && body.niche.trim()
    ? body.niche
    : existing?.niche || '';
  if (enabled && !plainPulseField(niche, 80)) {
    return json({ ok: false, error: 'Niche Pulse needs a niche name without percentages.', code: 'BAD_NICHE' }, 400);
  }
  try {
    await saveNichePulse(env, {
      accountId,
      niche: niche || 'general',
      tip: typeof body.tip === 'string' ? body.tip : existing?.lastTip || null,
      enabled,
    });
  } catch (err) {
    if (missingTable(err)) return dbRequired();
    const message = String((err as Error)?.message || '');
    if (/percentages/i.test(message)) {
      return json({ ok: false, error: 'Niche Pulse does not store percentages or search share.', code: 'PERCENT_NOT_ACCEPTED' }, 400);
    }
    return json({ ok: false, error: 'Could not store Niche Pulse.', code: 'STORE_FAILED' }, 503);
  }
  const saved = await loadNichePulse(env, accountId);
  return json({
    ok: true,
    enabled: saved?.enabled === true,
    niche: saved?.niche || null,
    message: formatNichePulseMessage({ niche: saved?.niche || niche, tip: saved?.lastTip || null }),
  });
}

export async function handleIdeaScoutRoute(request: Request, env: Env, path: string, deps: IdeaScoutDeps = {}): Promise<Response> {
  const auth = await requireUser(request, env);
  if (auth instanceof Response) return auth;
  const { user, accountId } = auth;

  if (path === '/idea-scout' && request.method === 'POST') return createIdea(request, env, user, accountId, deps);
  if (path === '/idea-scout' && request.method === 'GET') return listIdeas(env, accountId);
  if (path === '/idea-scout/pulse' && request.method === 'POST') return upsertPulse(request, env, accountId);

  const link = /^\/idea-scout\/(is_[a-f0-9]{16})\/link$/.exec(path);
  if (link) {
    if (request.method !== 'PATCH') return json({ ok: false, error: 'Method not allowed' }, 405);
    return linkIdea(request, env, accountId, link[1]);
  }
  const one = /^\/idea-scout\/(is_[a-f0-9]{16})$/.exec(path);
  if (one) {
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
    return getIdea(env, accountId, one[1]);
  }
  return json({ ok: false, error: 'Unknown Idea Scout route.', code: 'NOT_FOUND' }, 404);
}

export async function nichePulseReply(env: Env, accountId: string | null, arg: string): Promise<string> {
  const rest = arg.trim();
  if (/^off$/i.test(rest) || /^stop$/i.test(rest)) {
    if (accountId && env.DB) {
      const existing = await loadNichePulse(env, accountId).catch(() => null);
      if (existing) {
        await saveNichePulse(env, { accountId, niche: existing.niche, tip: existing.lastTip, enabled: false });
      }
    }
    return 'Niche Pulse is off. Ask /pulse when you want it again. Nothing is sent on a schedule.';
  }
  if (rest && /\d+(?:\.\d+)?\s*%/.test(rest)) {
    return 'Niche Pulse does not store percentages or search share. Send a niche name only.';
  }
  if (rest.length > 80) return 'Keep the niche under 80 characters.';

  if (!rest) {
    if (accountId && env.DB) {
      const existing = await loadNichePulse(env, accountId).catch(() => null);
      if (existing && !existing.enabled) {
        return 'Niche Pulse is off. Send /pulse <niche> to turn the reminder back on. Nothing is sent on a schedule.';
      }
      if (existing) {
        await markPulseSent(env, accountId).catch(() => undefined);
        return formatNichePulseMessage({ niche: existing.niche, tip: existing.lastTip });
      }
    }
    return 'Send /pulse <niche> to store a reminder, or open Idea Scout. Nothing is sent on a schedule.';
  }

  if (accountId && env.DB) {
    const existing = await loadNichePulse(env, accountId).catch(() => null);
    await saveNichePulse(env, { accountId, niche: rest, tip: existing?.lastTip || null, enabled: true });
    await markPulseSent(env, accountId).catch(() => undefined);
    const saved = await loadNichePulse(env, accountId).catch(() => null);
    return formatNichePulseMessage({ niche: saved?.niche || rest, tip: saved?.lastTip || null });
  }
  return formatNichePulseMessage({ niche: rest, tip: null });
}
