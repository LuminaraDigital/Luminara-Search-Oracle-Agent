/**
 * Agent-Approved Appraisal & Callback Booking Service (Stage 2)
 *
 * Implements the human-supervised booking boundary:
 * 1. Proposes 1-4 candidate appraisal/callback time slots for a qualified enquiry.
 * 2. Requires explicit human agent sign-off (`approveBookingAppointment`) before a booking
 *    transitions to `approved` and records `agent_approved_booking` in the Outcomes Ledger.
 */

import type { Env } from './env';
import { recordOutcomeStageEvent } from './outcomesLedgerService';
import { safeJsonParse } from '../services/llm/safeJsonParse';

export interface ProposedBookingSlot {
  slotId: string;
  startAt: number;
  endAt: number;
  label: string;
}

export function normalizeProposedSlot(
  raw: unknown,
  index: number,
  fallbackNow = Date.now(),
): ProposedBookingSlot | null {
  if (typeof raw === 'string' && raw.trim()) {
    const parsedMs = Date.parse(raw.trim());
    const startAt = Number.isFinite(parsedMs) ? parsedMs : fallbackNow + (index + 1) * 3600_000;
    return {
      slotId: `slot_${index + 1}`,
      startAt,
      endAt: startAt + 30 * 60_000,
      label: raw.trim(),
    };
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const isoStr = typeof obj.iso === 'string' ? obj.iso : typeof obj.startIso === 'string' ? obj.startIso : '';
  const parsedIso = isoStr ? Date.parse(isoStr) : NaN;
  const startAt = Number.isFinite(Number(obj.startAt))
    ? Number(obj.startAt)
    : Number.isFinite(parsedIso)
      ? parsedIso
      : NaN;
  const endAt = Number.isFinite(Number(obj.endAt))
    ? Number(obj.endAt)
    : Number.isFinite(startAt)
      ? startAt + 30 * 60_000
      : NaN;
  const slotId = typeof obj.slotId === 'string' && obj.slotId.trim() ? obj.slotId.trim() : `slot_${index + 1}`;
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) return null;
  return {
    slotId,
    startAt,
    endAt,
    label: typeof obj.label === 'string' && obj.label.trim() ? obj.label.trim() : isoStr || slotId,
  };
}

export interface AppraisalAppointmentRecord {
  id: string;
  accountId: string;
  projectId: string;
  enquiryId: string;
  contactId: string;
  propertyId: string | null;
  assignedAgentId: string;
  proposedSlots: ProposedBookingSlot[];
  confirmedStartAt: number | null;
  confirmedEndAt: number | null;
  approvalStatus: 'pending_agent_signoff' | 'approved' | 'declined' | 'rescheduled' | 'attended' | 'no_show';
  approvedByUserId: string | null;
  approvedAt: number | null;
  calendarExternalId: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function createBookingProposal(
  env: Env,
  args: {
    accountId: string;
    projectId: string;
    enquiryId: string;
    contactId: string;
    propertyId?: string | null;
    assignedAgentId: string;
    proposedSlots: ProposedBookingSlot[];
    now?: number;
  },
): Promise<{ ok: true; appointment: AppraisalAppointmentRecord } | { ok: false; error: string; status: number }> {
  if (!env.DB) {
    return { ok: false, error: 'Database unavailable', status: 503 };
  }

  if (!Array.isArray(args.proposedSlots) || args.proposedSlots.length === 0 || args.proposedSlots.length > 6) {
    return {
      ok: false,
      error: 'Provide between 1 and 6 proposed candidate slots for agent sign-off.',
      status: 400,
    };
  }

  for (const slot of args.proposedSlots) {
    if (
      !slot ||
      typeof slot !== 'object' ||
      !slot.slotId ||
      !Number.isFinite(slot.startAt) ||
      !Number.isFinite(slot.endAt) ||
      slot.endAt <= slot.startAt
    ) {
      return {
        ok: false,
        error: 'Each proposed slot must have a valid slotId and startAt < endAt timestamp.',
        status: 400,
      };
    }
  }

  const enquiryRow = await env.DB.prepare(
    `SELECT id, contact_id, property_id FROM enquiries WHERE id = ? AND account_id = ? AND project_id = ? LIMIT 1`,
  )
    .bind(args.enquiryId, args.accountId, args.projectId)
    .first<{ id: string; contact_id: string; property_id: string | null }>();
  if (!enquiryRow) {
    return {
      ok: false,
      error: 'Enquiry not found for this account and project.',
      status: 404,
    };
  }

  const resolvedContactId = args.contactId?.trim() || enquiryRow.contact_id;
  const resolvedPropertyId = args.propertyId !== undefined ? args.propertyId : enquiryRow.property_id;
  const now = args.now ?? Date.now();
  const id = `appt_${args.enquiryId}_${now}`;
  const slotsJson = JSON.stringify(args.proposedSlots);

  await env.DB.prepare(
    `INSERT INTO appraisal_appointments (
      id, account_id, project_id, enquiry_id, contact_id, property_id, assigned_agent_id,
      proposed_slots_json, approval_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_agent_signoff', ?, ?)`,
  )
    .bind(
      id,
      args.accountId,
      args.projectId,
      args.enquiryId,
      resolvedContactId,
      resolvedPropertyId ?? null,
      args.assignedAgentId,
      slotsJson,
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `UPDATE enquiries SET status = 'booking_proposed', updated_at = ? WHERE id = ? AND account_id = ?`,
  )
    .bind(now, args.enquiryId, args.accountId)
    .run();

  return {
    ok: true,
    appointment: {
      id,
      accountId: args.accountId,
      projectId: args.projectId,
      enquiryId: args.enquiryId,
      contactId: resolvedContactId,
      propertyId: resolvedPropertyId ?? null,
      assignedAgentId: args.assignedAgentId,
      proposedSlots: args.proposedSlots,
      confirmedStartAt: null,
      confirmedEndAt: null,
      approvalStatus: 'pending_agent_signoff',
      approvedByUserId: null,
      approvedAt: null,
      calendarExternalId: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export async function decideBookingAppointment(
  env: Env,
  args: {
    accountId: string;
    appointmentId: string;
    decision: 'approve' | 'decline';
    selectedSlotId?: string;
    selectedSlotIso?: string;
    actorUserId: string;
    calendarExternalId?: string;
    now?: number;
  },
): Promise<{ ok: true; appointment: AppraisalAppointmentRecord; signoffReceiptId?: string } | { ok: false; error: string; status: number }> {
  if (!env.DB) {
    return { ok: false, error: 'Database unavailable', status: 503 };
  }

  const row = await env.DB.prepare(
    `SELECT id, account_id, project_id, enquiry_id, contact_id, property_id, assigned_agent_id,
            proposed_slots_json, confirmed_start_at, confirmed_end_at, approval_status,
            approved_by_user_id, approved_at, calendar_external_id, created_at, updated_at
     FROM appraisal_appointments
     WHERE id = ? AND account_id = ?`,
  )
    .bind(args.appointmentId, args.accountId)
    .first<{
      id: string;
      account_id: string;
      project_id: string;
      enquiry_id: string;
      contact_id: string;
      property_id: string | null;
      assigned_agent_id: string;
      proposed_slots_json: string;
      confirmed_start_at: number | null;
      confirmed_end_at: number | null;
      approval_status: AppraisalAppointmentRecord['approvalStatus'];
      approved_by_user_id: string | null;
      approved_at: number | null;
      calendar_external_id: string | null;
      created_at: number;
      updated_at: number;
    }>();

  if (!row) {
    return { ok: false, error: 'Appointment not found', status: 404 };
  }

  const now = args.now ?? Date.now();
  const rawSlots = safeJsonParse<unknown[]>(row.proposed_slots_json || '[]', []);
  const proposedSlots = rawSlots
    .map((s, idx) => normalizeProposedSlot(s, idx, now))
    .filter((s): s is ProposedBookingSlot => s !== null);

  if (args.decision === 'decline') {
    await env.DB.prepare(
      `UPDATE appraisal_appointments
       SET approval_status = 'declined', approved_by_user_id = ?, approved_at = ?, updated_at = ?
       WHERE id = ? AND account_id = ?`,
    )
      .bind(args.actorUserId, now, now, row.id, args.accountId)
      .run();
    await env.DB.prepare(
      `UPDATE enquiries SET status = 'qualified', updated_at = ?
       WHERE id = ? AND account_id = ? AND status = 'booking_proposed'`,
    )
      .bind(now, row.enquiry_id, args.accountId)
      .run();

    return {
      ok: true,
      appointment: {
        id: row.id,
        accountId: row.account_id,
        projectId: row.project_id,
        enquiryId: row.enquiry_id,
        contactId: row.contact_id,
        propertyId: row.property_id,
        assignedAgentId: row.assigned_agent_id,
        proposedSlots,
        confirmedStartAt: null,
        confirmedEndAt: null,
        approvalStatus: 'declined',
        approvedByUserId: args.actorUserId,
        approvedAt: now,
        calendarExternalId: row.calendar_external_id,
        createdAt: Number(row.created_at),
        updatedAt: now,
      },
    };
  }

  const matchKey = (args.selectedSlotId || args.selectedSlotIso || '').trim();
  const matchedSlot = matchKey
    ? proposedSlots.find(
        (s) =>
          s.slotId === matchKey ||
          s.label === matchKey ||
          new Date(s.startAt).toISOString() === matchKey,
      )
    : undefined;
  const selectedSlot =
    matchedSlot ??
    proposedSlots[0] ??
    (args.selectedSlotIso ? normalizeProposedSlot(args.selectedSlotIso, 0, now) : null);

  if (!selectedSlot) {
    return {
      ok: false,
      error: 'Selected booking slot not found in proposedSlots.',
      status: 400,
    };
  }

  const signoffReceiptId = `signoff_${row.id}_${now}`;

  await env.DB.prepare(
    `UPDATE appraisal_appointments
     SET approval_status = 'approved',
         confirmed_start_at = ?,
         confirmed_end_at = ?,
         approved_by_user_id = ?,
         approved_at = ?,
         calendar_external_id = ?,
         updated_at = ?
     WHERE id = ? AND account_id = ?`,
  )
    .bind(
      selectedSlot.startAt,
      selectedSlot.endAt,
      args.actorUserId,
      now,
      args.calendarExternalId ?? row.calendar_external_id ?? null,
      now,
      row.id,
      args.accountId,
    )
    .run();

  await recordOutcomeStageEvent(env, {
    accountId: args.accountId,
    projectId: row.project_id,
    enquiryId: row.enquiry_id,
    stage: 'agent_approved_booking',
    evidenceType: 'agent_signoff_receipt',
    evidenceRef: signoffReceiptId,
    notes: `Approved slot ${selectedSlot.label} by ${args.actorUserId}`,
    recordedBy: args.actorUserId,
    now,
  });

  return {
    ok: true,
    signoffReceiptId,
    appointment: {
      id: row.id,
      accountId: row.account_id,
      projectId: row.project_id,
      enquiryId: row.enquiry_id,
      contactId: row.contact_id,
      propertyId: row.property_id,
      assignedAgentId: row.assigned_agent_id,
      proposedSlots,
      confirmedStartAt: selectedSlot.startAt,
      confirmedEndAt: selectedSlot.endAt,
      approvalStatus: 'approved',
      approvedByUserId: args.actorUserId,
      approvedAt: now,
      calendarExternalId: args.calendarExternalId ?? row.calendar_external_id ?? null,
      createdAt: Number(row.created_at),
      updatedAt: now,
    },
  };
}
