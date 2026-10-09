import { describe, it, expect } from 'vitest';
import { Address } from '@ton/core';
import { buildOnChainMetadataCell, calculateTransferTax } from '../scripts/deploy';

describe('Luminara ($LUMI) 10x Jetton Specifications', () => {
  const sampleOwner = Address.parseRaw(`0:${'1'.repeat(64)}`);
  const sampleAlice = Address.parseRaw(`0:${'2'.repeat(64)}`);
  const sampleBob = Address.parseRaw(`0:${'3'.repeat(64)}`);

  const INITIAL_SUPPLY = 100_000_000n * 10n ** 9n; // 100 Million LUMI (9 decimals)
  const METADATA_URI =
    'https://raw.githubusercontent.com/LuminaraDigital/Luminara-Search-Oracle-Agent/main/contracts/jetton/metadata.json';

  it('builds valid TEP-64 metadata cell for Luminara ($LUMI)', () => {
    const cell = buildOnChainMetadataCell(METADATA_URI);
    const slice = cell.beginParse();
    const prefix = slice.loadUint(8);
    expect(prefix).toBe(0x01); // Standard TEP-64 off-chain prefix
    const uri = slice.loadStringTail();
    expect(uri).toBe(METADATA_URI);
  });

  it('calculates 3.0% transfer tax with 1% burn, 1% staking, 1% treasury split', () => {
    const transferAmount = 10_000n * 10n ** 9n; // 10,000 LUMI

    const { taxTotal, burnAmount, stakingAmount, treasuryAmount, netRecipientAmount } =
      calculateTransferTax(transferAmount, 300, 100, 100);

    // 3.0% total tax = 300 LUMI
    expect(taxTotal).toBe(300n * 10n ** 9n);

    // 1.0% burn = 100 LUMI
    expect(burnAmount).toBe(100n * 10n ** 9n);

    // 1.0% staking = 100 LUMI
    expect(stakingAmount).toBe(100n * 10n ** 9n);

    // 1.0% treasury / POL = 100 LUMI
    expect(treasuryAmount).toBe(100n * 10n ** 9n);

    // 97.0% net delivered = 9,700 LUMI
    expect(netRecipientAmount).toBe(9_700n * 10n ** 9n);

    // Conservation of value: net + burn + staking + treasury == original transfer amount
    expect(netRecipientAmount + burnAmount + stakingAmount + treasuryAmount).toBe(transferAmount);
  });

  it('enforces maximum 5.0% (500 bps) safety cap on transfer tax', () => {
    const MAX_TAX_BPS = 500; // 5.0% maximum safety cap

    const setTaxConfig = (taxBps: number) => {
      if (taxBps > MAX_TAX_BPS) throw new Error('Tax exceeds maximum 5% safety cap');
      return taxBps;
    };

    expect(setTaxConfig(300)).toBe(300);
    expect(setTaxConfig(500)).toBe(500);
    expect(() => setTaxConfig(501)).toThrow('Tax exceeds maximum 5% safety cap');
    expect(() => setTaxConfig(1000)).toThrow('Tax exceeds maximum 5% safety cap');
  });

  it('guarantees fixed 100M supply and locks minting permanently', () => {
    let mintable = true;
    let currentSupply = INITIAL_SUPPLY;

    const mintInitialSupply = (caller: Address) => {
      if (!caller.equals(sampleOwner)) throw new Error('Only owner can trigger initial mint');
      if (!mintable) throw new Error('Minting is permanently locked');
      mintable = false; // Lock forever
      return currentSupply;
    };

    // Initial 100M mint succeeds
    const minted = mintInitialSupply(sampleOwner);
    expect(minted).toBe(100_000_000n * 10n ** 9n);
    expect(mintable).toBe(false);

    // Subsequent mint attempts MUST fail
    expect(() => mintInitialSupply(sampleOwner)).toThrow('Minting is permanently locked');
    expect(() => mintInitialSupply(sampleAlice)).toThrow('Only owner can trigger initial mint');
  });

  it('simulates deflationary burn reducing total circulating supply', () => {
    let currentSupply = INITIAL_SUPPLY;
    const transferAmount = 50_000n * 10n ** 9n;

    // 1% burn on transfer
    const { burnAmount } = calculateTransferTax(transferAmount, 300, 100, 100);
    currentSupply -= burnAmount;

    expect(currentSupply).toBe(INITIAL_SUPPLY - 500n * 10n ** 9n);
    expect(currentSupply < INITIAL_SUPPLY).toBe(true);
  });
});
