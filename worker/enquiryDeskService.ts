/**
 * Module B: Enquiry Desk & Conversion Spine Service
 *
 * Implements:
 * 1. Rakazo-style ExternalEffect idempotency (via `./externalEffectsService`).
 * 2. Distinct Contact, Property, and Enquiry persistence in Cloudflare D1 (migration 0042).
 * 3. Deterministic SLA timer calculation and auto-pause on prospect reply or human agent takeover.
 * 4. Evidence-Bound Opportunity Brief generation, 6-Stage Outcomes Ledger recording, and Twenty CRM sync.
 */

import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { safeJsonParse } from '../services/llm/safeJsonParse';
import {
  APPROVED_PLAYBOOKS,
  buildOpportunityBrief,
  evaluateInboundEnquiryTurn,
  type ConversationMessage,
  type EnquiryIntentType,
  type EnquirySourceChannel,
  type EnquiryStatus,
  type OpportunityBrief,
  type OutcomeEvidenceType,
  type OutcomeStage,
} from '../services/enquiries/playbookQualificationService';
import {
  getProjectConversionFunnelSummary,
  recordOutcomeStageEvent,
} from './outcomesLedgerService';
import {
  createBookingProposal,
  decideBookingAppointment,
  listProjectAppointments,
  type ProposedBookingSlot,
} from './bookingApprovalService';
import {
  splitFullName,
  syncContactToTwenty,
  syncOpportunityToTwenty,
} from './crmConnectors/twentyAdapter';
import {
  checkOrRecordExternalEffect,
  finalizeExternalEffect,
} from './externalEffectsService';

export interface EnquiryRecord {
  id: string;
  accountId: string;
  projectId: string;
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  consentStatus: string;
  propertyId: string | null;
  propertyAddress: string | null;
  sourceChannel: EnquirySourceChannel;
  intentType: EnquiryIntentType;
  status: EnquiryStatus;
  assignedAgentId: string | null;
  slaDueAt: number;
  automationPaused: boolean;
  qualificationBrief: OpportunityBrief;
  conversation: ConversationMessage[];
  attributionAuditId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface EnquiryRow {
  id: string;
  account_id: string;
  project_id: string;
  contact_id: string;
  property_id: string | null;
  source_channel: EnquirySourceChannel;
  intent_type: EnquiryIntentType;
  status: EnquiryStatus;
  assigned_agent_id: string | null;
  sla_due_at: number;
  automation_paused: number;
  qualification_brief_json: string;
  conversation_json: string;
  attribution_audit_id: string | null;
  created_at: number;
  updated_at: number;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  consent_status: string | null;
  property_address: string | null;
}

const VALID_INTENTS = new Set<EnquiryIntentType>([
  'seller_appraisal',
  'buyer_enquiry',
  'landlord_management',
  'general_sme',
]);

const VALID_CHANNELS = new Set<EnquirySourceChannel>([
  'web_widget',
  'form_webhook',
  'missed_call',
  'meta_lead',
  'portal_email',
  'manual',
]);

async function recordQualificationOutcomeIfReady(
  env: Env,
  args: {
    accountId: string;
    projectId: string;
    enquiryId: string;
    brief: OpportunityBrief;
    now: number;
  },
): Promise<void> {
  if (!args.brief.qualified) return;
  await recordOutcomeStageEvent(env, {
    accountId: args.accountId,
    projectId: args.projectId,
    enquiryId: args.enquiryId,
    stage: 'qualified_opportunity',
    evidenceType: 'qualification_brief_id',
    evidenceRef: `brief:${args.enquiryId}`,
    notes: args.brief.summaryVerdict,
    recordedBy: 'system:playbook_qualifier',
    now: args.now,
  });
}

export async function ingestInboundEnquiry(
  env: Env,
  args: {
    accountId: string;
    projectId: string;
    fullName: string;
    email?: string;
    phoneE164?: string;
    preferredChannel?: string;
    stateTimezone?: string;
    propertyAddress?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
    propertyType?: string;
    sourceChannel?: EnquirySourceChannel;
    intentType?: EnquiryIntentType;
    assignedAgentId?: string;
    initialMessage: string;
    initialAnswers?: Record<string, string>;
    attributionAuditId?: string;
    agencyName?: string;
    clientIdempotencyNonce?: string;
    now?: number;
  },
): Promise<
  | {
      ok: true;
      duplicate: boolean;
      effectKey: string;
      enquiry: EnquiryRecord;
      evaluation: ReturnType<typeof evaluateInboundEnquiryTurn>;
    }
  | { ok: false; error: string; status: number }
> {
  if (!env.DB) {
    return { ok: false, error: 'Database unavailable', status: 503 };
  }

  const projectId = String(args.projectId || '').trim();
  const fullName = String(args.fullName || '').trim().slice(0, 200);
  const initialMessage = String(args.initialMessage || '').trim().slice(0, 4000);

  if (!projectId || !fullName || !initialMessage) {
    return {
      ok: false,
      error: 'projectId, fullName, and initialMessage are required to ingest an enquiry.',
      status: 400,
    };
  }

  const intentType: EnquiryIntentType = VALID_INTENTS.has(args.intentType as EnquiryIntentType)
    ? (args.intentType as EnquiryIntentType)
    : 'seller_appraisal';

  const sourceChannel: EnquirySourceChannel = VALID_CHANNELS.has(args.sourceChannel as EnquirySourceChannel)
    ? (args.sourceChannel as EnquirySourceChannel)
    : 'web_widget';

  const now = args.now ?? Date.now();
  const effectCheck = await checkOrRecordExternalEffect<{
    enquiry: EnquiryRecord;
    evaluation: ReturnType<typeof evaluateInboundEnquiryTurn>;
  }>(env, {
    accountId: args.accountId,
    projectId,
    targetSystem: 'enquiry_desk',
    actionKind: 'ingest_enquiry',
    payload: {
      fullName,
      email: args.email || '',
      phoneE164: args.phoneE164 || '',
      propertyAddress: args.propertyAddress || '',
      intentType,
      initialMessage,
      nonce: args.clientIdempotencyNonce || '',
    },
    now,
  });

  if (effectCheck.duplicate && effectCheck.cachedResult) {
    return {
      ok: true,
      duplicate: true,
      effectKey: effectCheck.effectKey,
      enquiry: effectCheck.cachedResult.enquiry,
      evaluation: effectCheck.cachedResult.evaluation,
    };
  }

  const contactId = `cnt_${effectCheck.effectKey.slice(4, 20)}`;
  const email = args.email?.trim() ? args.email.trim().toLowerCase() : null;
  const phoneE164 = args.phoneE164?.trim() ? args.phoneE164.trim() : null;
  const preferredChannel = args.preferredChannel?.trim() || (phoneE164 ? 'sms' : 'email');
  const stateTimezone = args.stateTimezone?.trim() || 'Australia/Sydney';

  const seededAnswers: Record<string, string> = { ...(args.initialAnswers || {}) };
  if (args.propertyAddress?.trim()) seededAnswers.property_address = args.propertyAddress.trim();
  if (args.propertyType?.trim()) seededAnswers.property_type = args.propertyType.trim();

  const evaluation = evaluateInboundEnquiryTurn({
    intentType,
    inboundText: initialMessage,
    recordedAnswers: seededAnswers,
    agencyName: args.agencyName,
  });

  const consentStatus = evaluation.action === 'instant_unsubscribe' ? 'unsubscribed' : 'inferred_enquiry';

  await env.DB.prepare(
    `INSERT INTO crm_contacts (
      id, account_id, project_id, full_name, email, phone_e164, preferred_channel,
      consent_status, consent_source, consent_recorded_at, dncr_status, state_timezone, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      full_name = excluded.full_name,
      email = COALESCE(excluded.email, crm_contacts.email),
      phone_e164 = COALESCE(excluded.phone_e164, crm_contacts.phone_e164),
      consent_status = excluded.consent_status,
      updated_at = excluded.updated_at`,
  )
    .bind(contactId, args.accountId, projectId, fullName, email, phoneE164, preferredChannel, consentStatus, sourceChannel, now, stateTimezone, now, now)
    .run();

  let propertyId: string | null = null;
  const propertyAddress = args.propertyAddress?.trim() || null;
  if (propertyAddress) {
    propertyId = `prp_${effectCheck.effectKey.slice(4, 20)}`;
    await env.DB.prepare(
      `INSERT INTO crm_properties (
        id, account_id, project_id, address_full, suburb, state, postcode, property_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET address_full = excluded.address_full, updated_at = excluded.updated_at`,
    )
      .bind(propertyId, args.accountId, projectId, propertyAddress, args.suburb?.trim() || '', args.state?.trim() || '', args.postcode?.trim() || '', args.propertyType?.trim() || 'residential', now, now)
      .run();

    const role = intentType === 'buyer_enquiry' ? 'buyer' : intentType === 'landlord_management' ? 'landlord' : 'owner';
    await env.DB.prepare(
      `INSERT INTO contact_property_links (
        id, account_id, project_id, contact_id, property_id, relationship_role, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, contact_id, property_id, relationship_role) DO NOTHING`,
    )
      .bind(`cpl_${contactId}_${propertyId}`, args.accountId, projectId, contactId, propertyId, role, now)
      .run();
  }

  const enquiryId = `enq_${effectCheck.effectKey.slice(4, 20)}`;
  const msg1Id = `msg_${enquiryId}_1`;
  const conversation: ConversationMessage[] = [
    { id: msg1Id, sender: 'prospect', text: initialMessage, timestamp: now },
    { id: `msg_${enquiryId}_2`, sender: 'assistant', text: evaluation.suggestedReply, timestamp: now + 1 },
  ];

  const mappedAnswers: Record<string, { value?: string; messageId?: string }> = {};
  for (const [k, v] of Object.entries(seededAnswers)) {
    if (v && v.trim()) mappedAnswers[k] = { value: v.trim(), messageId: msg1Id };
  }

  const brief = buildOpportunityBrief({
    intentType,
    answers: mappedAnswers,
    escalationReason:
      evaluation.action === 'escalate_to_agent' || evaluation.action === 'instant_unsubscribe'
        ? evaluation.reason
        : undefined,
  });

  const playbook = APPROVED_PLAYBOOKS[intentType] ?? APPROVED_PLAYBOOKS.general_sme;
  const slaDueAt = now + playbook.defaultSlaMinutes * 60_000;
  const automationPaused = evaluation.automationPaused;
  const status: EnquiryStatus =
    evaluation.action === 'instant_unsubscribe' ? 'closed' : brief.qualified ? 'qualified' : 'conversing';

  await env.DB.prepare(
    `INSERT INTO enquiries (
      id, account_id, project_id, contact_id, property_id, source_channel, intent_type,
      status, assigned_agent_id, sla_due_at, automation_paused,
      qualification_brief_json, conversation_json, attribution_audit_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      automation_paused = excluded.automation_paused,
      qualification_brief_json = excluded.qualification_brief_json,
      conversation_json = excluded.conversation_json,
      updated_at = excluded.updated_at`,
  )
    .bind(
      enquiryId, args.accountId, projectId, contactId, propertyId, sourceChannel, intentType,
      status, args.assignedAgentId?.trim() || null, slaDueAt, automationPaused ? 1 : 0,
      JSON.stringify(brief), JSON.stringify(conversation), args.attributionAuditId?.trim() || null, now, now,
    )
    .run();

  await recordOutcomeStageEvent(env, {
    accountId: args.accountId, projectId, enquiryId, stage: 'enquiry_received',
    evidenceType: 'webhook_payload', evidenceRef: effectCheck.effectKey,
    notes: `Inbound ${sourceChannel} enquiry (${intentType})`, recordedBy: 'system:enquiry_desk', now,
  });

  await recordQualificationOutcomeIfReady(env, { accountId: args.accountId, projectId, enquiryId, brief, now });

  const enquiryRecord: EnquiryRecord = {
    id: enquiryId, accountId: args.accountId, projectId, contactId,
    contactName: fullName, contactEmail: email, contactPhone: phoneE164, consentStatus,
    propertyId, propertyAddress, sourceChannel, intentType, status,
    assignedAgentId: args.assignedAgentId?.trim() || null, slaDueAt, automationPaused,
    qualificationBrief: brief, conversation,
    attributionAuditId: args.attributionAuditId?.trim() || null, createdAt: now, updatedAt: now,
  };

  await finalizeExternalEffect(env, effectCheck.effectKey, args.accountId, { enquiry: enquiryRecord, evaluation }, now);
  return { ok: true, duplicate: false, effectKey: effectCheck.effectKey, enquiry: enquiryRecord, evaluation };
}

export async function appendEnquiryTurn(
  env: Env,
  args: {
    accountId: string;
    enquiryId: string;
    sender: 'prospect' | 'agent';
    text: string;
    extractedAnswers?: Record<string, string>;
    actorUserId: string;
    agencyName?: string;
    now?: number;
  },
): Promise<
  | {
      ok: true;
      enquiry: EnquiryRecord;
      evaluation?: ReturnType<typeof evaluateInboundEnquiryTurn>;
    }
  | { ok: false; error: string; status: number }
> {
  if (!env.DB) {
    return { ok: false, error: 'Database unavailable', status: 503 };
  }

  const existing = await getEnquiryById(env, args.accountId, args.enquiryId);
  if (!existing) {
    return { ok: false, error: 'Enquiry not found', status: 404 };
  }

  const text = String(args.text || '').trim().slice(0, 4000);
  if (!text) {
    return { ok: false, error: 'Message text is required', status: 400 };
  }

  const now = args.now ?? Date.now();
  const msgId = `msg_${existing.id}_${existing.conversation.length + 1}`;
  const conversation: ConversationMessage[] = [
    ...existing.conversation,
    { id: msgId, sender: args.sender, text, timestamp: now },
  ];

  if (args.sender === 'agent') {
    await env.DB.prepare(
      `UPDATE recovery_runs
       SET status = 'paused_by_agent', stop_reason = 'Agent replied directly', updated_at = ?
       WHERE enquiry_id = ? AND account_id = ? AND status = 'active'`,
    )
      .bind(now, existing.id, args.accountId)
      .run();

    await env.DB.prepare(
      `UPDATE enquiries
       SET conversation_json = ?, automation_paused = 1, updated_at = ?
       WHERE id = ? AND account_id = ?`,
    )
      .bind(JSON.stringify(conversation), now, existing.id, args.accountId)
      .run();

    return {
      ok: true,
      enquiry: {
        ...existing,
        automationPaused: true,
        conversation,
        updatedAt: now,
      },
    };
  }

  await env.DB.prepare(
    `UPDATE recovery_runs
     SET status = 'paused_on_reply', stop_reason = 'Prospect replied to conversation', updated_at = ?
     WHERE enquiry_id = ? AND account_id = ? AND status = 'active'`,
  )
    .bind(now, existing.id, args.accountId)
    .run();

  const mergedAnswers: Record<string, { value?: string; messageId?: string }> = {};
  for (const [k, v] of Object.entries(existing.qualificationBrief.recordedAnswers || {})) {
    if (v.status === 'measured' && v.value !== 'unknown') {
      mergedAnswers[k] = { value: v.value, messageId: v.messageId };
    }
  }
  for (const [k, v] of Object.entries(args.extractedAnswers || {})) {
    if (v && v.trim()) mergedAnswers[k] = { value: v.trim(), messageId: msgId };
  }

  const flatAnswers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(mergedAnswers)) flatAnswers[k] = v.value;

  const evaluation = evaluateInboundEnquiryTurn({
    intentType: existing.intentType,
    inboundText: text,
    recordedAnswers: flatAnswers,
    agencyName: args.agencyName,
  });

  if (evaluation.action === 'instant_unsubscribe') {
    await env.DB.prepare(
      `UPDATE crm_contacts SET consent_status = 'unsubscribed', updated_at = ? WHERE id = ? AND account_id = ?`,
    )
      .bind(now, existing.contactId, args.accountId)
      .run();
  }

  const automationPaused = existing.automationPaused || evaluation.automationPaused;
  if (!automationPaused) {
    conversation.push({
      id: `msg_${existing.id}_${conversation.length + 1}`,
      sender: 'assistant',
      text: evaluation.suggestedReply,
      timestamp: now + 1,
    });
  }

  const brief = buildOpportunityBrief({
    intentType: existing.intentType,
    answers: mergedAnswers,
    escalationReason:
      evaluation.action === 'escalate_to_agent' || evaluation.action === 'instant_unsubscribe'
        ? evaluation.reason
        : existing.qualificationBrief.escalationReason,
  });

  const nextStatus: EnquiryStatus =
    evaluation.action === 'instant_unsubscribe'
      ? 'closed'
      : brief.qualified && existing.status === 'conversing'
        ? 'qualified'
        : existing.status;

  await env.DB.prepare(
    `UPDATE enquiries
     SET status = ?, automation_paused = ?, qualification_brief_json = ?, conversation_json = ?, updated_at = ?
     WHERE id = ? AND account_id = ?`,
  )
    .bind(
      nextStatus,
      automationPaused ? 1 : 0,
      JSON.stringify(brief),
      JSON.stringify(conversation),
      now,
      existing.id,
      args.accountId,
    )
    .run();

  await recordOutcomeStageEvent(env, {
    accountId: args.accountId,
    projectId: existing.projectId,
    enquiryId: existing.id,
    stage: 'two_way_conversation',
    evidenceType: 'message_transcript_id',
    evidenceRef: msgId,
    notes: 'Two-way prospect reply recorded in Enquiry Desk',
    recordedBy: args.actorUserId,
    now,
  });

  await recordQualificationOutcomeIfReady(env, {
    accountId: args.accountId,
    projectId: existing.projectId,
    enquiryId: existing.id,
    brief,
    now,
  });

  return {
    ok: true,
    evaluation,
    enquiry: {
      ...existing,
      consentStatus: evaluation.action === 'instant_unsubscribe' ? 'unsubscribed' : existing.consentStatus,
      status: nextStatus,
      automationPaused,
      qualificationBrief: brief,
      conversation,
      updatedAt: now,
    },
  };
}

export async function setEnquiryTakeover(
  env: Env,
  args: {
    accountId: string;
    enquiryId: string;
    paused: boolean;
    assignedAgentId?: string;
    actorUserId: string;
    now?: number;
  },
): Promise<{ ok: true; enquiry: EnquiryRecord } | { ok: false; error: string; status: number }> {
  if (!env.DB) {
    return { ok: false, error: 'Database unavailable', status: 503 };
  }

  const existing = await getEnquiryById(env, args.accountId, args.enquiryId);
  if (!existing) {
    return { ok: false, error: 'Enquiry not found', status: 404 };
  }

  const now = args.now ?? Date.now();
  const nextAgent = args.assignedAgentId?.trim() || existing.assignedAgentId || args.actorUserId;

  await env.DB.prepare(
    `UPDATE enquiries
     SET automation_paused = ?, assigned_agent_id = ?, updated_at = ?
     WHERE id = ? AND account_id = ?`,
  )
    .bind(args.paused ? 1 : 0, nextAgent, now, existing.id, args.accountId)
    .run();

  if (args.paused) {
    await env.DB.prepare(
      `UPDATE recovery_runs
       SET status = 'paused_by_agent', stop_reason = ?, updated_at = ?
       WHERE enquiry_id = ? AND account_id = ? AND status = 'active'`,
    )
      .bind(`Agent takeover by ${args.actorUserId}`, now, existing.id, args.accountId)
      .run();
  }

  return {
    ok: true,
    enquiry: {
      ...existing,
      automationPaused: args.paused,
      assignedAgentId: nextAgent,
      updatedAt: now,
    },
  };
}

const ENQUIRY_SELECT_SQL = `SELECT e.id, e.account_id, e.project_id, e.contact_id, e.property_id,
  e.source_channel, e.intent_type, e.status, e.assigned_agent_id,
  e.sla_due_at, e.automation_paused, e.qualification_brief_json,
  e.conversation_json, e.attribution_audit_id, e.created_at, e.updated_at,
  c.full_name as contact_name, c.email as contact_email,
  c.phone_e164 as contact_phone, c.consent_status as consent_status,
  p.address_full as property_address
FROM enquiries e
LEFT JOIN crm_contacts c ON c.id = e.contact_id AND c.account_id = e.account_id
LEFT JOIN crm_properties p ON p.id = e.property_id AND p.account_id = e.account_id`;

export async function getEnquiryById(
  env: Env,
  accountId: string,
  enquiryId: string,
): Promise<EnquiryRecord | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`${ENQUIRY_SELECT_SQL} WHERE e.id = ? AND e.account_id = ?`)
    .bind(enquiryId, accountId)
    .first<EnquiryRow>();
  return row ? mapEnquiryRow(row) : null;
}

export async function listProjectEnquiries(
  env: Env,
  accountId: string,
  projectId: string,
): Promise<EnquiryRecord[]> {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(
    `${ENQUIRY_SELECT_SQL} WHERE e.account_id = ? AND e.project_id = ? ORDER BY e.updated_at DESC LIMIT 100`,
  )
    .bind(accountId, projectId)
    .all<EnquiryRow>();
  return (rows.results || []).map(mapEnquiryRow);
}

function mapEnquiryRow(row: EnquiryRow): EnquiryRecord {
  const fallbackBrief = buildOpportunityBrief({
    intentType: row.intent_type || 'seller_appraisal',
    answers: {},
  });
  const qualificationBrief = safeJsonParse<OpportunityBrief>(
    row.qualification_brief_json || '',
    fallbackBrief,
  );
  const conversation = safeJsonParse<ConversationMessage[]>(row.conversation_json || '[]', []);

  return {
    id: row.id,
    accountId: row.account_id,
    projectId: row.project_id,
    contactId: row.contact_id,
    contactName: row.contact_name || 'Unknown Contact',
    contactEmail: row.contact_email ?? null,
    contactPhone: row.contact_phone ?? null,
    consentStatus: row.consent_status || 'inferred_enquiry',
    propertyId: row.property_id ?? null,
    propertyAddress: row.property_address ?? null,
    sourceChannel: row.source_channel || 'web_widget',
    intentType: row.intent_type || 'seller_appraisal',
    status: row.status || 'new',
    assignedAgentId: row.assigned_agent_id ?? null,
    slaDueAt: Number(row.sla_due_at || 0),
    automationPaused: Boolean(row.automation_paused),
    qualificationBrief: qualificationBrief?.playbookName ? qualificationBrief : fallbackBrief,
    conversation: Array.isArray(conversation) ? conversation : [],
    attributionAuditId: row.attribution_audit_id ?? null,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

async function readJsonBody(
  request: Request,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: Response }> {
  const parsed = await readBody(request, MAX_SMALL_BODY_BYTES);
  if (!parsed.ok) return { ok: false, res: json({ ok: false, error: parsed.error }, parsed.status) };
  if (!parsed.value || typeof parsed.value !== 'object') {
    return { ok: false, res: json({ ok: false, error: 'Invalid JSON body' }, 400) };
  }
  return { ok: true, body: parsed.value as Record<string, unknown> };
}

export async function handleEnquiryDeskRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith('/enquiries') && !path.startsWith('/outcomes')) return null;
  const accountId = billingId(user);
  const url = new URL(request.url);

  if (path === '/enquiries' && request.method === 'GET') {
    const projectId = (url.searchParams.get('projectId') || 'default').trim();
    const [enquiries, funnel, appointments] = await Promise.all([
      listProjectEnquiries(env, accountId, projectId),
      getProjectConversionFunnelSummary(env, accountId, projectId),
      listProjectAppointments(env, accountId, projectId),
    ]);
    return json({ ok: true, projectId, enquiries, funnel, appointments, playbooks: Object.values(APPROVED_PLAYBOOKS) });
  }

  if (path === '/enquiries' && request.method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.res;
    const { body } = parsed;
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined);
    const res = await ingestInboundEnquiry(env, {
      accountId,
      projectId: String(body.projectId || 'default'),
      fullName: String(body.fullName || ''),
      email: str('email'),
      phoneE164: str('phoneE164'),
      preferredChannel: str('preferredChannel'),
      stateTimezone: str('stateTimezone'),
      propertyAddress: str('propertyAddress'),
      suburb: str('suburb'),
      state: str('state'),
      postcode: str('postcode'),
      propertyType: str('propertyType'),
      sourceChannel: body.sourceChannel as EnquirySourceChannel | undefined,
      intentType: body.intentType as EnquiryIntentType | undefined,
      assignedAgentId: str('assignedAgentId'),
      initialMessage: String(body.initialMessage || ''),
      initialAnswers:
        body.initialAnswers && typeof body.initialAnswers === 'object'
          ? (body.initialAnswers as Record<string, string>)
          : undefined,
      attributionAuditId: str('attributionAuditId'),
      agencyName: str('agencyName'),
      clientIdempotencyNonce: str('clientIdempotencyNonce'),
    });
    if (!res.ok) return json({ ok: false, error: res.error }, res.status);
    return json(res, res.duplicate ? 200 : 201);
  }

  if (path === '/enquiries/sync-twenty' && request.method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.res;
    const { enquiryId, baseUrl, apiKey } = parsed.body as {
      enquiryId?: string;
      baseUrl?: string;
      apiKey?: string;
    };
    if (!enquiryId || !baseUrl || !apiKey) {
      return json({ ok: false, error: 'enquiryId, baseUrl, and apiKey are required for Twenty CRM sync.' }, 400);
    }
    const existing = await getEnquiryById(env, accountId, enquiryId);
    if (!existing) return json({ ok: false, error: 'Enquiry not found' }, 404);

    const effectCheck = await checkOrRecordExternalEffect<{
      personExternalId: string;
      opportunityExternalId?: string;
    }>(env, {
      accountId,
      projectId: existing.projectId,
      targetSystem: 'twenty_crm',
      actionKind: 'sync_enquiry',
      payload: { enquiryId: existing.id, baseUrl },
    });
    if (effectCheck.duplicate && effectCheck.cachedResult) {
      return json({ ok: true, duplicate: true, effectKey: effectCheck.effectKey, ...effectCheck.cachedResult });
    }

    const { firstName, lastName } = splitFullName(existing.contactName);
    const personRes = await syncContactToTwenty(
      { baseUrl, apiKey },
      {
        luminaraContactId: existing.contactId,
        firstName,
        lastName,
        email: existing.contactEmail,
        phone: existing.contactPhone,
        consentStatus: existing.consentStatus,
      },
    );
    if (!personRes.ok || !personRes.externalId) {
      return json({ ok: false, error: personRes.error || 'Twenty Person sync failed' }, 422);
    }

    const oppRes = await syncOpportunityToTwenty(
      { baseUrl, apiKey },
      {
        luminaraEnquiryId: existing.id,
        name: existing.qualificationBrief.playbookName,
        stage: existing.status.toUpperCase(),
        intentType: existing.intentType,
        propertyAddress: existing.propertyAddress,
        contactExternalId: personRes.externalId,
      },
    );
    if (!oppRes.ok || !oppRes.externalId) {
      return json({ ok: false, error: oppRes.error || 'Twenty Opportunity sync failed' }, 422);
    }

    const syncSummary = { personExternalId: personRes.externalId, opportunityExternalId: oppRes.externalId };
    await finalizeExternalEffect(env, effectCheck.effectKey, accountId, syncSummary);
    return json({ ok: true, duplicate: false, effectKey: effectCheck.effectKey, ...syncSummary });
  }

  const turnMatch = path.match(/^\/enquiries\/([^/]+)\/turn$/);
  if (turnMatch && request.method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.res;
    const { body } = parsed;
    const res = await appendEnquiryTurn(env, {
      accountId,
      enquiryId: decodeURIComponent(turnMatch[1]!),
      sender: body.sender === 'agent' ? 'agent' : 'prospect',
      text: String(body.text || ''),
      extractedAnswers:
        body.extractedAnswers && typeof body.extractedAnswers === 'object'
          ? (body.extractedAnswers as Record<string, string>)
          : undefined,
      actorUserId: user.id,
      agencyName: typeof body.agencyName === 'string' ? body.agencyName : undefined,
    });
    if (!res.ok) return json({ ok: false, error: res.error }, res.status);
    return json(res);
  }

  const takeoverMatch = path.match(/^\/enquiries\/([^/]+)\/takeover$/);
  if (takeoverMatch && request.method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.res;
    const { body } = parsed;
    const res = await setEnquiryTakeover(env, {
      accountId,
      enquiryId: decodeURIComponent(takeoverMatch[1]!),
      paused: body.paused !== false,
      assignedAgentId: typeof body.assignedAgentId === 'string' ? body.assignedAgentId : undefined,
      actorUserId: user.id,
    });
    if (!res.ok) return json({ ok: false, error: res.error }, res.status);
    return json(res);
  }

  const bookingPropMatch = path.match(/^\/enquiries\/([^/]+)\/booking-proposal$/);
  if (bookingPropMatch && request.method === 'POST') {
    const existing = await getEnquiryById(env, accountId, decodeURIComponent(bookingPropMatch[1]!));
    if (!existing) return json({ ok: false, error: 'Enquiry not found' }, 404);
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.res;
    const { body } = parsed;
    const res = await createBookingProposal(env, {
      accountId,
      projectId: existing.projectId,
      enquiryId: existing.id,
      contactId: existing.contactId,
      propertyId: existing.propertyId,
      assignedAgentId: String(body.assignedAgentId || existing.assignedAgentId || user.id),
      proposedSlots: Array.isArray(body.proposedSlots) ? (body.proposedSlots as ProposedBookingSlot[]) : [],
    });
    if (!res.ok) return json({ ok: false, error: res.error }, res.status);
    return json(res, 201);
  }

  if (path === '/enquiries/appointments' && request.method === 'GET') {
    const projectId = (url.searchParams.get('projectId') || 'default').trim();
    const appointments = await listProjectAppointments(env, accountId, projectId);
    return json({ ok: true, projectId, appointments });
  }

  const bookingDecideMatch = path.match(/^\/enquiries\/appointments\/([^/]+)\/(?:decision|decide)$/);
  if (bookingDecideMatch && request.method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.res;
    const { body } = parsed;
    if (body.decision !== 'approve' && body.decision !== 'decline') {
      return json({ ok: false, error: 'decision must be approve or decline' }, 400);
    }
    const res = await decideBookingAppointment(env, {
      accountId,
      appointmentId: decodeURIComponent(bookingDecideMatch[1]!),
      decision: body.decision,
      selectedSlotId: typeof body.selectedSlotId === 'string' ? body.selectedSlotId : undefined,
      selectedSlotIso: typeof body.selectedSlotIso === 'string' ? body.selectedSlotIso : undefined,
      calendarExternalId: typeof body.calendarExternalId === 'string' ? body.calendarExternalId : undefined,
      actorUserId: user.id,
    });
    if (!res.ok) return json({ ok: false, error: res.error }, res.status);
    return json(res);
  }

  if (
    (path === '/outcomes' || path === '/outcomes/summary' || path === '/outcomes/funnel') &&
    request.method === 'GET'
  ) {
    const projectId = (url.searchParams.get('projectId') || 'default').trim();
    const funnel = await getProjectConversionFunnelSummary(env, accountId, projectId);
    return json({ ok: true, funnel });
  }

  if (path === '/outcomes/record' && request.method === 'POST') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.res;
    const { body } = parsed;
    const res = await recordOutcomeStageEvent(env, {
      accountId,
      projectId: String(body.projectId || 'default').trim(),
      enquiryId: String(body.enquiryId || '').trim(),
      stage: String(body.stage || '') as OutcomeStage,
      evidenceType: String(body.evidenceType || '') as OutcomeEvidenceType,
      evidenceRef: String(body.evidenceRef || ''),
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      recordedBy: user.id,
    });
    if (!res.ok) return json({ ok: false, error: res.error }, res.status);
    return json(res, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
}
