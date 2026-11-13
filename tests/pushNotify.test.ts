import { describe, expect, it, vi } from 'vitest';
import { createBookingProposal } from '../worker/bookingApprovalService';
import { ingestInboundEnquiry } from '../worker/enquiryDeskService';
import { StubGcpTokenProvider } from '../worker/gcpToken';
import { dismissalOf, handlePushRoute, sendAgentPush, signoffMessage } from '../worker/pushNotifyService';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

const AGENT: HostedIdentity = { id: 'usr_push_1', email: 'agent@example.com.au', plan: 'agency' };
const TOKEN_A = 'fcm_token_aaaaaaaaaaaaaaaaaaaaaaaa:APA91b';
const TOKEN_B = 'fcm_token_bbbbbbbbbbbbbbbbbbbbbbbb:APA91b';

function route(env: Env, method: string, body: unknown) {
  return handlePushRoute(
    new Request('https://luminarasuite.com/api/push/devices', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
    AGENT,
    '/push/devices',
  );
}

function rows(env: Env) {
  return env.DB!.prepare('SELECT token, account_id FROM push_devices ORDER BY token').all<{ token: string; account_id: string }>();
}

describe('push device routes', () => {
  it('upserts, reassigns and deletes a token', async () => {
    const env = { DB: createSqliteD1() } as unknown as Env;
    expect((await route(env, 'POST', { token: TOKEN_A, platform: 'android' }))?.status).toBe(200);
    expect((await route(env, 'POST', { token: TOKEN_A, platform: 'android' }))?.status).toBe(200);
    expect((await rows(env)).results).toHaveLength(1);
    await env.DB!.prepare("UPDATE push_devices SET account_id = 'someone_else'").run();
    await route(env, 'POST', { token: TOKEN_A, platform: 'android' });
    expect((await rows(env)).results?.[0]?.account_id).toBe(AGENT.id);
    expect((await route(env, 'DELETE', { token: TOKEN_A }))?.status).toBe(200);
    expect((await rows(env)).results).toHaveLength(0);
  });

  it('rejects bad tokens and platforms', async () => {
    const env = { DB: createSqliteD1() } as unknown as Env;
    expect((await route(env, 'POST', { token: 'short', platform: 'android' }))?.status).toBe(400);
    expect((await route(env, 'POST', { token: 'has spaces and is long enough ok', platform: 'android' }))?.status).toBe(400);
    expect((await route(env, 'POST', { token: TOKEN_A, platform: 'ios' }))?.status).toBe(400);
    expect((await route(env, 'DELETE', {}))?.status).toBe(400);
  });

  it('keeps at most 10 devices per account, dropping the oldest', async () => {
    const env = { DB: createSqliteD1() } as unknown as Env;
    for (let i = 0; i < 12; i++) {
      const token = `fcm_token_${String(i).padStart(2, '0')}_xxxxxxxxxxxxxxxx`;
      await route(env, 'POST', { token, platform: 'android' });
      await env.DB!.prepare('UPDATE push_devices SET updated_at = ? WHERE token = ?').bind(1000 + i, token).run();
    }
    await route(env, 'POST', { token: 'fcm_token_99_xxxxxxxxxxxxxxxx', platform: 'android' });
    const left = (await rows(env)).results ?? [];
    expect(left).toHaveLength(10);
    expect(left.some((r) => r.token.startsWith('fcm_token_00'))).toBe(false);
    expect(left.some((r) => r.token.startsWith('fcm_token_99'))).toBe(true);
  });
});

describe('sendAgentPush', () => {
  async function seeded() {
    const env = { DB: createSqliteD1(), FCM_PROJECT_ID: 'luminara-suite' } as unknown as Env;
    await route(env, 'POST', { token: TOKEN_A, platform: 'android' });
    await route(env, 'POST', { token: TOKEN_B, platform: 'android' });
    return env;
  }

  it('posts an FCM v1 request per device with a private-by-default body', async () => {
    const env = await seeded();
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await sendAgentPush(env, AGENT.id, signoffMessage('Sam Owner', 'enq_1', 'appt_1'), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tokenProvider: new StubGcpTokenProvider('tok'),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://fcm.googleapis.com/v1/projects/luminara-suite/messages:send');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const sent = JSON.parse(String(init.body)).message;
    expect(sent.notification).toEqual({ title: 'Needs your sign-off', body: 'Sam wants an appraisal. Tap to approve a time.' });
    expect(sent.data).toEqual({
      kind: 'signoff',
      enquiryId: 'enq_1',
      appointmentId: 'appt_1',
      open: 'today',
      tag: 'signoff:enq_1',
    });
    expect(sent.android).toEqual({ notification: { channel_id: 'agent_signoff', tag: 'signoff:enq_1' } });
    expect(String(init.body)).not.toContain('Owner');
  });

  it('a dismissal is data only, so no phone shows text for it', async () => {
    const env = await seeded();
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    await sendAgentPush(env, AGENT.id, dismissalOf('signoff', 'enq_1'), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tokenProvider: new StubGcpTokenProvider('tok'),
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(String(init.body)).message;
    expect(sent.data).toEqual({ kind: 'dismiss', tag: 'signoff:enq_1' });
    expect(sent.notification).toBeUndefined();
    expect(sent.android).toBeUndefined();
  });

  it('deletes tokens FCM reports as unregistered and keeps others with last_error', async () => {
    const env = await seeded();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) =>
      String(init.body).includes(TOKEN_A)
        ? new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 })
        : new Response('{}', { status: 500 }),
    );
    await sendAgentPush(env, AGENT.id, signoffMessage('Sam', 'e', 'a'), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tokenProvider: new StubGcpTokenProvider(),
    });
    const left = await env.DB!.prepare('SELECT token, last_error FROM push_devices').all<{ token: string; last_error: string | null }>();
    expect(left.results).toEqual([{ token: TOKEN_B, last_error: 'fcm 500' }]);
  });

  it('is a silent no-op when FCM_PROJECT_ID or Workload Identity is missing', async () => {
    const fetchImpl = vi.fn();
    const noProject = await seeded();
    delete (noProject as { FCM_PROJECT_ID?: string }).FCM_PROJECT_ID;
    await sendAgentPush(noProject, AGENT.id, signoffMessage('Sam', 'e', 'a'), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      tokenProvider: new StubGcpTokenProvider(),
    });
    const noWif = await seeded();
    await expect(
      sendAgentPush(noWif, AGENT.id, signoffMessage('Sam', 'e', 'a'), { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws when the token provider fails', async () => {
    const env = await seeded();
    const failing = {
      getAccessToken: async (): Promise<string> => {
        throw new Error('boom');
      },
    };
    await expect(sendAgentPush(env, AGENT.id, signoffMessage('Sam', 'e', 'a'), { tokenProvider: failing })).resolves.toBeUndefined();
  });
});

describe('triggers', () => {
  it('booking proposal and escalation still succeed with push unconfigured', async () => {
    const env = { DB: createSqliteD1() } as unknown as Env;
    const now = Date.now();
    const seller = await ingestInboundEnquiry(env, {
      accountId: AGENT.id,
      projectId: 'default',
      fullName: 'Sam Owner',
      phoneE164: '+61412345678',
      propertyAddress: '12 Example St',
      intentType: 'seller_appraisal',
      initialMessage: 'Thinking of selling.',
      now,
    });
    const esc = await ingestInboundEnquiry(env, {
      accountId: AGENT.id,
      projectId: 'default',
      fullName: 'Pat Buyer',
      email: 'pat@example.com.au',
      intentType: 'buyer_enquiry',
      initialMessage: 'Send the Section 32 and can I waive the cooling-off?',
      now,
    });
    expect(seller.ok && esc.ok).toBe(true);
    if (!seller.ok) return;
    const p = await createBookingProposal(env, {
      accountId: AGENT.id,
      projectId: 'default',
      enquiryId: seller.enquiry.id,
      contactId: seller.enquiry.contactId,
      assignedAgentId: AGENT.id,
      proposedSlots: [{ slotId: 's1', startAt: now + 1e8, endAt: now + 1.01e8 }],
    });
    expect(p.ok).toBe(true);
  });
});
