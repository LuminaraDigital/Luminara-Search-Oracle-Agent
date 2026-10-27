/**
 * Authenticated Worker API Client for the 4-Module Conversion Spine & CMS MCP Relay (0042).
 * Uses `workerFetchWithAuthRetry` and `apiBase()` so Firebase ID tokens, Telegram initData,
 * and AppCheck headers are attached automatically.
 */

import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import type {
  EnquiryIntentType,
  OutcomeEvidenceType,
  OutcomeStage,
} from './playbookQualificationService';
import type {
  CmsMcpConnectorId,
  RemediationFindingInput,
  RemediationTierDecision,
} from '../deployment/remediationTierRouter';

export async function fetchEnquiryDesk(projectId = 'default'): Promise<{
  ok: boolean;
  status: number;
  enquiries?: Array<{
    id: string;
    contactName: string;
    contactPhone: string | null;
    contactEmail: string | null;
    propertyAddress: string | null;
    intentType: EnquiryIntentType;
    status: 'new' | 'conversing' | 'qualified' | 'booking_proposed' | 'booked' | 'stalled' | 'closed';
    automationPaused: boolean;
    slaDueAt: number;
    qualificationBrief?: {
      recordedAnswers?: Record<string, { value?: string; status?: 'measured' | 'unknown'; messageId?: string }>;
      escalationReason?: string;
    };
  }>;
  funnel?: { countsByStage?: Record<OutcomeStage, number> };
  error?: string;
}> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(
    `${base}/api/enquiries?projectId=${encodeURIComponent(projectId)}`,
  );
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      error: typeof data.error === 'string' ? data.error : `HTTP ${r.status}`,
    };
  }
  return {
    ok: true,
    status: r.status,
    enquiries: Array.isArray(data.enquiries) ? (data.enquiries as any) : [],
    funnel: (data.funnel as any) || undefined,
  };
}

export async function ingestEnquiryApi(input: {
  projectId?: string;
  fullName: string;
  email?: string;
  phoneE164?: string;
  propertyAddress?: string;
  suburb?: string;
  state?: string;
  intentType?: EnquiryIntentType;
  initialMessage: string;
}): Promise<{
  ok: boolean;
  enquiry?: { id: string; status: string; automationPaused: boolean };
  suggestedReply?: string | null;
  evaluation?: Record<string, unknown>;
  error?: string;
}> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(`${base}/api/enquiries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'default', ...input }),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${r.status}` };
  }
  const evalObj =
    data.evaluation && typeof data.evaluation === 'object'
      ? (data.evaluation as Record<string, unknown>)
      : undefined;
  const reply =
    typeof data.suggestedReply === 'string'
      ? data.suggestedReply
      : typeof evalObj?.suggestedReply === 'string'
        ? evalObj.suggestedReply
        : null;
  return {
    ok: true,
    enquiry: data.enquiry as any,
    suggestedReply: reply,
    evaluation: evalObj,
  };
}

export async function appendEnquiryTurnApi(
  enquiryId: string,
  input: {
    sender: 'prospect' | 'agent';
    text: string;
    extractedAnswers?: Record<string, string>;
    agencyName?: string;
  },
): Promise<{ ok: boolean; enquiry?: Record<string, unknown>; evaluation?: Record<string, unknown>; error?: string }> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(
    `${base}/api/enquiries/${encodeURIComponent(enquiryId)}/turn`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && Boolean(data.ok),
    enquiry: data.enquiry as Record<string, unknown> | undefined,
    evaluation: data.evaluation as Record<string, unknown> | undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export async function setEnquiryTakeoverApi(
  enquiryId: string,
  input: { paused: boolean; assignedAgentId?: string },
): Promise<{ ok: boolean; error?: string }> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(
    `${base}/api/enquiries/${encodeURIComponent(enquiryId)}/takeover`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && Boolean(data.ok),
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export async function proposeBookingSlotsApi(
  enquiryId: string,
  input: {
    assignedAgentId?: string;
    proposedSlots: Array<{ slotId: string; startAt: number; endAt: number; label: string }>;
  },
): Promise<{ ok: boolean; appointment?: { id: string; approvalStatus: string }; error?: string }> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(
    `${base}/api/enquiries/${encodeURIComponent(enquiryId)}/booking-proposal`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && Boolean(data.ok),
    appointment: data.appointment as { id: string; approvalStatus: string } | undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export async function decideBookingAppointmentApi(
  appointmentId: string,
  input: {
    decision: 'approve' | 'decline';
    selectedSlotId?: string;
    calendarExternalId?: string;
  },
): Promise<{ ok: boolean; appointment?: { id: string; approvalStatus: string }; signoffReceiptId?: string | null; error?: string }> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(
    `${base}/api/enquiries/appointments/${encodeURIComponent(appointmentId)}/decision`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && Boolean(data.ok),
    appointment: data.appointment as { id: string; approvalStatus: string } | undefined,
    signoffReceiptId: typeof data.signoffReceiptId === 'string' ? data.signoffReceiptId : null,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export async function syncEnquiryToTwentyApi(input: {
  enquiryId: string;
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: boolean; duplicate?: boolean; personExternalId?: string; opportunityExternalId?: string; error?: string }> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(`${base}/api/enquiries/sync-twenty`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && Boolean(data.ok),
    duplicate: Boolean(data.duplicate),
    personExternalId: typeof data.personExternalId === 'string' ? data.personExternalId : undefined,
    opportunityExternalId: typeof data.opportunityExternalId === 'string' ? data.opportunityExternalId : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export async function recordOutcomeStageApi(input: {
  projectId?: string;
  enquiryId: string;
  stage: OutcomeStage;
  evidenceType: OutcomeEvidenceType;
  evidenceRef: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(`${base}/api/outcomes/record`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'default', ...input }),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && Boolean(data.ok),
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export async function sendRecoveryStepApi(input: {
  projectId?: string;
  enquiryId: string;
  playbookId?: string;
  stepIndex?: number;
  channel: 'email' | 'sms' | 'whatsapp' | 'voice';
  messageBody: string;
  agencyLegalName: string;
  agencyContactDetails: string;
  unsubscribeUrl?: string;
}): Promise<{ ok: boolean; runId?: string; formattedMessage?: string; code?: string; error?: string }> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(`${base}/api/recovery/send-step`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId: 'default', ...input }),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && Boolean(data.ok),
    runId: typeof data.runId === 'string' ? data.runId : undefined,
    formattedMessage: typeof data.formattedMessage === 'string' ? data.formattedMessage : undefined,
    code: typeof data.code === 'string' ? data.code : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export async function fetchCmsMcpCatalogApi(): Promise<{
  ok: boolean;
  connectors?: Array<Record<string, unknown>>;
  blockedTools?: string[];
  error?: string;
}> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(`${base}/api/cms-mcp/catalog`);
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && Boolean(data.ok),
    connectors: Array.isArray(data.connectors) ? (data.connectors as Array<Record<string, unknown>>) : undefined,
    blockedTools: Array.isArray(data.blockedTools) ? (data.blockedTools as string[]) : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export async function classifyCmsRemediationApi(input: {
  finding: RemediationFindingInput;
  preparedSchemaSnippet?: string;
}): Promise<{ ok: boolean; decision?: RemediationTierDecision; error?: string }> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(`${base}/api/cms-mcp/classify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && Boolean(data.ok),
    decision: data.decision as RemediationTierDecision | undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

export async function prepareCmsMcpCallApi(input: {
  projectId?: string;
  connectorId: CmsMcpConnectorId;
  domain: string;
  title?: string;
  toolName?: string;
  userConfirmed?: boolean;
  snapshotCreated?: boolean;
  pageMetaKeys?: string[];
  schemaJsonLd?: string;
  parameters?: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  duplicate?: boolean;
  effectKey?: string;
  mode?: string;
  envelope?: Record<string, unknown>;
  pack?: { headerSnippet: string; instructions: string[]; verificationNote: string };
  escalationDecision?: RemediationTierDecision;
  code?: string;
  error?: string;
}> {
  const base = apiBase() || '';
  const r = await workerFetchWithAuthRetry(`${base}/api/cms-mcp/prepare-call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ok: r.ok && Boolean(data.ok),
    duplicate: Boolean(data.duplicate),
    effectKey: typeof data.effectKey === 'string' ? data.effectKey : undefined,
    mode: typeof data.mode === 'string' ? data.mode : undefined,
    envelope: data.envelope as Record<string, unknown> | undefined,
    pack: data.pack as { headerSnippet: string; instructions: string[]; verificationNote: string } | undefined,
    escalationDecision: data.escalationDecision as RemediationTierDecision | undefined,
    code: typeof data.code === 'string' ? data.code : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}
