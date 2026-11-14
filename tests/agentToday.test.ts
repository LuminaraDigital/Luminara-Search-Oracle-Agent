import { describe, expect, it } from 'vitest';
import { buildAgentToday } from '../services/enquiries/agentToday';
import { createBookingProposal } from '../worker/bookingApprovalService';
import { handleEnquiryDeskRoute, ingestInboundEnquiry } from '../worker/enquiryDeskService';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

const AGENT: HostedIdentity = { id: 'usr_agent_1', email: 'agent@example.com.au', plan: 'agency' };

describe('Agent Today', () => {
  it('lists sign-offs, call-backs and a 7-day scorecard from stored records only', async () => {
    const env = { DB: createSqliteD1() } as unknown as Env;
    const now = Date.now();
    const seller = await ingestInboundEnquiry(env, {
      accountId: AGENT.id,
      projectId: 'default',
      fullName: 'Sam Owner',
      phoneE164: '+61412345678',
      propertyAddress: '12 Example St, Richmond VIC 3121',
      intentType: 'seller_appraisal',
      initialMessage: 'Thinking of selling after spring.',
      now,
    });
    const escalated = await ingestInboundEnquiry(env, {
      accountId: AGENT.id,
      projectId: 'default',
      fullName: 'Pat Buyer',
      email: 'pat@example.com.au',
      intentType: 'buyer_enquiry',
      initialMessage: 'Can you send the Section 32 and tell me if I can waive the cooling-off?',
      now,
    });
    expect(seller.ok && escalated.ok).toBe(true);
    if (!seller.ok || !escalated.ok) return;
    const proposal = await createBookingProposal(env, {
      accountId: AGENT.id,
      projectId: 'default',
      enquiryId: seller.enquiry.id,
      contactId: seller.enquiry.contactId,
      propertyId: seller.enquiry.propertyId,
      assignedAgentId: AGENT.id,
      proposedSlots: [{ slotId: 'slot_1', startAt: now + 86_400_000, endAt: now + 88_200_000, label: 'Tomorrow 10am' }],
    });
    expect(proposal.ok).toBe(true);

    const res = await handleEnquiryDeskRoute(
      new Request('https://luminarasuite.com/api/enquiries/today'),
      env,
      AGENT,
      '/enquiries/today',
    );
    const body = (await res!.json()) as ReturnType<typeof buildAgentToday> & { ok: boolean };
    expect(body.ok).toBe(true);
    expect(body.needsSignOff).toHaveLength(1);
    expect(body.needsSignOff[0]).toMatchObject({ name: 'Sam Owner', phone: '+61412345678', segment: 'seller_appraisal' });
    expect(body.callBack.map((c) => c.name)).toEqual(['Pat Buyer']);
    const sellers = body.scorecard.segments.find((s) => s.segment === 'seller_appraisal');
    const buyers = body.scorecard.segments.find((s) => s.segment === 'buyer_enquiry');
    expect(sellers?.enquiries).toBe(1);
    expect(buyers?.enquiries).toBe(1);
    expect(body.scorecard.segments.some((s) => s.segment === 'general_sme')).toBe(false);
  });

  it('keeps unsubscribed people off the call-back list and lists upcoming approved appraisals', () => {
    const now = 1_000_000;
    const base = {
      contactEmail: null,
      contactPhone: '+61400000000',
      propertyAddress: null,
      intentType: 'seller_appraisal' as const,
      slaDueAt: now - 1,
      qualificationBrief: { escalationRequired: false },
    };
    const today = buildAgentToday({
      enquiries: [
        { ...base, id: 'e1', contactName: 'Late', status: 'new', consentStatus: 'inferred_enquiry' },
        { ...base, id: 'e2', contactName: 'Stopped', status: 'new', consentStatus: 'unsubscribed' },
      ],
      appointments: [
        { id: 'a1', enquiryId: 'e1', approvalStatus: 'approved', proposedSlots: [], confirmedStartAt: now + 10, confirmedEndAt: null },
      ],
      outcomes: [],
      now,
    });
    expect(today.callBack.map((c) => c.name)).toEqual(['Late']);
    expect(today.upcoming[0]).toMatchObject({ appointmentId: 'a1', startAt: now + 10, endAt: now + 10 + 30 * 60_000 });
    expect(today.scorecard.segments.every((s) => s.enquiries === 0)).toBe(true);
  });
});
