import { describe, it, expect } from 'vitest';
import { Address } from '@ton/core';
import { buildJettonBurnPayload, buildJettonTransferPayload } from '../services/ton/jettonService';
import { getQ402SupportedCatalog, QUBIC_SUPPLY_WATCHER_BURN_RATE_PERCENT } from '../worker/q402';
import { LORA_DECIMALS } from '../worker/tonPayment';
import token from '../contracts/jetton/token.json';
import fixture from '../contracts/jetton/tests/fixtures/app-payloads.json';

/**
 * Keeps the app and the Jetton contract in step.
 *
 * The contract's own suite (contracts/jetton, `npm run jetton:test`) runs in
 * a TON sandbox that this workspace does not install. The two suites meet at
 * contracts/jetton/tests/fixtures/app-payloads.json: this file proves the
 * app still builds those exact message bodies, and the contract suite sends
 * the same bytes to the real contract code.
 */
describe('Luminara Jetton: the app and the contract agree', () => {
  it('sells the token that contracts/jetton/token.json describes', () => {
    const catalog = getQ402SupportedCatalog({ CHAIN_NETWORK: 'testnet' } as never);

    expect(catalog.assets.LORA.symbol).toBe(token.metadata.symbol);
    expect(catalog.assets.LORA.name).toBe(token.metadata.name);
    expect(String(catalog.assets.LORA.decimals)).toBe(token.metadata.decimals);
    expect(String(LORA_DECIMALS)).toBe(token.metadata.decimals);
  });

  it('builds the transfer body that the contract suite executes', () => {
    const body = buildJettonTransferPayload({
      jettonAmount: BigInt(fixture.amountUnits),
      toAddress: Address.parse(fixture.merchant),
      responseAddress: Address.parse(fixture.payer),
      forwardTonAmount: BigInt(fixture.forwardTonAmount),
      memoText: fixture.memo,
    });

    expect(body.toBoc().toString('base64')).toBe(fixture.transferBoc);
  });

  it('builds the burn body that the contract suite executes', () => {
    const body = buildJettonBurnPayload(BigInt(fixture.burnUnits), Address.parse(fixture.merchant));

    expect(body.toBoc().toString('base64')).toBe(fixture.burnBoc);
  });

  it('uses the invoice memo format and the Supply Watcher burn rate', () => {
    expect(fixture.memo).toBe(`LUM:${fixture.orderId}:${fixture.planId}`);
    expect(fixture.burnRatePercent).toBe(QUBIC_SUPPLY_WATCHER_BURN_RATE_PERCENT);
    expect(BigInt(fixture.burnUnits)).toBe((BigInt(fixture.amountUnits) * BigInt(fixture.burnRatePercent)) / 100n);
  });

  it('prices one audit as one whole token in the fixture', () => {
    expect(BigInt(fixture.amountUnits)).toBe(10n ** BigInt(token.metadata.decimals));
  });

  it.todo('quotes LORA prices in 9-decimal units (JETTON_PRICING.units is 6-decimal USDT units today)');
});
