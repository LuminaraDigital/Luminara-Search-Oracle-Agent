/**
 * Module C: Consent-Guarded Recovery Campaign Service
 *
 * Enforces Australian statutory outreach rules in deterministic code before any outbound message:
 * 1. Australian Spam Act 2003:
 *    - Requires verified consent (`express` or `inferred_enquiry`); blocks `unsubscribed` or `suppressed`.
 *    - Injects mandatory sender identification (agency trading name + contact details).
 *    - Injects a functional instant opt-out mechanism (`Reply STOP` or unsubscribe link).
 * 2. Do Not Call Register Act 2006 (DNCR) & Telemarketing Standards:
 *    - Blocks voice callbacks to numbers marked `registered` on the DNCR.
 *    - Enforces local state timezone calling/messaging windows (9am-8pm weekdays, 9am-5pm Saturdays,
 *      blocked on Sundays).
 * 3. Stop-on-Reply & Human Takeover:
 *    - Immediately halts if `enquiries.automation_paused = 1` or the prospect has replied.
 */

import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { safeJsonParse } from '../services/llm/safeJsonParse';
import { checkOrRecordExternalEffect, finalizeExternalEffect } from './externalEffectsService';

export type RecoveryChannel = 'email' | 'sms' | 'whatsapp' | 'voice';

const VALID_RECOVERY_CHANNELS = new Set<RecoveryChannel>(['email', 'sms', 'whatsapp', 'voice']);

export interface RecoveryComplianceInput {
  channel: RecoveryChannel;
  consentStatus: string;
  dncrStatus: string;
  automationPaused: boolean;
  stateTimezone: string;
  agencyLegalName: string;
  agencyContactDetails: string;
  unsubscribeUrl?: string;
  nowMs?: number;
}

export type RecoveryComplianceResult =
  | {
      allowed: true;
      localHour: number;
      localWeekday: string;
    }
  | {
      allowed: false;
      code:
        | 'AUTOMATION_PAUSED'
        | 'UNSUBSCRIBED_OR_SUPPRESSED'
        | 'MISSING_CONSENT'
        | 'DNCR_REGISTERED'
        | 'QUIET_HOURS_BLOCKED'
        | 'MISSING_SENDER_ID';
      reason: string;
    };

const ALLOWED_CONSENT_STATES = new Set(['express', 'inferred_enquiry']);

function getLocalDayAndHour(nowMs: number, timeZone: string): { weekday: string; hour: number } {
  const safeTz = timeZone?.trim() || 'Australia/Sydney';
  try {
    const formatter = new Intl.DateTimeFormat('en-AU', {
      timeZone: safeTz,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date(nowMs));
    const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Mon';
    const hourRaw = Number(parts.find((p) => p.type === 'hour')?.value ?? 12);
    const hour = Number.isFinite(hourRaw) ? hourRaw % 24 : 12;
    return { weekday, hour };
  } catch {
    const d = new Date(nowMs);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return { weekday: days[d.getUTCDay()] || 'Mon', hour: d.getUTCHours() };
  }
}

/**
 * Deterministic pre-flight compliance gate for Australian Spam Act 2003 & DNCR Act 2006.
 */
export function evaluateRecoveryComplianceGate(
  input: RecoveryComplianceInput,
): RecoveryComplianceResult {
  if (input.automationPaused) {
    return {
      allowed: false,
      code: 'AUTOMATION_PAUSED',
      reason: 'Automated follow-up is paused because the prospect replied or an agent took over.',
    };
  }

  const consent = (input.consentStatus || '').trim().toLowerCase();
  if (consent === 'unsubscribed' || consent === 'suppressed') {
    return {
      allowed: false,
      code: 'UNSUBSCRIBED_OR_SUPPRESSED',
      reason: `Contact consentStatus is "${consent}". Outbound messaging is permanently blocked.`,
    };
  }

  if (!ALLOWED_CONSENT_STATES.has(consent)) {
    return {
      allowed: false,
      code: 'MISSING_CONSENT',
      reason: `Valid express or inferred_enquiry consent is required under the Spam Act 2003 (got "${consent || 'none'}").`,
    };
  }

  if (input.channel === 'voice' && (input.dncrStatus || '').toLowerCase() === 'registered') {
    return {
      allowed: false,
      code: 'DNCR_REGISTERED',
      reason: 'Phone number is registered on the Australian Do Not Call Register (DNCR).',
    };
  }

  if (!input.agencyLegalName?.trim() || !input.agencyContactDetails?.trim()) {
    return {
      allowed: false,
      code: 'MISSING_SENDER_ID',
      reason: 'Spam Act 2003 requires clear sender identification (agencyLegalName and agencyContactDetails).',
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const { weekday, hour } = getLocalDayAndHour(nowMs, input.stateTimezone);

  if (weekday === 'Sun') {
    return {
      allowed: false,
      code: 'QUIET_HOURS_BLOCKED',
      reason: `Outbound recovery is blocked on Sundays in ${input.stateTimezone}.`,
    };
  }

  if (weekday === 'Sat' && (hour < 9 || hour >= 17)) {
    return {
      allowed: false,
      code: 'QUIET_HOURS_BLOCKED',
      reason: `Saturday outbound window in ${input.stateTimezone} is 09:00-17:00 local time (current hour: ${hour}:00).`,
    };
  }

  if (hour < 9 || hour >= 20) {
    return {
      allowed: false,
      code: 'QUIET_HOURS_BLOCKED',
      reason: `Weekday outbound window in ${input.stateTimezone} is 09:00-20:00 local time (current hour: ${hour}:00).`,
    };
  }

  return {
    allowed: true,
    localHour: hour,
    localWeekday: weekday,
  };
}

/**
 * Formats an outbound recovery message with mandatory Australian Spam Act 2003 sender ID
 * and functional opt-out instructions.
 */
export function composeCompliantRecoveryMessage(args: {
  bodyText: string;
  agencyLegalName: string;
  agencyContactDetails: string;
  channel: RecoveryChannel;
  unsubscribeUrl?: string;
}): string {
  const cleanBody = args.bodyText.trim();
  const senderIdLine = `${args.agencyLegalName.trim()} | ${args.agencyContactDetails.trim()}`;
  const optOutLine = args.unsubscribeUrl?.trim()
    ? `Reply STOP to opt out or unsubscribe at ${args.unsubscribeUrl.trim()}`
    : 'Reply STOP at any time to opt out of future messages.';

  return `${cleanBody}\n\n--\n${senderIdLine}\n${optOutLine}`;
}

export async function executeRecoveryStep(
  env: Env,
  args: {
    accountId: string;
    projectId: string;
    enquiryId: string;
    playbookId: string;
    stepIndex: number;
    channel: RecoveryChannel;
    messageBody: string;
    agencyLegalName: string;
    agencyContactDetails: string;
    unsubscribeUrl?: string;
    nowMs?: number;
  },
): Promise<
  | {
      ok: true;
      duplicate: boolean;
      effectKey: string;
      formattedMessage: string;
      runId: string;
    }
  | {
      ok: false;
      code: string;
      error: string;
      status: number;
    }
> {
  if (!env.DB) {
    return { ok: false, code: 'DB_UNAVAILABLE', error: 'Database unavailable', status: 503 };
  }

  const row = await env.DB.prepare(
    `SELECT e.id as enquiry_id, e.contact_id, e.automation_paused,
            c.consent_status, c.dncr_status, c.state_timezone
     FROM enquiries e
     INNER JOIN crm_contacts c ON c.id = e.contact_id AND c.account_id = e.account_id
     WHERE e.id = ? AND e.account_id = ? AND e.project_id = ?`,
  )
    .bind(args.enquiryId, args.accountId, args.projectId)
    .first<{
      enquiry_id: string;
      contact_id: string;
      automation_paused: number;
      consent_status: string;
      dncr_status: string;
      state_timezone: string;
    }>();

  if (!row) {
    return { ok: false, code: 'ENQUIRY_NOT_FOUND', error: 'Enquiry or contact not found', status: 404 };
  }

  const nowMs = args.nowMs ?? Date.now();
  const gate = evaluateRecoveryComplianceGate({
    channel: args.channel,
    consentStatus: row.consent_status,
    dncrStatus: row.dncr_status,
    automationPaused: Boolean(row.automation_paused),
    stateTimezone: row.state_timezone || 'Australia/Sydney',
    agencyLegalName: args.agencyLegalName,
    agencyContactDetails: args.agencyContactDetails,
    unsubscribeUrl: args.unsubscribeUrl,
    nowMs,
  });

  if (!gate.allowed) {
    return {
      ok: false,
      code: gate.code,
      error: gate.reason,
      status: 422,
    };
  }

  const formattedMessage = composeCompliantRecoveryMessage({
    bodyText: args.messageBody,
    agencyLegalName: args.agencyLegalName,
    agencyContactDetails: args.agencyContactDetails,
    channel: args.channel,
    unsubscribeUrl: args.unsubscribeUrl,
  });

  const effectCheck = await checkOrRecordExternalEffect<{
    formattedMessage: string;
    runId: string;
  }>(env, {
    accountId: args.accountId,
    projectId: args.projectId,
    targetSystem: 'recovery_campaign',
    actionKind: `send_step_${args.stepIndex}`,
    payload: {
      enquiryId: args.enquiryId,
      playbookId: args.playbookId,
      stepIndex: args.stepIndex,
      channel: args.channel,
    },
    now: nowMs,
  });

  if (effectCheck.duplicate && effectCheck.cachedResult) {
    return {
      ok: true,
      duplicate: true,
      effectKey: effectCheck.effectKey,
      formattedMessage: effectCheck.cachedResult.formattedMessage,
      runId: effectCheck.cachedResult.runId,
    };
  }

  const runId = `rec_${args.accountId}_${args.enquiryId}_${args.playbookId}`;
  const existingRun = await env.DB.prepare(
    `SELECT run_history_json FROM recovery_runs WHERE id = ? AND account_id = ?`,
  )
    .bind(runId, args.accountId)
    .first<{ run_history_json: string | null }>();
  const priorHistory = existingRun?.run_history_json
    ? safeJsonParse<Array<Record<string, unknown>>>(existingRun.run_history_json, [])
    : [];
  const clampedStepIndex = Math.min(Math.max(0, Math.trunc(args.stepIndex)), 2);
  const historyEntry = {
    stepIndex: clampedStepIndex,
    channel: args.channel,
    agencyLegalName: args.agencyLegalName.trim(),
    agencyContactDetails: args.agencyContactDetails.trim(),
    effectKey: effectCheck.effectKey,
    sentAt: nowMs,
  };
  const updatedHistoryJson = JSON.stringify([...priorHistory, historyEntry]);

  await env.DB.prepare(
    `INSERT INTO recovery_runs (
      id, account_id, project_id, enquiry_id, contact_id, playbook_id,
      status, step_index, last_effect_key, next_wake_at, run_history_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = 'active',
      stop_reason = NULL,
      step_index = excluded.step_index,
      last_effect_key = excluded.last_effect_key,
      next_wake_at = excluded.next_wake_at,
      run_history_json = excluded.run_history_json,
      updated_at = excluded.updated_at`,
  )
    .bind(
      runId,
      args.accountId,
      args.projectId,
      args.enquiryId,
      row.contact_id,
      args.playbookId,
      clampedStepIndex,
      effectCheck.effectKey,
      nowMs + 24 * 3600_000,
      updatedHistoryJson,
      nowMs,
      nowMs,
    )
    .run();

  await finalizeExternalEffect(
    env,
    effectCheck.effectKey,
    args.accountId,
    { formattedMessage, runId },
    nowMs,
  );

  return {
    ok: true,
    duplicate: false,
    effectKey: effectCheck.effectKey,
    formattedMessage,
    runId,
  };
}

/**
 * Scheduled deterministic `no-agent` recovery sweep (0 LLM tokens).
 * Evaluates due active `recovery_runs` rows against Australian Spam Act 2003,
 * DNCR, state timezone quiet-hours, and prospect reply/takeover pause gates.
 */
export async function sweepDueRecoveryRuns(
  env: Env,
  opts?: { nowMs?: number; limit?: number },
): Promise<{ evaluated: number; advanced: number; pausedOrCompleted: number }> {
  if (!env.DB) return { evaluated: 0, advanced: 0, pausedOrCompleted: 0 };
  const nowMs = opts?.nowMs ?? Date.now();
  const limit = Math.min(Math.max(1, opts?.limit ?? 50), 200);

  let rows: Array<{
    run_id: string;
    account_id: string;
    project_id: string;
    enquiry_id: string;
    step_index: number;
    run_history_json: string | null;
    automation_paused: number;
    enquiry_status: string;
    consent_status: string;
    dncr_status: string;
    state_timezone: string | null;
    preferred_channel: string | null;
  }> = [];

  try {
    const res = await env.DB.prepare(
      `SELECT r.id AS run_id, r.account_id, r.project_id, r.enquiry_id, r.step_index, r.run_history_json,
              e.automation_paused, e.status AS enquiry_status,
              c.consent_status, c.dncr_status, c.state_timezone, c.preferred_channel
       FROM recovery_runs r
       JOIN enquiries e ON e.id = r.enquiry_id AND e.account_id = r.account_id
       JOIN crm_contacts c ON c.id = r.contact_id AND c.account_id = r.account_id
       WHERE r.status = 'active' AND r.next_wake_at <= ?
       ORDER BY r.next_wake_at ASC
       LIMIT ?`,
    )
      .bind(nowMs, limit)
      .all<(typeof rows)[number]>();
    rows = res.results || [];
  } catch {
    return { evaluated: 0, advanced: 0, pausedOrCompleted: 0 };
  }

  let advanced = 0;
  let pausedOrCompleted = 0;

  for (const row of rows) {
    if (
      Boolean(row.automation_paused) ||
      row.enquiry_status === 'booked' ||
      row.enquiry_status === 'closed' ||
      row.consent_status === 'unsubscribed' ||
      row.consent_status === 'suppressed'
    ) {
      await env.DB.prepare(
        `UPDATE recovery_runs
         SET status = 'paused_by_compliance',
             stop_reason = ?,
             updated_at = ?
         WHERE id = ? AND account_id = ?`,
      )
        .bind(
          row.consent_status === 'unsubscribed' || row.consent_status === 'suppressed'
            ? `Consent status is ${row.consent_status}`
            : 'Enquiry automation paused or already booked/closed',
          nowMs,
          row.run_id,
          row.account_id,
        )
        .run();
      pausedOrCompleted += 1;
      continue;
    }

    if (row.step_index >= 2) {
      await env.DB.prepare(
        `UPDATE recovery_runs
         SET status = 'completed',
             stop_reason = 'Max 3 recovery steps completed',
             updated_at = ?
         WHERE id = ? AND account_id = ?`,
      )
        .bind(nowMs, row.run_id, row.account_id)
        .run();
      pausedOrCompleted += 1;
      continue;
    }

    const history = row.run_history_json
      ? safeJsonParse<Array<Record<string, unknown>>>(row.run_history_json, [])
      : [];
    const lastEntry = history[history.length - 1] ?? {};
    const rawChannel = String(lastEntry.channel || row.preferred_channel || 'sms');
    const resolvedChannel: RecoveryChannel =
      rawChannel === 'email' || rawChannel === 'voice' || rawChannel === 'whatsapp' ? rawChannel : 'sms';
    const agencyLegalName =
      typeof lastEntry.agencyLegalName === 'string' && lastEntry.agencyLegalName.trim()
        ? lastEntry.agencyLegalName.trim()
        : 'Luminara Partner Agency';
    const agencyContactDetails =
      typeof lastEntry.agencyContactDetails === 'string' && lastEntry.agencyContactDetails.trim()
        ? lastEntry.agencyContactDetails.trim()
        : 'Subscribed Enquiry Desk';

    const windowCheck = evaluateRecoveryComplianceGate({
      channel: resolvedChannel,
      consentStatus: row.consent_status,
      dncrStatus: row.dncr_status,
      automationPaused: false,
      stateTimezone: row.state_timezone || 'Australia/Sydney',
      agencyLegalName,
      agencyContactDetails,
      nowMs,
    });
    if (!windowCheck.allowed) {
      if (windowCheck.code === 'QUIET_HOURS_BLOCKED') {
        await env.DB.prepare(
          `UPDATE recovery_runs SET next_wake_at = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
        )
          .bind(nowMs + 4 * 3600_000, nowMs, row.run_id, row.account_id)
          .run();
      } else {
        await env.DB.prepare(
          `UPDATE recovery_runs
           SET status = 'paused_by_compliance',
               stop_reason = ?,
               updated_at = ?
           WHERE id = ? AND account_id = ?`,
        )
          .bind(windowCheck.reason, nowMs, row.run_id, row.account_id)
          .run();
        pausedOrCompleted += 1;
      }
      continue;
    }

    await env.DB.prepare(
      `UPDATE recovery_runs
       SET step_index = step_index + 1,
           next_wake_at = ?,
           updated_at = ?
       WHERE id = ? AND account_id = ? AND status = 'active' AND step_index < 2`,
    )
      .bind(nowMs + 24 * 3600_000, nowMs, row.run_id, row.account_id)
      .run();
    advanced += 1;
  }

  return { evaluated: rows.length, advanced, pausedOrCompleted };
}

export async function handleRecoveryRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith('/recovery')) return null;
  const accountId = billingId(user);
  const url = new URL(request.url);

  if (path === '/recovery/runs' && request.method === 'GET') {
    const projectId = (url.searchParams.get('projectId') || 'default').trim();
    if (!env.DB) return json({ ok: true, projectId, runs: [] });
    const rows = await env.DB.prepare(
      `SELECT id, project_id, enquiry_id, contact_id, playbook_id, status, step_index,
              last_effect_key, next_wake_at, stop_reason, run_history_json, created_at, updated_at
       FROM recovery_runs
       WHERE account_id = ? AND project_id = ?
       ORDER BY updated_at DESC
       LIMIT 100`,
    )
      .bind(accountId, projectId)
      .all<Record<string, unknown>>();
    return json({ ok: true, projectId, runs: rows.results || [] });
  }

  if (path === '/recovery/evaluate' && request.method === 'POST') {
    const parsed = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    const body = parsed.value as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'Invalid JSON body' }, 400);
    const rawChannel = String(body.channel || 'sms').trim().toLowerCase() as RecoveryChannel;
    if (!VALID_RECOVERY_CHANNELS.has(rawChannel)) {
      return json({ ok: false, error: 'Invalid channel. Expected email, sms, whatsapp, or voice.' }, 400);
    }
    const gate = evaluateRecoveryComplianceGate({
      channel: rawChannel,
      consentStatus: String(body.consentStatus || 'unknown'),
      dncrStatus: String(body.dncrStatus || 'unknown'),
      automationPaused: Boolean(body.automationPaused),
      stateTimezone: String(body.stateTimezone || 'Australia/Sydney'),
      agencyLegalName: String(body.agencyLegalName || ''),
      agencyContactDetails: String(body.agencyContactDetails || ''),
      unsubscribeUrl: typeof body.unsubscribeUrl === 'string' ? body.unsubscribeUrl : undefined,
    });
    return json({ ok: true, gate });
  }

  if (path === '/recovery/send-step' && request.method === 'POST') {
    const parsed = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    const body = parsed.value as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'Invalid JSON body' }, 400);

    const rawChannel = String(body.channel || 'email').trim().toLowerCase() as RecoveryChannel;
    if (!VALID_RECOVERY_CHANNELS.has(rawChannel)) {
      return json(
        { ok: false, error: 'Invalid channel. Expected email, sms, whatsapp, or voice.' },
        400,
      );
    }

    const res = await executeRecoveryStep(env, {
      accountId,
      projectId: String(body.projectId || 'default'),
      enquiryId: String(body.enquiryId || ''),
      playbookId: String(body.playbookId || 'seller_reengagement'),
      stepIndex: Number(body.stepIndex ?? 0),
      channel: rawChannel,
      messageBody: String(body.messageBody || ''),
      agencyLegalName: String(body.agencyLegalName || ''),
      agencyContactDetails: String(body.agencyContactDetails || ''),
      unsubscribeUrl: typeof body.unsubscribeUrl === 'string' ? body.unsubscribeUrl : undefined,
    });

    if (!res.ok) return json({ ok: false, code: res.code, error: res.error }, res.status);
    return json(res);
  }

  return json({ error: 'Method not allowed' }, 405);
}
