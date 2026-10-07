import { describe, it, expect, beforeEach, vi } from 'vitest';
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import {
  handleLaunchpadRoute,
  isLaunchpadEnabled,
  validateCampaignBody,
  dispatchMilestoneAlerts,
  type LaunchpadDeps,
} from '../worker/launchpadService';
import { ESCROW_ABI } from '../services/launchpad/abi';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';

const merchant: HostedIdentity = { id: 'fb:merchant', source: 'firebase', accountId: 'acct-merchant' };
const other: HostedIdentity = { id: 'fb:other', source: 'firebase', accountId: 'acct-other' };
const anon = { user: null };
const as = (user: HostedIdentity) => ({ user });

const CONTRACT = '0x1111111111111111111111111111111111111111';

const loyaltyBody = {
  businessName: 'Brisbane Wellness Studio',
  title: 'Yoga class pass vouchers',
  description: 'Each voucher is redeemable for one yoga or pilates class session at our studio, booked in store or online.',
  campaignType: 'closed_loop_loyalty',
  domain: 'https://BrisbaneWellness.com.au/classes',
  targetFiatCents: 200000,
  voucherExpiryMonths: 36,
  termsAccepted: true,
};

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://app.test/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(
  env: Env,
  who: { user: HostedIdentity | null; error?: string },
  method: string,
  path: string,
  body?: unknown,
  deps?: LaunchpadDeps,
) {
  const res = await handleLaunchpadRoute(req(method, path, body), env, who, path.split('?')[0], deps);
  expect(res).not.toBeNull();
  return { status: res!.status, data: (await res!.json()) as any };
}

describe('launchpad Worker routes (real SQLite + migration 0018)', () => {
  let db: SqliteD1;
  let env: Env;

  beforeEach(() => {
    db = createSqliteD1();
    env = { DB: db, LAUNCHPAD_SKIP_CHAIN_VERIFY: 'true' } as unknown as Env;
  });

  async function createListed(user = merchant) {
    const created = await call(env, as(user), 'POST', '/launchpad/campaigns', loyaltyBody);
    expect(created.status).toBe(200);
    const id = created.data.campaignId as string;
    const reg = await call(env, as(user), 'PUT', `/launchpad/campaigns/${id}/contract`, { contractAddress: CONTRACT });
    expect(reg.status).toBe(200);
    return id;
  }

  it('ignores unrelated paths and is fail-closed by environment', async () => {
    expect(await handleLaunchpadRoute(req('GET', '/launchpadx'), env, anon, '/launchpadx')).toBeNull();
    expect(isLaunchpadEnabled({})).toBe(true);
    expect(isLaunchpadEnabled({ LAUNCHPAD_ENABLED: 'false' })).toBe(false);
    expect(isLaunchpadEnabled({ ENVIRONMENT: 'production' })).toBe(false);
    expect(isLaunchpadEnabled({ ENVIRONMENT: 'production', LAUNCHPAD_ENABLED: 'true' })).toBe(true);
    const prod = { ...env, ENVIRONMENT: 'production' } as Env;
    expect((await call(prod, anon, 'GET', '/launchpad/campaigns')).status).toBe(404);
  });

  it('screens copy publicly and validates input', async () => {
    const ok = await call(env, anon, 'POST', '/launchpad/scan-compliance', loyaltyBody);
    expect(ok.status).toBe(200);
    expect(ok.data.report.approved).toBe(true);
    const bad = await call(env, anon, 'POST', '/launchpad/scan-compliance', { title: 'x' });
    expect(bad.status).toBe(400);
  });

  it('requires auth and accepted terms to create', async () => {
    expect((await call(env, anon, 'POST', '/launchpad/campaigns', loyaltyBody)).status).toBe(401);
    expect((await call(env, { user: null, error: 'CSRF validation failed' }, 'POST', '/launchpad/campaigns', loyaltyBody)).data.error)
      .toContain('CSRF');
    expect((await call(env, as(merchant), 'POST', '/launchpad/campaigns', { ...loyaltyBody, termsAccepted: false })).status).toBe(400);
  });

  it('rejects investment copy with 422 and writes nothing', async () => {
    const r = await call(env, as(merchant), 'POST', '/launchpad/campaigns', {
      ...loyaltyBody, description: `${loyaltyBody.description} Earn 50% passive income and quarterly dividends.`,
    });
    expect(r.status).toBe(422);
    expect(r.data.compliance.status).toBe('rejected');
    expect(db.sqlite.prepare('SELECT COUNT(*) n FROM launchpad_campaigns').get().n).toBe(0);
  });

  it('creates a draft that is private until a contract is registered', async () => {
    const created = await call(env, as(merchant), 'POST', '/launchpad/campaigns', loyaltyBody);
    expect(created.data.listed).toBe(false);
    const id = created.data.campaignId;
    const row = db.sqlite.prepare('SELECT domain FROM launchpad_campaigns WHERE id = ?').get(id);
    expect(row.domain).toBe('brisbanewellness.com.au');

    expect((await call(env, anon, 'GET', '/launchpad/campaigns')).data.campaigns).toHaveLength(0);
    expect((await call(env, anon, 'GET', `/launchpad/campaigns/${id}`)).status).toBe(404);
    expect((await call(env, as(merchant), 'GET', `/launchpad/campaigns/${id}`)).status).toBe(200);
    expect((await call(env, as(merchant), 'GET', '/launchpad/campaigns?mine=true')).data.campaigns).toHaveLength(1);

    // Only the owner can register, only once, only a valid address.
    expect((await call(env, as(other), 'PUT', `/launchpad/campaigns/${id}/contract`, { contractAddress: CONTRACT })).status).toBe(404);
    expect((await call(env, as(merchant), 'PUT', `/launchpad/campaigns/${id}/contract`, { contractAddress: '0x12' })).status).toBe(400);
    expect((await call(env, as(merchant), 'PUT', `/launchpad/campaigns/${id}/contract`, { contractAddress: CONTRACT })).status).toBe(200);
    expect((await call(env, as(merchant), 'PUT', `/launchpad/campaigns/${id}/contract`, { contractAddress: CONTRACT })).status).toBe(409);

    const pub = await call(env, anon, 'GET', '/launchpad/campaigns');
    expect(pub.data.campaigns).toHaveLength(1);
    expect(pub.data.campaigns[0]).not.toHaveProperty('account_id');
    expect(pub.data.campaigns[0]).not.toHaveProperty('abn_nzbn');
  });

  it('refuses to register one contract address to two campaigns', async () => {
    await createListed();
    const second = await call(env, as(other), 'POST', '/launchpad/campaigns', loyaltyBody);
    const r = await call(env, as(other), 'PUT', `/launchpad/campaigns/${second.data.campaignId}/contract`, { contractAddress: CONTRACT });
    expect(r.status).toBe(409);
  });

  it('stores milestones atomically for pre-orders', async () => {
    const r = await call(env, as(merchant), 'POST', '/launchpad/campaigns', {
      ...loyaltyBody,
      campaignType: 'milestone_preorder',
      milestones: [{ title: 'Stock purchased', payoutPercentage: 30 }, { title: 'Delivered', payoutPercentage: 70 }],
    });
    expect(r.status).toBe(200);
    const detail = await call(env, as(merchant), 'GET', `/launchpad/campaigns/${r.data.campaignId}`);
    expect(detail.data.milestones.map((m: any) => m.payout_percentage)).toEqual([30, 70]);
  });

  it('blocks mainnet unless the flag is set', async () => {
    const r = await call(env, as(merchant), 'POST', '/launchpad/campaigns', { ...loyaltyBody, network: 'mainnet' });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain('Mainnet');
  });

  it('only the campaign owner can issue, look up and redeem vouchers; redemption is single-use', async () => {
    const id = await createListed();

    expect((await call(env, anon, 'POST', '/launchpad/vouchers', { campaignId: id, itemDescription: 'One class' })).status).toBe(401);
    expect((await call(env, as(other), 'POST', '/launchpad/vouchers', { campaignId: id, itemDescription: 'One class' })).status).toBe(404);

    const issued = await call(env, as(merchant), 'POST', '/launchpad/vouchers', { campaignId: id, itemDescription: 'One class' });
    expect(issued.status).toBe(200);
    const code = issued.data.voucherCode as string;
    expect(code).toMatch(/^VCH-/);
    expect(issued.data.expiresAt).toBeTruthy();

    expect((await call(env, anon, 'GET', `/launchpad/vouchers/${code}`)).status).toBe(401);
    expect((await call(env, as(other), 'GET', `/launchpad/vouchers/${code}`)).status).toBe(404);
    const look = await call(env, as(merchant), 'GET', `/launchpad/vouchers/${code}`);
    expect(look.data.voucher).toMatchObject({ status: 'issued', item_description: 'One class' });

    expect((await call(env, as(other), 'POST', '/launchpad/vouchers/redeem', { voucherCode: code })).status).toBe(404);

    // Concurrent double-redeem: exactly one wins.
    const [a, b] = await Promise.all([
      call(env, as(merchant), 'POST', '/launchpad/vouchers/redeem', { voucherCode: code }),
      call(env, as(merchant), 'POST', '/launchpad/vouchers/redeem', { voucherCode: code }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('will not issue vouchers before the contract is registered and rejects expired vouchers', async () => {
    const draft = await call(env, as(merchant), 'POST', '/launchpad/campaigns', loyaltyBody);
    const r = await call(env, as(merchant), 'POST', '/launchpad/vouchers', { campaignId: draft.data.campaignId, itemDescription: 'x' });
    expect(r.status).toBe(409);

    const id = await createListed(other);
    const issued = await call(env, as(other), 'POST', '/launchpad/vouchers', { campaignId: id, itemDescription: 'One class' });
    db.sqlite.prepare("UPDATE launchpad_vouchers SET expires_at = '2000-01-01T00:00:00.000Z' WHERE voucher_code = ?").run(issued.data.voucherCode);
    expect((await call(env, as(other), 'POST', '/launchpad/vouchers/redeem', { voucherCode: issued.data.voucherCode })).status).toBe(410);
  });

  it('validates fields at the trust boundary', () => {
    const v = (over: Record<string, unknown>) => validateCampaignBody({ ...loyaltyBody, ...over }, {});
    expect(typeof v({})).toBe('object');
    expect(v({ voucherExpiryMonths: 12 })).toContain('3 years');
    expect(v({ targetFiatCents: 1.5 })).toContain('whole number');
    expect(v({ tokenSymbol: 'TOO-LONG-SYMBOL' })).toContain('tokenSymbol');
    expect(v({ abnNzbn: '123' })).toContain('ABN');
    expect(v({ domain: 'not a domain' })).toContain('domain');
    expect(v({ chain: 'solana' })).toContain('chain');
    expect(v({ campaignType: 'ico' })).toContain('campaignType');
    expect(v({ campaignType: 'milestone_preorder', milestones: new Array(11).fill({ title: 'x', payoutPercentage: 9 }) })).toContain('milestones');
  });

  async function createListedPreorder(user = merchant) {
    const preorderBody = {
      ...loyaltyBody,
      campaignType: 'milestone_preorder',
      milestones: [{ title: 'Milestone 1', payoutPercentage: 50 }, { title: 'Milestone 2', payoutPercentage: 50 }],
    };
    const created = await call(env, as(user), 'POST', '/launchpad/campaigns', preorderBody);
    expect(created.status).toBe(200);
    const id = created.data.campaignId as string;
    const reg = await call(env, as(user), 'PUT', `/launchpad/campaigns/${id}/contract`, { contractAddress: CONTRACT });
    expect(reg.status).toBe(200);
    return id;
  }

  function mockEscrowRpc(overrides: Record<string, unknown> = {}): (chain: 'xdc' | 'polygon', network: 'testnet' | 'mainnet') => (method: string, params: unknown[]) => Promise<unknown> {
    const values: Record<string, unknown> = {
      state: 1,
      totalPledged: 5n,
      totalDisbursed: 0n,
      totalRefunded: 0n,
      softCap: 3n,
      hardCap: 10n,
      fundingDeadline: 100n,
      deliveryDeadline: 200n,
      currentMilestone: 0n,
      milestoneCount: 2n,
      merchant: '0x4444444444444444444444444444444444444444',
      ...overrides,
    };
    return () => async (method, params) => {
      const { data } = (params as [{ data: Hex }, string])[0];
      const { functionName } = decodeFunctionData({ abi: ESCROW_ABI, data });
      if (functionName === 'milestones') {
        const submitted = overrides.submitted !== undefined ? Boolean(overrides.submitted) : false;
        return encodeFunctionResult({
          abi: ESCROW_ABI,
          functionName: 'milestones',
          result: [5000, submitted, false, 999999n, '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex, 0n, 'https://proof.example.com'],
        });
      }
      return encodeFunctionResult({ abi: ESCROW_ABI, functionName: functionName as 'state', result: values[functionName] as never });
    };
  }

  it('handles backer subscriptions and unsubscriptions with channel format validation', async () => {
    const draft = await call(env, as(merchant), 'POST', '/launchpad/campaigns', loyaltyBody);
    expect((await call(env, anon, 'POST', `/launchpad/campaigns/${draft.data.campaignId}/subscribe`, { subscriberRef: 'backer@example.com', channel: 'email' })).status).toBe(404);

    const id = await createListed();

    // Valid subscriptions across channels
    const emailSub = await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: 'backer@example.com.au', channel: 'email' });
    expect(emailSub.status).toBe(200);
    expect(emailSub.data).toMatchObject({ ok: true, campaignId: id, subscriberRef: 'backer@example.com.au', channel: 'email' });

    const tgSub = await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: '@community_rep', channel: 'telegram' });
    expect(tgSub.status).toBe(200);

    const hookSub = await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: 'https://audit.example.com/hook', channel: 'webhook' });
    expect(hookSub.status).toBe(200);

    // Channel and format validation
    expect((await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: 'invalid', channel: 'sms' })).status).toBe(400);
    expect((await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: 'not-an-email', channel: 'email' })).status).toBe(400);
    expect((await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: 'bad handle!', channel: 'telegram' })).status).toBe(400);
    expect((await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: 'http://insecure.test', channel: 'webhook' })).status).toBe(400);

    // Duplicate subscription upserts without duplicating
    await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: 'backer@example.com.au', channel: 'email', walletAddress: '0x1234567890123456789012345678901234567890' });
    const countRow = db.sqlite.prepare('SELECT COUNT(*) n FROM launchpad_subscriptions WHERE campaign_id = ?').get(id) as { n: number };
    expect(countRow.n).toBe(3);

    // Unsubscribe
    expect((await call(env, anon, 'POST', `/launchpad/campaigns/${id}/unsubscribe`, {})).status).toBe(400);
    const unsub = await call(env, anon, 'POST', `/launchpad/campaigns/${id}/unsubscribe`, { subscriberRef: 'backer@example.com.au' });
    expect(unsub.status).toBe(200);
    expect(unsub.data.removed).toBe(true);

    const afterCount = db.sqlite.prepare('SELECT COUNT(*) n FROM launchpad_subscriptions WHERE campaign_id = ? AND subscriber_ref = ?').get(id, 'backer@example.com.au') as { n: number };
    expect(afterCount.n).toBe(0);
  });

  it('caches onchain snapshots and serves cached figures within 30s', async () => {
    const id = await createListedPreorder();
    let rpcCalls = 0;
    const mockRpc = mockEscrowRpc();
    const trackingDeps: LaunchpadDeps = {
      rpcFor: (chain, network) => {
        rpcCalls++;
        return mockRpc(chain, network);
      },
    };

    // First call reads chain and writes snapshot to D1
    const first = await call(env, anon, 'GET', `/launchpad/campaigns/${id}/onchain`, undefined, trackingDeps);
    expect(first.status).toBe(200);
    expect(first.data.cached).toBe(false);
    expect(first.data.onchain.state).toBe('Active');
    expect(rpcCalls).toBe(1);

    const snapRow = db.sqlite.prepare('SELECT * FROM launchpad_snapshots WHERE campaign_id = ?').get(id) as { state: string; current_milestone: number };
    expect(snapRow.state).toBe('Active');
    expect(snapRow.current_milestone).toBe(0);

    // Second call within 30s serves from cache without hitting RPC
    const second = await call(env, anon, 'GET', `/launchpad/campaigns/${id}/onchain`, undefined, trackingDeps);
    expect(second.status).toBe(200);
    expect(second.data.cached).toBe(true);
    expect(second.data.onchain.state).toBe('Active');
    expect(rpcCalls).toBe(1);

    // Fresh query forces re-query
    const fresh = await call(env, anon, 'GET', `/launchpad/campaigns/${id}/onchain?fresh=true`, undefined, trackingDeps);
    expect(fresh.status).toBe(200);
    expect(fresh.data.cached).toBe(false);
    expect(rpcCalls).toBe(2);

    // If RPC fails later, cached snapshot is returned gracefully
    const failingDeps: LaunchpadDeps = {
      rpcFor: () => async () => { throw new Error('RPC outage'); },
    };
    const fallback = await call(env, anon, 'GET', `/launchpad/campaigns/${id}/onchain?fresh=true`, undefined, failingDeps);
    expect(fallback.status).toBe(200);
    expect(fallback.data.cached).toBe(true);
    expect(fallback.data.onchain.state).toBe('Active');
  });

  it('dispatches backer alerts when milestone proof is submitted and tracks last_notified_milestone', async () => {
    const id = await createListedPreorder();
    await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: 'subscriber@test.com', channel: 'email' });

    // Call onchain when milestone proof has been submitted
    const submittedDeps: LaunchpadDeps = { rpcFor: mockEscrowRpc({ submitted: true }) };
    const res = await call(env, anon, 'GET', `/launchpad/campaigns/${id}/onchain`, undefined, submittedDeps);
    expect(res.status).toBe(200);
    expect(res.data.onchain.currentMilestoneDetails.submitted).toBe(true);

    const snap = db.sqlite.prepare('SELECT last_notified_milestone FROM launchpad_snapshots WHERE campaign_id = ?').get(id) as { last_notified_milestone: number };
    expect(snap.last_notified_milestone).toBe(0);
  });

  it('dispatchMilestoneAlerts handles telegram, webhook, and email channels resiliently', async () => {
    const id = await createListedPreorder();
    await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: 'backer@example.com', channel: 'email' });
    await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: 'https://webhook.site/test', channel: 'webhook' });
    await call(env, anon, 'POST', `/launchpad/campaigns/${id}/subscribe`, { subscriberRef: '@tester', channel: 'telegram' });

    const payload = {
      campaignId: id,
      campaignTitle: 'Custom tote bag pre-order',
      businessName: 'Gold Coast Print Co',
      milestoneIndex: 0,
      challengeEndsAt: 1800000000,
      proofUri: 'https://ipfs.io/ipfs/QmExample',
    };

    // With TELEGRAM_BOT_TOKEN set and mock fetch
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const res = await dispatchMilestoneAlerts({ ...env, TELEGRAM_BOT_TOKEN: 'fake-token' } as Env, id, payload);
      expect(res.dispatched).toBe(3);
      expect(res.errors).toBe(0);
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }

    // Handles fetch error gracefully without throwing
    const failingFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', failingFetch);
    try {
      const res = await dispatchMilestoneAlerts({ ...env, TELEGRAM_BOT_TOKEN: 'fake-token' } as Env, id, payload);
      // Email doesn't call fetch, telegram and webhook fail gracefully
      expect(res.dispatched).toBe(1);
      expect(res.errors).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
