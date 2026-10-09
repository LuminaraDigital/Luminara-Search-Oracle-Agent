import { describe, expect, it } from 'vitest';
import { Address } from '@ton/core';
import { planTonPayment, parseTonAddress, TON_FEE_RESERVE_NANO, MAX_SINGLE_CELL_COMMENT_BYTES } from '../services/ton/transactionPlan';
import {
  CHAIN_REGISTRY,
  explorerAccountUrl,
  explorerTxUrl,
  formatElementaryUnits,
  tonNetworkFromConnectChain,
  toElementaryUnits,
} from '../services/chain/chainRegistry';
import { tonExplorerTxUrl } from '../worker/chainNetwork';
import { XDC_CHAIN_ID } from '../worker/chain/xdcRpc';

const raw = new Address(0, Buffer.alloc(32, 0x5a));
const MAINNET_ADDR = raw.toString({ bounceable: true, testOnly: false });
const TESTNET_ADDR = raw.toString({ bounceable: true, testOnly: true });

const order = (o: Partial<{ amountNano: string; memo: string; recipientAddress: string }> = {}) => ({
  orderId: 'ton_1_abc',
  amountNano: '45000000000',
  memo: 'LUM:ton_1_abc:growth',
  recipientAddress: MAINNET_ADDR,
  ...o,
});

describe('planTonPayment', () => {
  it('plans a valid mainnet payment with fee reserve and validity window', () => {
    const r = planTonPayment({ order: order(), walletChain: '-239', walletConnected: true, nowSec: 1000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({
      network: 'mainnet',
      amountNano: 45_000_000_000n,
      feeReserveNano: TON_FEE_RESERVE_NANO,
      requiredBalanceNano: 45_000_000_000n + TON_FEE_RESERVE_NANO,
      amountDisplay: '45',
      feeReserveDisplay: '0.01',
      validUntil: 1600,
      warnings: [],
    });
  });

  it('plans testnet when invoice and wallet are both testnet (staging)', () => {
    const r = planTonPayment({ order: order({ recipientAddress: TESTNET_ADDR }), walletChain: '-3', walletConnected: true });
    expect(r.ok && r.plan.network).toBe('testnet');
  });

  it('blocks wallet/invoice network mismatch before the wallet prompt', () => {
    const a = planTonPayment({ order: order(), walletChain: '-3', walletConnected: true });
    expect(a).toMatchObject({ ok: false, code: 'network_mismatch' });
    expect(!a.ok && a.error).toMatch(/Nothing was sent/);
    const b = planTonPayment({ order: order({ recipientAddress: TESTNET_ADDR }), walletChain: '-239', walletConnected: true });
    expect(b).toMatchObject({ ok: false, code: 'network_mismatch' });
  });

  it('fails closed on unknown wallet chain or disconnected wallet', () => {
    expect(planTonPayment({ order: order(), walletChain: undefined, walletConnected: true })).toMatchObject({ code: 'wallet_network_unknown' });
    expect(planTonPayment({ order: order(), walletChain: '1', walletConnected: true })).toMatchObject({ code: 'wallet_network_unknown' });
    expect(planTonPayment({ order: order(), walletChain: '-239', walletConnected: false })).toMatchObject({ code: 'wallet_not_connected' });
  });

  it('rejects invalid amounts', () => {
    for (const amountNano of ['0', '-1', '1.5', '', 'abc', '1e9']) {
      expect(planTonPayment({ order: order({ amountNano }), walletChain: '-239', walletConnected: true })).toMatchObject({ code: 'invalid_amount' });
    }
  });

  it('rejects bad-checksum, raw, and empty recipients', () => {
    const corrupted = MAINNET_ADDR.slice(0, -2) + (MAINNET_ADDR.endsWith('AA') ? 'BB' : 'AA');
    for (const recipientAddress of [corrupted, raw.toRawString(), '', 'not-an-address']) {
      expect(planTonPayment({ order: order({ recipientAddress }), walletChain: '-239', walletConnected: true })).toMatchObject({ code: 'invalid_recipient' });
    }
  });

  it('rejects memo that does not bind to the order', () => {
    for (const memo of ['', 'hello', 'LUM:other_order:growth', 'LUM:ton_1_abcd:growth', 'xLUM:ton_1_abc:growth']) {
      expect(planTonPayment({ order: order({ memo }), walletChain: '-239', walletConnected: true })).toMatchObject({ code: 'invalid_memo' });
    }
    const emptyId = planTonPayment({ order: { ...order({ memo: 'LUM::growth' }), orderId: '' }, walletChain: '-239', walletConnected: true });
    expect(emptyId).toMatchObject({ code: 'invalid_memo' });
  });

  it('refuses jetton invoices on the native TON path; allows explicit TON', () => {
    for (const asset of ['USDT', 'LORA'] as const) {
      expect(planTonPayment({ order: { ...order(), asset }, walletChain: '-239', walletConnected: true })).toMatchObject({ ok: false, code: 'unsupported_asset' });
    }
    expect(planTonPayment({ order: { ...order(), asset: 'TON' }, walletChain: '-239', walletConnected: true }).ok).toBe(true);
  });

  it('warns (does not block) on non-bounceable recipient and long memo', () => {
    const nb = raw.toString({ bounceable: false, testOnly: false });
    const longMemo = `LUM:ton_1_abc:${'x'.repeat(MAX_SINGLE_CELL_COMMENT_BYTES)}`;
    const r = planTonPayment({ order: order({ recipientAddress: nb, memo: longMemo }), walletChain: '-239', walletConnected: true });
    expect(r.ok && r.plan.warnings).toHaveLength(2);
  });
});

describe('parseTonAddress', () => {
  it('parses friendly flags and raw form', () => {
    expect(parseTonAddress(TESTNET_ADDR)).toMatchObject({ ok: true, testOnly: true, bounceable: true });
    expect(parseTonAddress(raw.toRawString())).toMatchObject({ ok: true, testOnly: null });
    expect(parseTonAddress('junk')).toEqual({ ok: false });
  });
});

describe('chainRegistry', () => {
  it('stays consistent with worker chain constants', () => {
    const hash = 'ab'.repeat(32);
    expect(explorerTxUrl('ton', 'mainnet', hash)).toBe(tonExplorerTxUrl('mainnet', hash));
    expect(explorerTxUrl('ton', 'testnet', hash)).toBe(tonExplorerTxUrl('testnet', hash));
    expect(Number(CHAIN_REGISTRY.xdc.networks.mainnet.chainRef)).toBe(XDC_CHAIN_ID.mainnet);
    expect(Number(CHAIN_REGISTRY.xdc.networks.testnet.chainRef)).toBe(XDC_CHAIN_ID.testnet);
  });

  it('builds explorer URLs with encoding', () => {
    expect(explorerTxUrl('xdc', 'mainnet', '0xabc')).toBe('https://xdcscan.com/tx/0xabc');
    expect(explorerAccountUrl('xdc', 'testnet', '0xdef')).toBe('https://testnet.xdcscan.com/address/0xdef');
    expect(explorerAccountUrl('ton', 'mainnet', 'EQ+/')).toBe('https://tonviewer.com/EQ%2B%2F');
  });

  it('maps TonConnect chains and fails closed on unknown', () => {
    expect(tonNetworkFromConnectChain('-239')).toBe('mainnet');
    expect(tonNetworkFromConnectChain(-3)).toBe('testnet');
    expect(tonNetworkFromConnectChain('mainnet')).toBeNull();
    expect(tonNetworkFromConnectChain(null)).toBeNull();
  });

  it('converts amounts without float error', () => {
    expect(toElementaryUnits('29', 6)).toBe(29_000_000n);
    expect(toElementaryUnits('0.05', 9)).toBe(50_000_000n);
    expect(toElementaryUnits('0.1234567', 6)).toBeNull();
    expect(toElementaryUnits('-1', 6)).toBeNull();
    expect(toElementaryUnits('1e6', 6)).toBeNull();
    expect(formatElementaryUnits(15_000_000_000n, 9)).toBe('15');
    expect(formatElementaryUnits(50_000_000n, 9)).toBe('0.05');
    expect(formatElementaryUnits(-1n, 6)).toBe('-0.000001');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CHAIN_REGISTRY)).toBe(true);
  });
});
