import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, decodeFunctionData, type Hex } from 'viem';
import { ESCROW_ABI, FACTORY_ABI, TOKEN_ABI } from '../services/launchpad/abi';
import {
  makeRpc,
  readEscrowSnapshot,
  resolveFactoryAddress,
  resolveRpcUrl,
  verifyDeployment,
  type RpcCall,
} from '../services/launchpad/chainVerify';
import { handleLaunchpadRoute } from '../worker/launchpadService';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

const FACTORY = '0x2222222222222222222222222222222222222222';
const ESCROW = '0x3333333333333333333333333333333333333333';
const MERCHANT = '0x4444444444444444444444444444444444444444';
const TX = `0x${'ab'.repeat(32)}`;

function escrowLog(escrow = ESCROW, factory = FACTORY) {
  const topics = encodeEventTopics({
    abi: FACTORY_ABI,
    eventName: 'PreorderEscrowDeployed',
    args: { escrowAddress: escrow as Hex, merchant: MERCHANT as Hex },
  });
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [1n, 2n, 3n, 4n, 86400n],
  );
  return { address: factory, topics, data };
}

const okReceipt = (logs = [escrowLog()]) => ({ status: '0x1', logs });

describe('ABI stays in sync with contracts/src', () => {
  const src = (name: string) => readFileSync(`contracts/src/${name}.sol`, 'utf8');
  const cases: Array<[string, readonly { type: string; name?: string }[], string]> = [
    ['MerchantLaunchFactory', FACTORY_ABI as never, src('MerchantLaunchFactory')],
    ['MilestonePreorderEscrow', ESCROW_ABI as never, src('MilestonePreorderEscrow')],
    ['LoyaltyVoucherToken', TOKEN_ABI as never, src('LoyaltyVoucherToken')],
  ];
  for (const [name, abi, source] of cases) {
    it(`${name}: every ABI function, event and error exists in the Solidity source`, () => {
      for (const item of abi) {
        if (item.type === 'constructor' || !item.name) continue;
        const n = item.name;
        const found =
          item.type === 'function'
            ? new RegExp(`function\\s+${n}\\s*\\(|\\b${n}\\s*(;|=)|\\s${n}\\s*\\(`).test(source) || source.includes(` public ${n}`) || source.includes(` ${n};`)
            : new RegExp(`${item.type}\\s+${n}\\b`).test(source);
        expect(found, `${name}.${item.type} ${n}`).toBe(true);
      }
    });
  }

  // Exact check (signatures, not just names) whenever `npx hardhat compile` has been run in contracts/.
  const artifactFor = (c: string) => `contracts/artifacts/src/${c}.sol/${c}.json`;
  for (const [name, abi] of cases) {
    it.skipIf(!existsSync(artifactFor(name)))(`${name}: function and event signatures match the compiled artifact`, () => {
      const compiled = JSON.parse(readFileSync(artifactFor(name), 'utf8')).abi as Array<{ type: string; name?: string; inputs?: Array<{ type: string }> }>;
      const sig = (i: { name?: string; inputs?: Array<{ type: string }> }) => `${i.name}(${(i.inputs ?? []).map((x) => x.type).join(',')})`;
      for (const item of abi as Array<{ type: string; name?: string; inputs?: Array<{ type: string }> }>) {
        if (item.type !== 'function' && item.type !== 'event') continue;
        const match = compiled.some((c) => c.type === item.type && sig(c) === sig(item));
        expect(match, `${name} ${item.type} ${sig(item)}`).toBe(true);
      }
    });
  }
});

describe('verifyDeployment', () => {
  const run = (receipt: unknown, over: Partial<Parameters<typeof verifyDeployment>[0]> = {}) =>
    verifyDeployment({
      rpc: async () => receipt,
      factoryAddress: FACTORY,
      txHash: TX,
      contractAddress: ESCROW,
      kind: 'preorder_escrow',
      ...over,
    });

  it('accepts a successful deployment from our factory and returns the merchant wallet', async () => {
    expect(await run(okReceipt())).toEqual({ contractAddress: ESCROW, merchantWallet: MERCHANT });
  });
  it('rejects pending, failed, wrong-factory, wrong-address and wrong-kind transactions', async () => {
    expect(await run(null)).toContain('not found');
    expect(await run({ status: '0x0', logs: [] })).toContain('failed');
    expect(await run(okReceipt([escrowLog(ESCROW, '0x9999999999999999999999999999999999999999')]))).toContain('did not deploy');
    expect(await run(okReceipt([escrowLog('0x5555555555555555555555555555555555555555')]))).toContain('did not deploy');
    expect(await run(okReceipt(), { kind: 'loyalty_token' })).toContain('did not deploy');
    expect(await run({ status: '0x1', logs: [{ address: FACTORY, topics: ['0x00'], data: '0x' }] })).toContain('did not deploy');
  });
  it('reports RPC outage instead of throwing', async () => {
    const r = await verifyDeployment({
      rpc: async () => { throw new Error('boom'); },
      factoryAddress: FACTORY, txHash: TX, contractAddress: ESCROW, kind: 'preorder_escrow',
    });
    expect(r).toContain('Could not reach');
  });
});

function escrowRpc(overrides: Record<string, unknown> = {}): RpcCall {
  const values: Record<string, unknown> = {
    state: 0, totalPledged: 5n, totalDisbursed: 0n, totalRefunded: 0n, softCap: 3n, hardCap: 10n,
    fundingDeadline: 100n, deliveryDeadline: 200n, currentMilestone: 0n, milestoneCount: 2n, merchant: MERCHANT,
    ...overrides,
  };
  return async (method, params) => {
    expect(method).toBe('eth_call');
    const { data } = (params[0] as { data: Hex });
    const { functionName } = decodeFunctionData({ abi: ESCROW_ABI, data });
    return encodeFunctionResult({ abi: ESCROW_ABI, functionName: functionName as 'state', result: values[functionName] as never });
  };
}

describe('readEscrowSnapshot', () => {
  it('reads live figures', async () => {
    const s = await readEscrowSnapshot(escrowRpc({ state: 1 }), ESCROW);
    expect(s).toMatchObject({ state: 'Active', totalPledgedWei: '5', softCapWei: '3', milestoneCount: 2, merchant: MERCHANT });
  });
  it('rejects bad address and unknown state', async () => {
    await expect(readEscrowSnapshot(escrowRpc(), 'nope')).rejects.toThrow();
    await expect(readEscrowSnapshot(escrowRpc({ state: 9 }), ESCROW)).rejects.toThrow('state');
  });
});

describe('config resolution', () => {
  it('only allows env factory override on testnet', () => {
    expect(resolveFactoryAddress('xdc', 'testnet', { LAUNCHPAD_FACTORY_XDC_TESTNET: FACTORY })).toBe(FACTORY);
    expect(resolveFactoryAddress('xdc', 'mainnet', { LAUNCHPAD_FACTORY_XDC_MAINNET: FACTORY })).toBeNull();
    expect(resolveFactoryAddress('polygon', 'testnet', {})).toBeNull();
  });
  it('prefers a valid https RPC env and falls back to defaults', () => {
    expect(resolveRpcUrl('xdc', 'testnet', { LAUNCHPAD_RPC_XDC_TESTNET: 'https://rpc.example' })).toBe('https://rpc.example');
    expect(resolveRpcUrl('xdc', 'testnet', { LAUNCHPAD_RPC_XDC_TESTNET: 'http://insecure' })).toContain('apothem');
  });
  it('makeRpc surfaces HTTP and JSON-RPC errors', async () => {
    const mk = (res: Response) => makeRpc('https://x', (async () => res) as unknown as typeof fetch);
    expect(await mk(new Response(JSON.stringify({ result: '0x1' })))('eth_chainId', [])).toBe('0x1');
    await expect(mk(new Response('no', { status: 500 }))('a', [])).rejects.toThrow('500');
    await expect(mk(new Response(JSON.stringify({ error: { message: 'bad' } })))('a', [])).rejects.toThrow('bad');
  });
});

describe('launchpad routes with chain verification', () => {
  const merchant: HostedIdentity = { id: 'fb:m', source: 'firebase', accountId: 'acct-m' };
  const who = { user: merchant };
  const body = {
    businessName: 'Gold Coast Print Co', title: 'Custom tote bag pre-order',
    description: 'Pre-order a printed tote bag. Delivered to you once each production milestone is complete.',
    campaignType: 'milestone_preorder', domain: 'goldcoastprint.com.au', targetFiatCents: 500000, voucherExpiryMonths: 36, termsAccepted: true,
    milestones: [{ title: 'Print run', payoutPercentage: 50 }, { title: 'Delivery', payoutPercentage: 50 }],
  };
  let env: Env;
  const call = async (method: string, path: string, b?: unknown, deps = {}) => {
    const res = await handleLaunchpadRoute(
      new Request(`https://app.test/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }),
      env, who, path.split('?')[0], deps,
    );
    return { status: res!.status, data: (await res!.json()) as any };
  };
  beforeEach(() => {
    env = { DB: createSqliteD1(), LAUNCHPAD_FACTORY_XDC_TESTNET: FACTORY } as unknown as Env;
  });

  it('lists only after a verified factory deployment, and serves on-chain numbers', async () => {
    const created = await call('POST', '/launchpad/campaigns', body);
    expect(created.status).toBe(200);
    const id = created.data.campaignId as string;
    const path = `/launchpad/campaigns/${id}/contract`;

    expect((await call('PUT', path, { contractAddress: ESCROW })).status).toBe(400); // txHash required
    const bad = await call('PUT', path, { contractAddress: ESCROW, txHash: TX }, { rpcFor: () => async () => okReceipt([escrowLog('0x5555555555555555555555555555555555555555')]) });
    expect(bad.status).toBe(422);
    const ok = await call('PUT', path, { contractAddress: ESCROW, txHash: TX }, { rpcFor: () => async () => okReceipt() });
    expect(ok.status).toBe(200);
    expect(ok.data.merchantWallet).toBe(MERCHANT);

    const live = await call('GET', `/launchpad/campaigns/${id}/onchain`, undefined, { rpcFor: () => escrowRpc({ state: 1 }) });
    expect(live.data.onchain.state).toBe('Active');
    expect(live.data.cached).toBe(false);

    // Resilient caching: when RPC fails, returns the cached snapshot
    const downCached = await call('GET', `/launchpad/campaigns/${id}/onchain`, undefined, { rpcFor: () => async () => { throw new Error('x'); } });
    expect(downCached.data.onchain.state).toBe('Active');
    expect(downCached.data.cached).toBe(true);

    // When no cached snapshot exists and RPC fails: returns not_measured
    await env.DB!.prepare('DELETE FROM launchpad_snapshots WHERE campaign_id = ?').bind(id).run();
    const downUncached = await call('GET', `/launchpad/campaigns/${id}/onchain?fresh=true`, undefined, { rpcFor: () => async () => { throw new Error('x'); } });
    expect(downUncached.data.onchain).toBe('not_measured');
  });

  it('refuses registration when no factory exists for the network', async () => {
    env = { DB: createSqliteD1() } as unknown as Env;
    const created = await call('POST', '/launchpad/campaigns', body);
    const r = await call('PUT', `/launchpad/campaigns/${created.data.campaignId}/contract`, { contractAddress: ESCROW, txHash: TX });
    expect(r.status).toBe(409);
    expect(r.data.error).toContain('factory is not deployed');
  });

  it('on-chain route 404s for drafts', async () => {
    const created = await call('POST', '/launchpad/campaigns', body);
    expect((await call('GET', `/launchpad/campaigns/${created.data.campaignId}/onchain`)).status).toBe(404);
  });
});
