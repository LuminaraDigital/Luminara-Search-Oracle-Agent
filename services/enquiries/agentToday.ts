/**
 * The agent's Today view: what needs sign-off, who to call, and the last 7 days.
 * Built only from stored enquiries, appointments and outcome events. No estimates.
 */
import type { EnquiryIntentType, OpportunityBrief, OutcomeStage } from './playbookQualificationService';

export const TODAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const SEGMENT_LABELS: Record<EnquiryIntentType, string> = {
  seller_appraisal: 'Sellers',
  buyer_enquiry: 'Buyers',
  landlord_management: 'Landlords',
  general_sme: 'Other',
};

export interface TodayEnquiryInput {
  id: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  propertyAddress: string | null;
  intentType: EnquiryIntentType;
  status: string;
  slaDueAt: number;
  consentStatus: string;
  qualificationBrief: Pick<OpportunityBrief, 'escalationRequired' | 'escalationReason'>;
}

export interface TodayAppointmentInput {
  id: string;
  enquiryId: string;
  approvalStatus: string;
  proposedSlots: Array<{ slotId: string; startAt: number; endAt: number; label: string }>;
  confirmedStartAt: number | null;
  confirmedEndAt: number | null;
}

export interface TodayOutcomeRow {
  intentType: EnquiryIntentType;
  stage: OutcomeStage;
  count: number;
}

export interface TodayContact {
  enquiryId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  segment: EnquiryIntentType;
}

export interface AgentToday {
  needsSignOff: Array<TodayContact & { appointmentId: string; slots: TodayAppointmentInput['proposedSlots'] }>;
  callBack: Array<TodayContact & { reason: string }>;
  upcoming: Array<TodayContact & { appointmentId: string; startAt: number; endAt: number }>;
  scorecard: {
    since: number;
    until: number;
    segments: Array<{
      segment: EnquiryIntentType;
      label: string;
      enquiries: number;
      qualified: number;
      appraisalsBooked: number;
    }>;
  };
}

function contactOf(e: TodayEnquiryInput): TodayContact {
  return {
    enquiryId: e.id,
    name: e.contactName,
    phone: e.contactPhone,
    email: e.contactEmail,
    address: e.propertyAddress,
    segment: e.intentType,
  };
}

export function buildAgentToday(input: {
  enquiries: TodayEnquiryInput[];
  appointments: TodayAppointmentInput[];
  outcomes: TodayOutcomeRow[];
  now: number;
}): AgentToday {
  const { enquiries, appointments, outcomes, now } = input;
  const byId = new Map(enquiries.map((e) => [e.id, e]));

  const needsSignOff = appointments
    .filter((a) => a.approvalStatus === 'pending_agent_signoff' && byId.has(a.enquiryId))
    .map((a) => ({ ...contactOf(byId.get(a.enquiryId)!), appointmentId: a.id, slots: a.proposedSlots }));

  const upcoming = appointments
    .filter((a) => a.approvalStatus === 'approved' && a.confirmedStartAt !== null && a.confirmedStartAt >= now)
    .filter((a) => byId.has(a.enquiryId))
    .map((a) => ({
      ...contactOf(byId.get(a.enquiryId)!),
      appointmentId: a.id,
      startAt: a.confirmedStartAt!,
      endAt: a.confirmedEndAt ?? a.confirmedStartAt! + 30 * 60_000,
    }))
    .sort((x, y) => x.startAt - y.startAt);

  const callBack = enquiries
    .filter((e) => e.status !== 'closed' && e.consentStatus !== 'unsubscribed')
    .flatMap((e) => {
      if (e.qualificationBrief.escalationRequired) {
        return [{ ...contactOf(e), reason: e.qualificationBrief.escalationReason || 'They asked something only you can answer.' }];
      }
      if (e.status === 'new' && e.slaDueAt > 0 && e.slaDueAt < now) {
        return [{ ...contactOf(e), reason: 'New enquiry waiting longer than your reply target.' }];
      }
      return [];
    });

  const counts = new Map<string, number>();
  for (const row of outcomes) counts.set(`${row.intentType}:${row.stage}`, (counts.get(`${row.intentType}:${row.stage}`) ?? 0) + row.count);
  const segments = (Object.keys(SEGMENT_LABELS) as EnquiryIntentType[])
    .map((segment) => ({
      segment,
      label: SEGMENT_LABELS[segment],
      enquiries: counts.get(`${segment}:enquiry_received`) ?? 0,
      qualified: counts.get(`${segment}:qualified_opportunity`) ?? 0,
      appraisalsBooked: counts.get(`${segment}:agent_approved_booking`) ?? 0,
    }))
    .filter((s) => s.segment !== 'general_sme' || s.enquiries + s.qualified + s.appraisalsBooked > 0);

  return { needsSignOff, callBack, upcoming, scorecard: { since: now - TODAY_WINDOW_MS, until: now, segments } };
}
