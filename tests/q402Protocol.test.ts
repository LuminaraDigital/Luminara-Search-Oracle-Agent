import { describe, it, expect } from 'vitest';
import {
  createQ402Response,
  parseXPaymentHeader,
  formatPaymentResponseHeader,
  verifyQ402Payment,
  settleQ402Payment,
  getQ402SupportedCatalog,
  type Q402SignedPayload,
} from '../worker/q402';
import {
  buildJettonTransferPayload,
  buildJettonBurnPayload,
  createQ402PaymentHeader,
  OP_JETTON_TRANSFER,
  OP_JETTON_BURN,
} from '../services/ton/jettonService';
import {
  evaluateOracleQuorum,
  type OracleAgentVote,
} from '../services/oracle/usefulOracleValidation';
import { createSqliteD1 } from './helpers/sqliteD1';
import { Address, toNano } from '@ton/core';

describe('Q402 Protocol & Jetton Facilitator', () => {
  const sampleMerchant = 'EQA000000000000000000000000000000000000000000000';
  const samplePayer = '0:' + 'a'.repeat(64);
  const sampleTxHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  function mockEnv() {
    return {
      DB: createSqliteD1(),
      TON_RECEIVING_ADDRESS: sampleMerchant,
      CHAIN_NETWORK: 'mainnet',
      ENVIRONMENT: 'production',
    } as any;
  }

  it('generates standard x402 402 challenge response with TON & Jetton options', async () => {
    const env = mockEnv();
    const res = createQ402Response(env, '/api/q402/audit', 'single_audit');

    expect(res.status).toBe(402);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('x-payment-version')).toBe('1');
    expect(res.headers.get('x-payment-order-id')).toBeTruthy();

    const data = await res.json();
    expect(data.x402Version).toBe(1);
    expect(data.accepts).toHaveLength(3);

    // Option 1: Native TON
    expect(data.accepts[0].scheme).toBe('ton/native-transfer');
    expect(data.accepts[0].asset).toBe('TON');
    expect(data.accepts[0].payTo).toBe(sampleMerchant);

    // Option 2: USDT Jetton
    expect(data.accepts[1].scheme).toBe('ton/jetton-transfer');
    expect(data.accepts[1].asset).toBe('USDT');

    // Option 3: LORA Jetton. Nothing is burned on a payment, so the challenge must not say so.
    expect(data.accepts[2].scheme).toBe('ton/jetton-transfer');
    expect(data.accepts[2].asset).toBe('LORA');
    expect(JSON.stringify(data)).not.toMatch(/burn|deflation/i);
  });

  it('provides a supported catalog describing networks and assets, with no burn claim', () => {
    const env = mockEnv();
    const catalog = getQ402SupportedCatalog(env);

    expect(catalog.x402Version).toBe(1);
    expect(catalog.networks).toContain('mainnet');
    expect(catalog.assets.TON.decimals).toBe(9);
    expect(catalog.assets.USDT.decimals).toBe(6);
    expect(catalog.assets.LORA.decimals).toBe(9);
    expect(JSON.stringify(catalog)).not.toMatch(/burn|deflation/i);
    expect(catalog.endpoints.length).toBeGreaterThanOrEqual(2);
  });

  it('verifies valid Q402 payment payloads and rejects malformed data', async () => {
    const env = mockEnv();

    const validPayload: Q402SignedPayload = {
      x402Version: 1,
      scheme: 'ton/jetton-transfer',
      network: 'mainnet',
      txHash: sampleTxHash,
      payerAddress: samplePayer,
      amount: '1000000',
      asset: 'USDT',
    };

    const res = await verifyQ402Payment(validPayload, env);
    expect(res.isValid).toBe(true);
    expect(res.payer).toBe(samplePayer);

    // Invalid version
    const badVersion = await verifyQ402Payment({ ...validPayload, x402Version: 2 }, env);
    expect(badVersion.isValid).toBe(false);

    // Invalid scheme
    const badScheme = await verifyQ402Payment({ ...validPayload, scheme: 'evm/unknown' as any }, env);
    expect(badScheme.isValid).toBe(false);

    // Zero amount
    const badAmount = await verifyQ402Payment({ ...validPayload, amount: '0' }, env);
    expect(badAmount.isValid).toBe(false);
  });

  it('settles a LORA payment in D1 once, and reports no burn, because none happens', async () => {
    const env = mockEnv();

    const payload: Q402SignedPayload = {
      x402Version: 1,
      scheme: 'ton/jetton-transfer',
      network: 'mainnet',
      orderId: 'q402_order_test_1',
      txHash: sampleTxHash,
      payerAddress: samplePayer,
      amount: '10000000000', // 10 LORA (9 decimals = 10 * 10^9)
      asset: 'LORA',
    };

    const settled = await settleQ402Payment(env, payload);
    expect(settled.success).toBe(true);
    expect(settled.txHash).toBe(sampleTxHash);

    expect(settled.amount).toBe('10000000000');
    expect(settled).not.toHaveProperty('burnAmount');

    // Attempting to settle the exact same txHash again MUST be rejected (Double Spend Prevention)
    const doubleSpend = await settleQ402Payment(env, { ...payload, orderId: 'q402_order_test_2' });
    expect(doubleSpend.success).toBe(false);
    expect(doubleSpend.error).toContain('already been redeemed');
  });

  it('parses and formats client X-PAYMENT and server X-PAYMENT-RESPONSE headers', () => {
    const rawPayload: Q402SignedPayload = {
      x402Version: 1,
      scheme: 'ton/jetton-transfer',
      network: 'mainnet',
      txHash: sampleTxHash,
      payerAddress: samplePayer,
      amount: '1000000',
      asset: 'USDT',
    };

    const encoded = btoa(JSON.stringify(rawPayload));
    const parsed = parseXPaymentHeader(encoded);
    expect(parsed).toEqual(rawPayload);

    const execResponse = {
      settled: true,
      txHash: sampleTxHash,
      payer: samplePayer,
      amount: '1000000',
      asset: 'USDT' as const,
    };

    const respHeader = formatPaymentResponseHeader(execResponse);
    expect(respHeader).toBeTruthy();
    const decodedResp = JSON.parse(atob(respHeader));
    expect(decodedResp.settled).toBe(true);
    expect(decodedResp.txHash).toBe(sampleTxHash);
  });
});

describe('Useful Oracle Validation (UPoW & Quorum Consensus from Qubic)', () => {
  it('achieves BFT consensus when supermajority of oracles agree', async () => {
    const votes: OracleAgentVote[] = [
      {
        agentId: 'oracle_llama3',
        domain: 'example.com',
        query: 'best search oracle',
        healthScore: 85,
        citationRate: 80,
        engineSample: ['google_sge', 'perplexity'],
        timestamp: 1000,
      },
      {
        agentId: 'oracle_nim',
        domain: 'example.com',
        query: 'best search oracle',
        healthScore: 88,
        citationRate: 82,
        engineSample: ['google_sge', 'claude'],
        timestamp: 1000,
      },
      {
        agentId: 'oracle_gemini',
        domain: 'example.com',
        query: 'best search oracle',
        healthScore: 84,
        citationRate: 79,
        engineSample: ['chatgpt_search', 'gemini'],
        timestamp: 1000,
      },
      {
        agentId: 'oracle_adversary',
        domain: 'example.com',
        query: 'best search oracle',
        healthScore: 10, // Outlier hallucination / malicious vote
        citationRate: 5,
        engineSample: ['unknown'],
        timestamp: 1000,
      },
    ];

    // N = 4. f <= (4-1)/3 = 1. Q >= 2*1 + 1 = 3.
    const result = await evaluateOracleQuorum(votes);
    expect(result.isAligned).toBe(true);
    expect(result.agreeingCount).toBe(3);
    expect(result.divergentVotes).toContain('oracle_adversary');
    expect(result.consensusHealthScore).toBeGreaterThanOrEqual(84);
    expect(result.consensusHealthScore).toBeLessThanOrEqual(88);
    expect(result.evidenceHash).toHaveLength(64);
  });

  it('fails alignment when quorum threshold is not met', async () => {
    const votes: OracleAgentVote[] = [
      {
        agentId: 'oracle_1',
        domain: 'example.com',
        query: 'test',
        healthScore: 90,
        citationRate: 90,
        engineSample: ['google'],
        timestamp: 1000,
      },
      {
        agentId: 'oracle_2',
        domain: 'example.com',
        query: 'test',
        healthScore: 40,
        citationRate: 40,
        engineSample: ['bing'],
        timestamp: 1000,
      },
      {
        agentId: 'oracle_3',
        domain: 'example.com',
        query: 'test',
        healthScore: 10,
        citationRate: 10,
        engineSample: ['claude'],
        timestamp: 1000,
      },
    ];

    // N = 3. f = 0. Q = 1. Cluster size must have >= Q within epsilon tolerance.
    const result = await evaluateOracleQuorum(votes, 5); // narrow tolerance 5
    expect(result.divergentVotes.length).toBeGreaterThan(0);
  });
});

describe('Client-Side Jetton Serialization (TEP-74 & TEP-64)', () => {
  const dummyOwner = Address.parseRaw(`0:${'1'.repeat(64)}`);
  const dummyMerchant = Address.parseRaw(`0:${'2'.repeat(64)}`);

  it('builds valid TEP-74 TokenTransfer cell with forward memo', () => {
    const transferCell = buildJettonTransferPayload({
      jettonAmount: 5_000_000n, // 5 USDT
      toAddress: dummyMerchant,
      responseAddress: dummyOwner,
      forwardTonAmount: toNano('0.05'),
      memoText: 'LUM:order_123:single_audit',
    });

    const slice = transferCell.beginParse();
    const op = slice.loadUint(32);
    expect(op).toBe(OP_JETTON_TRANSFER);

    const queryId = slice.loadUint(64);
    expect(Number(queryId)).toBe(0);

    const amount = slice.loadCoins();
    expect(amount).toBe(5_000_000n);

    const dest = slice.loadAddress();
    expect(dest.equals(dummyMerchant)).toBe(true);

    const responseDest = slice.loadAddress();
    expect(responseDest.equals(dummyOwner)).toBe(true);

    // custom payload is null
    expect(slice.loadMaybeRef()).toBeNull();

    const forwardTon = slice.loadCoins();
    expect(forwardTon).toBe(toNano('0.05'));

    // Has forward payload ref
    expect(slice.loadBit()).toBe(true);
    const forwardSlice = slice.loadRef().beginParse();
    const commentPrefix = forwardSlice.loadUint(32);
    expect(commentPrefix).toBe(0);
    const comment = forwardSlice.loadStringTail();
    expect(comment).toBe('LUM:order_123:single_audit');
  });

  it('builds a valid TEP-74 TokenBurn cell (a holder burning their own tokens)', () => {
    const burnCell = buildJettonBurnPayload(1_500_000n, dummyOwner);
    const slice = burnCell.beginParse();

    const op = slice.loadUint(32);
    expect(op).toBe(OP_JETTON_BURN);

    const queryId = slice.loadUint(64);
    expect(Number(queryId)).toBe(0);

    const amount = slice.loadCoins();
    expect(amount).toBe(1_500_000n);

    const resp = slice.loadAddress();
    expect(resp.equals(dummyOwner)).toBe(true);
  });

  it('creates valid base64 X-PAYMENT header', () => {
    const header = createQ402PaymentHeader({
      scheme: 'ton/jetton-transfer',
      network: 'mainnet',
      orderId: 'order_test',
      txHash: '0xabc',
      payerAddress: '0:123',
      amount: '1000',
      asset: 'LORA',
    });

    const decoded = JSON.parse(atob(header));
    expect(decoded.x402Version).toBe(1);
    expect(decoded.asset).toBe('LORA');
    expect(decoded.orderId).toBe('order_test');
  });
});
