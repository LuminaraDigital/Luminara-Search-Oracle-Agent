import { describe, expect, it, vi } from 'vitest';
import {
  APPROVED_PLAYBOOKS,
  OUTCOME_STAGES,
  buildOpportunityBrief,
  computeExternalEffectKey,
  evaluateInboundEnquiryTurn,
} from '../services/enquiries/playbookQualificationService';
import { recordOutcomeStageEvent, validateOutcomeStageInput } from '../worker/outcomesLedgerService';
import { createBookingProposal } from '../worker/bookingApprovalService';
import {
  composeCompliantRecoveryMessage,
  evaluateRecoveryComplianceGate,
  executeRecoveryStep,
  handleRecoveryRoute,
  sweepDueRecoveryRuns,
} from '../worker/recoveryCampaignService';
import {
  buildTwentyCreateOpportunityMutation,
  buildTwentyCreatePersonMutation,
  splitFullName,
  syncContactToTwenty,
  syncOpportunityToTwenty,
} from '../worker/crmConnectors/twentyAdapter';
import { handleEnquiryDeskRoute, ingestInboundEnquiry } from '../worker/enquiryDeskService';
import { handleMcpRequest } from '../worker/mcpServer';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

const TEST_USER: HostedIdentity = {
  id: 'usr_test_1',
  email: 'agent@harbourrealty.com.au',
  plan: 'agency',
};

describe('Stage 1 & 2: Playbook Qualification, Statutory Guards & Opportunity Briefs', () => {
  it('defines all four approved playbooks without em dashes', () => {
    expect(Object.keys(APPROVED_PLAYBOOKS)).toEqual([
      'seller_appraisal',
      'buyer_enquiry',
      'landlord_management',
      'general_sme',
    ]);
    for (const pb of Object.values(APPROVED_PLAYBOOKS)) {
      expect(pb.name).not.toContain('\u2014');
      for (const q of pb.questions) {
        expect(q.questionPrompt).not.toContain('\u2014');
      }
    }
  });

  it('halts immediately on opt-out keywords (STOP / unsubscribe)', () => {
    const res = evaluateInboundEnquiryTurn({
      intentType: 'seller_appraisal',
      inboundText: 'Please STOP texting me',
      recordedAnswers: {},
      agencyName: 'Harbourside Realty',
    });
    expect(res.action).toBe('instant_unsubscribe');
    expect(res.automationPaused).toBe(true);
    expect(res.suggestedReply).toContain('unsubscribed');
  });

  it('escalates to licensed agent and pauses automation when asked for a statutory property valuation', () => {
    const res = evaluateInboundEnquiryTurn({
      intentType: 'seller_appraisal',
      inboundText: 'How much is my house worth on 14 Ocean St?',
      recordedAnswers: { property_address: '14 Ocean St, Bondi NSW' },
      agencyName: 'Harbourside Realty',
    });
    expect(res.action).toBe('escalate_to_agent');
    expect(res.automationPaused).toBe(true);
    if (res.action === 'escalate_to_agent') {
      expect(res.reason).toContain('Statutory real estate rule');
    }
    expect(res.suggestedReply).toContain('licensed specialist');
  });

  it('steps through approved seller questions and marks ready when all required fields are captured', () => {
    const step1 = evaluateInboundEnquiryTurn({
      intentType: 'seller_appraisal',
      inboundText: 'Hi, looking to get an appraisal',
      recordedAnswers: {},
    });
    expect(step1.action).toBe('continue_playbook');
    if (step1.action === 'continue_playbook') {
      expect(step1.nextQuestion?.fieldKey).toBe('property_address');
    }

    const step2 = evaluateInboundEnquiryTurn({
      intentType: 'seller_appraisal',
      inboundText: 'We are ready in the next 30 days',
      recordedAnswers: {
        property_address: '88 Collins St, Melbourne VIC',
        property_type: '3 bed, 2 bath townhouse',
        timeframe: 'Within 30 days',
        preferred_contact: '0400 111 222',
      },
    });
    expect(step2.action).toBe('continue_playbook');
    if (step2.action === 'continue_playbook') {
      expect(step2.nextQuestion).toBeNull();
      expect(step2.suggestedReply).toContain('appraisal/callback request');
    }
  });

  it('builds an evidence-bound Opportunity Brief backed by ClaimLedger with measured and unknown statuses', () => {
    const brief = buildOpportunityBrief({
      intentType: 'seller_appraisal',
      answers: {
        property_address: { value: '42 Harbour Rd, Sydney NSW', messageId: 'msg_1' },
        timeframe: { value: '1-3 months', messageId: 'msg_2' },
      },
    });

    expect(brief.qualified).toBe(false);
    expect(brief.missingRequiredFields).toEqual(['property_type']);
    expect(brief.nextRecommendedAction).toContain('property_type');

    expect(brief.recordedAnswers.property_address?.status).toBe('measured');
    expect(brief.recordedAnswers.property_address?.value).toBe('42 Harbour Rd, Sydney NSW');
    expect(brief.recordedAnswers.property_type?.status).toBe('unknown');
    expect(brief.recordedAnswers.property_type?.value).toBe('unknown');

    const measuredClaims = brief.claims.filter((c) => c.status === 'measured');
    const unknownClaims = brief.claims.filter((c) => c.status === 'unknown');
    expect(measuredClaims).toHaveLength(2);
    expect(unknownClaims).toHaveLength(2);
  });

  it('computes deterministic Rakazo-style SHA-256 idempotency keys', async () => {
    const key1 = await computeExternalEffectKey({
      accountId: 'usr_1',
      projectId: 'proj_1',
      targetSystem: 'enquiry_desk',
      actionKind: 'inbound_webhook',
      payload: { event: 'lead.created', enquiryId: 'enq_abc' },
    });
    const key2 = await computeExternalEffectKey({
      accountId: 'usr_1',
      projectId: 'proj_1',
      targetSystem: 'enquiry_desk',
      actionKind: 'inbound_webhook',
      payload: { enquiryId: 'enq_abc', event: 'lead.created' },
    });
    expect(key1).toStrictEqual(key2);
    expect(key1.effectKey).toMatch(/^eff_[a-f0-9]{40}$/);
    expect(key1.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Stage 2: 6-Stage Evidence-Bound Outcomes Ledger & Worker Routes', () => {
  it('enforces human evidence on stages 4-6 (agent_approved_booking, attended_appraisal, signed_listing)', () => {
    expect(OUTCOME_STAGES).toHaveLength(6);

    const s1 = validateOutcomeStageInput({
      stage: 'enquiry_received',
      evidenceType: 'webhook_payload',
      evidenceRef: 'wh_01',
    });
    expect(s1.ok).toBe(true);

    const s4Invalid = validateOutcomeStageInput({
      stage: 'agent_approved_booking',
      evidenceType: 'webhook_payload',
      evidenceRef: 'wh_02',
    });
    expect(s4Invalid.ok).toBe(false);
    if (!s4Invalid.ok) {
      expect(s4Invalid.error).toContain('requires human verification evidence');
    }

    const s6Valid = validateOutcomeStageInput({
      stage: 'signed_listing',
      evidenceType: 'staff_confirmation',
      evidenceRef: 'doc_agency_99',
    });
    expect(s6Valid.ok).toBe(true);
  });

  it('serves GET /outcomes and GET /outcomes/funnel with revenueAttributionStatus: not_measured', async () => {
    const req = new Request('https://luminarasuite.com/api/outcomes/funnel?projectId=proj_1', {
      method: 'GET',
    });
    const res = await handleEnquiryDeskRoute(req, {} as Env, TEST_USER, '/outcomes/funnel');
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as {
      ok: boolean;
      funnel: { revenueAttributionStatus: string; countsByStage: Record<string, number> };
    };
    expect(body.ok).toBe(true);
    expect(body.funnel.revenueAttributionStatus).toBe('not_measured');
  });

  it('rejects malformed proposedSlots and unowned enquiryIds in createBookingProposal', async () => {
    const db = createSqliteD1();
    const env = { DB: db } as Env;

    const badSlots = await createBookingProposal(env, {
      accountId: 'usr_test_1',
      projectId: 'proj_au_1',
      enquiryId: 'enq_missing',
      contactId: 'cnt_1',
      assignedAgentId: 'agent_1',
      proposedSlots: [null as unknown as { startAt: number; endAt: number; label: string }],
    });
    expect(badSlots.ok).toBe(false);
    if (!badSlots.ok) {
      expect(badSlots.status).toBe(400);
    }

    const unknownEnquiry = await createBookingProposal(env, {
      accountId: 'usr_test_1',
      projectId: 'proj_au_1',
      enquiryId: 'enq_missing',
      contactId: 'cnt_1',
      assignedAgentId: 'agent_1',
      proposedSlots: [{ slotId: 'slot_1', startAt: 1000, endAt: 2000, label: 'Tue 10am' }],
    });
    expect(unknownEnquiry.ok).toBe(false);
    if (!unknownEnquiry.ok) {
      expect(unknownEnquiry.status).toBe(404);
    }
  });
});

describe('Stage 5: Australian Spam Act 2003, DNCR & State Timezone Recovery Gate', () => {
  it('blocks unsubscribed contacts and contacts without recorded consent', () => {
    const unsub = evaluateRecoveryComplianceGate({
      channel: 'sms',
      consentStatus: 'unsubscribed',
      dncrStatus: 'clear',
      stateTimezone: 'Australia/Sydney',
      agencyLegalName: 'Luminara Realty Pty Ltd',
      agencyContactDetails: '02 9000 0000',
      automationPaused: false,
    });
    expect(unsub.allowed).toBe(false);
    if (!unsub.allowed) {
      expect(unsub.code).toBe('UNSUBSCRIBED_OR_SUPPRESSED');
    }

    const unknownConsent = evaluateRecoveryComplianceGate({
      channel: 'email',
      consentStatus: 'unknown',
      dncrStatus: 'not_checked',
      stateTimezone: 'Australia/Melbourne',
      agencyLegalName: 'Luminara Realty Pty Ltd',
      agencyContactDetails: '03 9000 0000',
      automationPaused: false,
    });
    expect(unknownConsent.allowed).toBe(false);
    if (!unknownConsent.allowed) {
      expect(unknownConsent.code).toBe('MISSING_CONSENT');
    }
  });

  it('blocks voice recovery calls when DNCR is registered', () => {
    const registered = evaluateRecoveryComplianceGate({
      channel: 'voice',
      consentStatus: 'express',
      dncrStatus: 'registered',
      stateTimezone: 'Australia/Sydney',
      agencyLegalName: 'Luminara Realty Pty Ltd',
      agencyContactDetails: '02 9000 0000',
      automationPaused: false,
      nowMs: new Date('2026-10-26T02:00:00Z').getTime(),
    });
    expect(registered.allowed).toBe(false);
    if (!registered.allowed) {
      expect(registered.code).toBe('DNCR_REGISTERED');
    }
  });

  it('enforces Australian state timezone calling hours (9am-8pm Mon-Fri, 9am-5pm Sat, no Sundays)', () => {
    const sunday = evaluateRecoveryComplianceGate({
      channel: 'sms',
      consentStatus: 'express',
      dncrStatus: 'clear',
      stateTimezone: 'Australia/Sydney',
      agencyLegalName: 'Luminara Realty Pty Ltd',
      agencyContactDetails: '02 9000 0000',
      automationPaused: false,
      nowMs: new Date('2026-10-25T03:00:00Z').getTime(),
    });
    expect(sunday.allowed).toBe(false);
    if (!sunday.allowed) {
      expect(sunday.code).toBe('QUIET_HOURS_BLOCKED');
    }

    const mondayAfternoon = evaluateRecoveryComplianceGate({
      channel: 'sms',
      consentStatus: 'express',
      dncrStatus: 'clear',
      stateTimezone: 'Australia/Sydney',
      agencyLegalName: 'Luminara Realty Pty Ltd',
      agencyContactDetails: '02 9000 0000',
      automationPaused: false,
      nowMs: new Date('2026-10-26T02:00:00Z').getTime(),
    });
    expect(mondayAfternoon.allowed).toBe(true);
  });

  it('appends Spam Act sender identity and functional STOP opt-out footer and validates channel at HTTP boundary', async () => {
    const msg = composeCompliantRecoveryMessage({
      bodyText: 'Hi Alex, checking if you still wanted the suburb report?',
      agencyLegalName: 'Harbourside Agents Pty Ltd',
      agencyContactDetails: 'Level 4, 100 George St, Sydney NSW',
      channel: 'sms',
    });
    expect(msg).toContain('Harbourside Agents Pty Ltd');
    expect(msg).toContain('Reply STOP');

    const badChannelReq = new Request('https://luminarasuite.com/api/recovery/send-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'carrier_pigeon', enquiryId: 'enq_1' }),
    });
    const badRes = await handleRecoveryRoute(
      badChannelReq,
      {} as Env,
      TEST_USER,
      '/recovery/send-step',
    );
    expect(badRes?.status).toBe(400);
  });
});

describe('Stage 5: Clean-Room Twenty CRM GraphQL Adapter & SSRF Guard', () => {
  it('splits full names, blocks SSRF metadata/private hosts, and syncs Person + Opportunity over HTTPS GraphQL', async () => {
    expect(splitFullName('Lachlan MacLeod')).toEqual({
      firstName: 'Lachlan',
      lastName: 'MacLeod',
    });

    const personOp = buildTwentyCreatePersonMutation({
      luminaraContactId: 'cnt_1',
      firstName: 'Lachlan',
      lastName: 'MacLeod',
      email: 'lachlan@example.com.au',
      phone: '+61400111222',
      consentStatus: 'express',
    });
    expect(personOp.query).toContain('createPerson');

    const oppOp = buildTwentyCreateOpportunityMutation({
      luminaraEnquiryId: 'enq_1',
      name: 'Seller Appraisal',
      stage: 'QUALIFIED',
      intentType: 'seller_appraisal',
      propertyAddress: '12 River Rd',
    });
    expect(oppOp.query).toContain('createOpportunity');

    // Blocks link-local metadata SSRF (169.254.169.254) via canonical validateCmsEndpoint
    const ssrfBlocked = await syncContactToTwenty(
      { baseUrl: 'https://169.254.169.254', apiKey: 'tok_test_123' },
      {
        luminaraContactId: 'cnt_1',
        firstName: 'Lachlan',
        lastName: 'MacLeod',
        consentStatus: 'express',
      },
    );
    expect(ssrfBlocked.ok).toBe(false);
    expect(ssrfBlocked.error).toContain('private or local');

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { createPerson: { id: 'twenty_person_42' } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { createOpportunity: { id: 'twenty_opp_99' } },
        }),
      });

    const personResult = await syncContactToTwenty(
      { baseUrl: 'https://crm.example.com', apiKey: 'tok_test_123' },
      {
        luminaraContactId: 'cnt_1',
        firstName: 'Lachlan',
        lastName: 'MacLeod',
        email: 'lachlan@example.com.au',
        consentStatus: 'express',
      },
      mockFetch as unknown as typeof fetch,
    );
    expect(personResult.ok).toBe(true);
    expect(personResult.externalId).toBe('twenty_person_42');

    const oppResult = await syncOpportunityToTwenty(
      { baseUrl: 'https://crm.example.com', apiKey: 'tok_test_123' },
      {
        luminaraEnquiryId: 'enq_1',
        name: 'Seller Appraisal',
        stage: 'QUALIFIED',
        intentType: 'seller_appraisal',
        propertyAddress: '12 River Rd',
        contactExternalId: personResult.externalId,
      },
      mockFetch as unknown as typeof fetch,
    );
    expect(oppResult.ok).toBe(true);
    expect(oppResult.externalId).toBe('twenty_opp_99');
  });

  it('executes deterministic no-agent recovery_campaign_sweep cron and exposes Enquiry Desk MCP tools', async () => {
    const db = createSqliteD1();
    const env = {
      DB: db,
      LUMINARA_KV: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      } as unknown as KVNamespace,
    } as Env;

    const ingested = await ingestInboundEnquiry(env, {
      accountId: 'usr_test_1',
      projectId: 'proj_au_1',
      fullName: 'Sienna Vance',
      email: 'sienna@example.com.au',
      phoneE164: '+61412345678',
      stateTimezone: 'Australia/Sydney',
      propertyAddress: '88 Campbell Parade, Bondi Beach NSW 2026',
      intentType: 'seller_appraisal',
      initialMessage: 'Looking to appraise our terrace in Bondi within 60 days.',
      now: new Date('2026-10-26T01:00:00Z').getTime(),
    });
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;

    // Seed an active recovery run on Monday 1pm Sydney time, then sweep on Tuesday 2pm Sydney time
    const monday1pmSydney = new Date('2026-10-26T02:00:00Z').getTime();
    const step1 = await executeRecoveryStep(env, {
      accountId: 'usr_test_1',
      projectId: 'proj_au_1',
      enquiryId: ingested.enquiry.id,
      playbookId: 'missed_enquiry_recovery',
      channel: 'sms',
      stepIndex: 1,
      messageBody: 'Checking in regarding your Bondi appraisal.',
      agencyLegalName: 'Harbourside Agents Pty Ltd',
      agencyContactDetails: '02 9000 1111',
      nowMs: monday1pmSydney,
    });
    expect(step1.ok).toBe(true);

    const sweepRes = await sweepDueRecoveryRuns(env, {
      nowMs: monday1pmSydney + 25 * 3600_000,
      limit: 10,
    });
    expect(sweepRes.evaluated).toBe(1);
    expect(sweepRes.advanced).toBe(1);

    // Verify MCP list_enquiries and get_outcomes_funnel tools
    const mcpListRes = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 101,
          method: 'tools/call',
          params: { name: 'list_enquiries', arguments: { projectId: 'proj_au_1' } },
        }),
      }),
      env,
      TEST_USER,
    );
    const mcpListBody = (await mcpListRes.json()) as {
      result?: { structuredContent?: { count?: number } };
    };
    expect(mcpListBody.result?.structuredContent?.count).toBe(1);

    // Pass 3 regression: buildOpportunityBrief preserves 'unknown' when recordedAnswers have value: 'unknown'
    const partialUnknownBrief = buildOpportunityBrief({
      intentType: 'seller_appraisal',
      answers: {
        property_address: { value: '88 Campbell Parade, Bondi Beach NSW 2026' },
        timeframe: { value: 'unknown' },
        property_type: { value: 'unknown' },
      },
    });
    expect(partialUnknownBrief.qualified).toBe(false);
    expect(partialUnknownBrief.recordedAnswers.timeframe?.status).toBe('unknown');
    expect(partialUnknownBrief.missingRequiredFields).toContain('timeframe');

    // Pass 3 regression: GET /enquiries/appointments, GET /recovery/runs, POST /recovery/evaluate, and outcome_stage_events updating status='booked'
    const apptListRes = await handleEnquiryDeskRoute(
      new Request('https://luminarasuite.com/api/enquiries/appointments?projectId=proj_au_1'),
      env,
      TEST_USER,
      '/enquiries/appointments',
    );
    expect(apptListRes?.status).toBe(200);

    const runsListRes = await handleRecoveryRoute(
      new Request('https://luminarasuite.com/api/recovery/runs?projectId=proj_au_1'),
      env,
      TEST_USER,
      '/recovery/runs',
    );
    expect(runsListRes?.status).toBe(200);
    const runsBody = (await runsListRes!.json()) as { runs: Array<{ enquiryId: string }> };
    expect(runsBody.runs.length).toBeGreaterThanOrEqual(1);

    const evalRes = await handleRecoveryRoute(
      new Request('https://luminarasuite.com/api/recovery/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'sms',
          consentStatus: 'express',
          dncrStatus: 'clear',
          stateTimezone: 'Australia/Sydney',
          agencyLegalName: 'Harbourside Agents Pty Ltd',
          agencyContactDetails: '02 9000 1111',
          automationPaused: false,
          nowMs: monday1pmSydney,
        }),
      }),
      env,
      TEST_USER,
      '/recovery/evaluate',
    );
    expect(evalRes?.status).toBe(200);

    const stageRes = await recordOutcomeStageEvent(env, {
      accountId: 'usr_test_1',
      projectId: 'proj_au_1',
      enquiryId: ingested.enquiry.id,
      stage: 'agent_approved_booking',
      evidenceType: 'agent_signoff_receipt',
      evidenceRef: 'appt_verified_1',
      recordedBy: 'usr_test_1',
    });
    expect(stageRes.ok).toBe(true);
    const updatedRow = await db
      .prepare(`SELECT status FROM enquiries WHERE id = ?`)
      .bind(ingested.enquiry.id)
      .first<{ status: string }>();
    expect(updatedRow?.status).toBe('booked');

    // Pass 4 regression: booking proposal + /decide route + decline reverting status to 'qualified' + selectedSlotIso approval
    const propRes = await createBookingProposal(env, {
      accountId: 'usr_test_1',
      projectId: 'proj_au_1',
      enquiryId: ingested.enquiry.id,
      contactId: '',
      assignedAgentId: 'agent_1',
      proposedSlots: [
        {
          slotId: 'slot_iso_1',
          startAt: monday1pmSydney + 48 * 3600_000,
          endAt: monday1pmSydney + 48 * 3600_000 + 1800_000,
          label: '2026-10-28T02:00:00.000Z',
        },
      ],
      now: monday1pmSydney,
    });
    expect(propRes.ok).toBe(true);
    if (propRes.ok) {
      const declineRes = await handleEnquiryDeskRoute(
        new Request(
          `https://luminarasuite.com/api/enquiries/appointments/${propRes.appointment.id}/decide`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: 'decline' }),
          },
        ),
        env,
        TEST_USER,
        `/enquiries/appointments/${propRes.appointment.id}/decide`,
      );
      expect(declineRes?.status).toBe(200);
      const afterDecline = await db
        .prepare(`SELECT status FROM enquiries WHERE id = ?`)
        .bind(ingested.enquiry.id)
        .first<{ status: string }>();
      expect(afterDecline?.status).toBe('qualified');

      const approveIsoRes = await handleEnquiryDeskRoute(
        new Request(
          `https://luminarasuite.com/api/enquiries/appointments/${propRes.appointment.id}/decide`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              decision: 'approve',
              selectedSlotIso: '2026-10-28T02:00:00.000Z',
            }),
          },
        ),
        env,
        TEST_USER,
        `/enquiries/appointments/${propRes.appointment.id}/decide`,
      );
      expect(approveIsoRes?.status).toBe(200);
    }
  });
});
