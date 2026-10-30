/**
 * Module D: Evidence-Backed 6-Stage Outcomes Ledger Service
 *
 * Tracks the verified progression of enquiries through the 6 real-estate & SME conversion stages:
 * 1. enquiry_received
 * 2. two_way_conversation
 * 3. qualified_opportunity
 * 4. agent_approved_booking
 * 5. attended_appraisal
 * 6. signed_listing
 *
 * Invariant (APS #5): Never invent conversion or revenue metrics. Every stage event requires a
 * verifiable evidence_type and evidence_ref, and high-trust stages (agent_approved_booking,
 * attended_appraisal, signed_listing) require explicit human/staff confirmation receipts.
 */

import type { Env } from './env';
import {
  OUTCOME_STAGES,
  type OutcomeEvidenceType,
  type OutcomeStage,
} from '../services/enquiries/playbookQualificationService';
export { OUTCOME_STAGES, type OutcomeEvidenceType, type OutcomeStage };

export interface OutcomeStageEventRecord {
  id: string;
  accountId: string;
  projectId: string;
  enquiryId: string;
  stage: OutcomeStage;
  evidenceType: OutcomeEvidenceType;
  evidenceRef: string;
  notes: string | null;
  recordedBy: string;
  createdAt: number;
}

export interface ConversionFunnelSummary {
  projectId: string;
  countsByStage: Record<OutcomeStage, number>;
  recentEvents: OutcomeStageEventRecord[];
  revenueAttributionStatus: 'not_measured';
}

const VALID_STAGES = new Set<string>(OUTCOME_STAGES);

const VALID_EVIDENCE_TYPES = new Set<OutcomeEvidenceType>([
  'webhook_payload',
  'message_transcript_id',
  'qualification_brief_id',
  'agent_signoff_receipt',
  'staff_confirmation',
  'listing_url',
]);

const HUMAN_EVIDENCE_REQUIRED_STAGES: Partial<Record<OutcomeStage, ReadonlySet<OutcomeEvidenceType>>> = {
  agent_approved_booking: new Set<OutcomeEvidenceType>(['agent_signoff_receipt', 'staff_confirmation']),
  attended_appraisal: new Set<OutcomeEvidenceType>(['staff_confirmation']),
  signed_listing: new Set<OutcomeEvidenceType>(['staff_confirmation', 'listing_url']),
};

export function validateOutcomeStageInput(input: {
  stage: string;
  evidenceType: string;
  evidenceRef: string;
}): { ok: true; stage: OutcomeStage; evidenceType: OutcomeEvidenceType; evidenceRef: string } | { ok: false; error: string } {
  if (!VALID_STAGES.has(input.stage)) {
    return {
      ok: false,
      error: `Invalid outcome stage "${input.stage}". Expected one of: ${OUTCOME_STAGES.join(', ')}.`,
    };
  }
  const stage = input.stage as OutcomeStage;

  if (!VALID_EVIDENCE_TYPES.has(input.evidenceType as OutcomeEvidenceType)) {
    return {
      ok: false,
      error: `Invalid evidenceType "${input.evidenceType}".`,
    };
  }
  const evidenceType = input.evidenceType as OutcomeEvidenceType;

  const evidenceRef = String(input.evidenceRef || '').trim();
  if (!evidenceRef) {
    return {
      ok: false,
      error: `Outcome stage "${stage}" requires a non-empty evidenceRef linking to the source record.`,
    };
  }

  const requiredSet = HUMAN_EVIDENCE_REQUIRED_STAGES[stage];
  if (requiredSet && !requiredSet.has(evidenceType)) {
    return {
      ok: false,
      error: `Stage "${stage}" requires human verification evidence (${[...requiredSet].join(' or ')}), got "${evidenceType}".`,
    };
  }

  return { ok: true, stage, evidenceType, evidenceRef };
}

export async function recordOutcomeStageEvent(
  env: Env,
  args: {
    accountId: string;
    projectId: string;
    enquiryId: string;
    stage: OutcomeStage;
    evidenceType: OutcomeEvidenceType;
    evidenceRef: string;
    notes?: string;
    recordedBy: string;
    now?: number;
  },
): Promise<{ ok: true; event: OutcomeStageEventRecord } | { ok: false; error: string; status: number }> {
  const check = validateOutcomeStageInput({
    stage: args.stage,
    evidenceType: args.evidenceType,
    evidenceRef: args.evidenceRef,
  });
  if (!check.ok) {
    return { ok: false, error: check.error, status: 400 };
  }

  if (!env.DB) {
    return { ok: false, error: 'Database unavailable', status: 503 };
  }

  const createdAt = args.now ?? Date.now();
  const existingEnquiry = await env.DB.prepare(
    `SELECT id FROM enquiries WHERE id = ? AND account_id = ? AND project_id = ?`,
  )
    .bind(args.enquiryId, args.accountId, args.projectId)
    .first<{ id: string }>();
  if (!existingEnquiry) {
    return {
      ok: false,
      error: 'Enquiry not found for this account and project.',
      status: 404,
    };
  }

  const id = `out_${args.accountId}_${args.enquiryId}_${check.stage}`;
  const notes = args.notes?.trim() ? args.notes.trim().slice(0, 1000) : null;

  await env.DB.prepare(
    `INSERT INTO outcome_stage_events (
      id, account_id, project_id, enquiry_id, stage, evidence_type, evidence_ref, notes, recorded_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, enquiry_id, stage) DO UPDATE SET
      evidence_type = excluded.evidence_type,
      evidence_ref = excluded.evidence_ref,
      notes = excluded.notes,
      recorded_by = excluded.recorded_by,
      created_at = excluded.created_at`,
  )
    .bind(
      id,
      args.accountId,
      args.projectId,
      args.enquiryId,
      check.stage,
      check.evidenceType,
      check.evidenceRef,
      notes,
      args.recordedBy,
      createdAt,
    )
    .run();

  if (check.stage === 'agent_approved_booking') {
    await env.DB.prepare(
      `UPDATE enquiries SET status = 'booked', updated_at = ? WHERE id = ? AND account_id = ?`,
    )
      .bind(createdAt, args.enquiryId, args.accountId)
      .run();
  }

  return {
    ok: true,
    event: {
      id,
      accountId: args.accountId,
      projectId: args.projectId,
      enquiryId: args.enquiryId,
      stage: check.stage,
      evidenceType: check.evidenceType,
      evidenceRef: check.evidenceRef,
      notes,
      recordedBy: args.recordedBy,
      createdAt,
    },
  };
}

export async function getProjectConversionFunnelSummary(
  env: Env,
  accountId: string,
  projectId: string,
): Promise<ConversionFunnelSummary> {
  const countsByStage: Record<OutcomeStage, number> = {
    enquiry_received: 0,
    two_way_conversation: 0,
    qualified_opportunity: 0,
    agent_approved_booking: 0,
    attended_appraisal: 0,
    signed_listing: 0,
  };

  if (!env.DB) {
    return {
      projectId,
      countsByStage,
      recentEvents: [],
      revenueAttributionStatus: 'not_measured',
    };
  }

  const countRows = await env.DB.prepare(
    `SELECT stage, COUNT(*) as cnt
     FROM outcome_stage_events
     WHERE account_id = ? AND project_id = ?
     GROUP BY stage`,
  )
    .bind(accountId, projectId)
    .all<{ stage: string; cnt: number }>();

  for (const row of countRows.results || []) {
    if (VALID_STAGES.has(row.stage)) {
      countsByStage[row.stage as OutcomeStage] = Number(row.cnt || 0);
    }
  }

  const recentRows = await env.DB.prepare(
    `SELECT id, account_id, project_id, enquiry_id, stage, evidence_type, evidence_ref, notes, recorded_by, created_at
     FROM outcome_stage_events
     WHERE account_id = ? AND project_id = ?
     ORDER BY created_at DESC
     LIMIT 30`,
  )
    .bind(accountId, projectId)
    .all<{
      id: string;
      account_id: string;
      project_id: string;
      enquiry_id: string;
      stage: OutcomeStage;
      evidence_type: OutcomeEvidenceType;
      evidence_ref: string;
      notes: string | null;
      recorded_by: string;
      created_at: number;
    }>();

  const recentEvents: OutcomeStageEventRecord[] = (recentRows.results || []).map((r) => ({
    id: r.id,
    accountId: r.account_id,
    projectId: r.project_id,
    enquiryId: r.enquiry_id,
    stage: r.stage,
    evidenceType: r.evidence_type,
    evidenceRef: r.evidence_ref,
    notes: r.notes,
    recordedBy: r.recorded_by,
    createdAt: Number(r.created_at),
  }));

  return {
    projectId,
    countsByStage,
    recentEvents,
    revenueAttributionStatus: 'not_measured',
  };
}
