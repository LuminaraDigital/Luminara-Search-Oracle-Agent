import { describe, expect, it, vi } from 'vitest';
import { appendEnquiryTurn, handleEnquiryDeskRoute, ingestInboundEnquiry } from '../worker/enquiryDeskService';
import { createBookingProposal } from '../worker/bookingApprovalService';
import { StubGcpTokenProvider } from '../worker/gcpToken';
import { sendAgentPush, signoffMessage } from '../worker/pushNotifyService';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

const notified = vi.hoisted(() => [] as string[]);
vi.mock('../worker/pushNotifyService', async (importActual) => {
  const actual = await importActual<typeof import('../worker/pushNotifyService')>();
  return {
    ...actual,
    notifyAgent: async (_env: unknown, _account: string, message: { kind: string; enquiryId: string }) => {
      notified.push(`${message.kind}:${message.enquiryId}`);
    },
  };
});

const AGENT: HostedIdentity = { id: 'usr_reg_1', email: 'agent@example.com.au', plan: 'agency' };
const SECTION_32 = 'Can you send the Section 32 and can I waive the cooling-off?';

async function today(env: Env) {
  const res = await handleEnquiryDeskRoute(new Request('https://luminarasuite.com/api/enquiries/today'), env, AGENT, '/enquiries/today');
  return (await res!.json()) as { needsSignOff: Array<{ enquiryId: string }>; callBack: Array<{ enquiryId: string }> };
}

describe('Agent Today regressions', () => {
  it('keeps an old pending sign-off on Today when more than 100 newer enquiries exist', async () => {
    const env = { DB: createSqliteD1() } as unknown as Env;
    const now = Date.now();
    const old = await ingestInboundEnquiry(env, {
      accountId: AGENT.id, projectId: 'default', fullName: 'Old Owner', intentType: 'seller_appraisal',
      initialMessage: 'Selling next year.', now: now - 10 * 86_400_000,
    });
    if (!old.ok) throw new Error(old.error);
    await createBookingProposal(env, {
      accountId: AGENT.id, projectId: 'default', enquiryId: old.enquiry.id, contactId: old.enquiry.contactId,
      propertyId: old.enquiry.propertyId, assignedAgentId: AGENT.id,
      proposedSlots: [{ slotId: 'slot_1', startAt: now + 86_400_000, endAt: now + 88_200_000, label: 'Tomorrow 10am' }],
      now: now - 10 * 86_400_000,
    });
    for (let i = 0; i < 105; i++) {
      await ingestInboundEnquiry(env, {
        accountId: AGENT.id, projectId: 'default', fullName: `Buyer ${i}`, intentType: 'buyer_enquiry',
        initialMessage: 'Is this still available?', now: now - i * 1000,
      });
    }
    expect((await today(env)).needsSignOff.map((x) => x.enquiryId)).toContain(old.enquiry.id);
  });

  it('alerts once per escalation, and an agent reply clears the call-back', async () => {
    notified.length = 0;
    const env = { DB: createSqliteD1() } as unknown as Env;
    const buyer = await ingestInboundEnquiry(env, {
      accountId: AGENT.id, projectId: 'default', fullName: 'Pat Buyer', intentType: 'buyer_enquiry', initialMessage: SECTION_32,
    });
    if (!buyer.ok) throw new Error(buyer.error);
    await appendEnquiryTurn(env, { accountId: AGENT.id, enquiryId: buyer.enquiry.id, sender: 'prospect', text: SECTION_32, actorUserId: AGENT.id });
    await appendEnquiryTurn(env, { accountId: AGENT.id, enquiryId: buyer.enquiry.id, sender: 'prospect', text: SECTION_32, actorUserId: AGENT.id });
    expect(notified).toEqual([`callback:${buyer.enquiry.id}`]);
    expect((await today(env)).callBack.map((x) => x.enquiryId)).toEqual([buyer.enquiry.id]);

    await appendEnquiryTurn(env, { accountId: AGENT.id, enquiryId: buyer.enquiry.id, sender: 'agent', text: 'Calling you now.', actorUserId: AGENT.id });
    expect((await today(env)).callBack).toEqual([]);
  });

  it('removes a token FCM rejects as malformed', async () => {
    const env = { DB: createSqliteD1(), FCM_PROJECT_ID: 'luminara-suite' } as unknown as Env;
    await env.DB!.prepare(
      `INSERT INTO push_devices (id, account_id, token, platform, created_at, updated_at) VALUES ('pd_1', ?, 'bad_token_aaaaaaaaaaaaaaaaaaaa', 'android', 1, 1)`,
    ).bind(AGENT.id).run();
    const fetchImpl = vi.fn(async () => new Response('{"error":{"status":"INVALID_ARGUMENT"}}', { status: 400 }));
    await sendAgentPush(env, AGENT.id, signoffMessage('Sam', 'e1', 'a1'), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tokenProvider: new StubGcpTokenProvider(),
    });
    const left = await env.DB!.prepare('SELECT COUNT(*) AS n FROM push_devices').first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
