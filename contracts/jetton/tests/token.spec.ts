import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args';
import { formatUnits, loadTokenProfile, type TokenProfile, toUnits, validateTokenProfile } from './harness';

const valid = loadTokenProfile();
const withMetadata = (patch: Record<string, string>): TokenProfile => ({
  ...valid,
  metadata: { ...valid.metadata, ...patch } as TokenProfile['metadata'],
});

describe('token.json validation', () => {
  it('accepts the shipped profile', () => {
    expect(() => validateTokenProfile(valid)).not.toThrow();
  });

  it('rejects a supply that is not a positive whole number that fits', () => {
    for (const supply of ['0', '-1', '1e8', '1.5', '', ' 100', '0100']) {
      expect(() => validateTokenProfile({ ...valid, supply }), supply).toThrow(/supply/);
    }
    expect(() => validateTokenProfile({ ...valid, supply: '1'.padEnd(40, '0') })).toThrow(/does not fit/);
    expect(() => validateTokenProfile({ ...valid, supply: 100000000 as unknown as string })).toThrow(/supply/);
  });

  it('rejects a malformed symbol, decimals or name', () => {
    expect(() => validateTokenProfile(withMetadata({ symbol: 'lora' }))).toThrow(/symbol/);
    expect(() => validateTokenProfile(withMetadata({ symbol: 'L' }))).toThrow(/symbol/);
    expect(() => validateTokenProfile(withMetadata({ symbol: 'LORA TOKEN' }))).toThrow(/symbol/);
    expect(() => validateTokenProfile(withMetadata({ decimals: '19' }))).toThrow(/decimals/);
    expect(() => validateTokenProfile(withMetadata({ decimals: '09' }))).toThrow(/decimals/);
    expect(() => validateTokenProfile(withMetadata({ decimals: 'nine' }))).toThrow(/decimals/);
    expect(() => validateTokenProfile(withMetadata({ name: ' ' }))).toThrow(/name/);
  });

  it('rejects text a wallet would display badly', () => {
    expect(() => validateTokenProfile(withMetadata({ name: ' Luminara Oracle Token' }))).toThrow(/space or contain control/);
    expect(() => validateTokenProfile(withMetadata({ name: 'Luminara Oracle Token\n' }))).toThrow(/space or contain control/);
    expect(() => validateTokenProfile(withMetadata({ name: 'Luminara\nOracle Token' }))).toThrow(/control characters/);
    expect(() => validateTokenProfile(withMetadata({ description: 'Null\u0000byte' }))).toThrow(/control characters/);
  });

  it('rejects an image that is not a plain https address', () => {
    expect(() => validateTokenProfile(withMetadata({ image: 'http://luminarasuite.com/icon-512.png' }))).toThrow(/https/);
    expect(() => validateTokenProfile(withMetadata({ image: 'icon-512.png' }))).toThrow(/absolute URL/);
    expect(() => validateTokenProfile(withMetadata({ image: 'https://LuminaraSuite.com/icon-512.png' }))).toThrow(/normal form/);
    expect(() => validateTokenProfile(withMetadata({ image: 'https://luminarasuite.com' }))).toThrow(/normal form/);
  });

  it('rejects fields that would be written on-chain without anyone meaning to', () => {
    expect(() => validateTokenProfile(withMetadata({ uri: 'https://example.com/lora.json' }))).toThrow(/unknown field\(s\): uri/);
    expect(() => validateTokenProfile(withMetadata({ image_data: 'AAAA' }))).toThrow(/unknown field/);
  });
});

describe('Token amounts', () => {
  it('converts whole tokens to the smallest unit', () => {
    expect(toUnits(valid, '1')).toBe(1_000_000_000n);
    expect(toUnits(valid, '1.5')).toBe(1_500_000_000n);
    expect(toUnits(valid, '0.000000001')).toBe(1n);
    expect(toUnits(valid, '100000000')).toBe(100_000_000n * 10n ** 9n);
    expect(toUnits(valid, '0')).toBe(0n);
  });

  it('refuses amounts it cannot represent exactly', () => {
    expect(() => toUnits(valid, '0.0000000001')).toThrow(/more than 9 decimal places/);
    expect(() => toUnits(valid, '1,000')).toThrow(/not a token amount/);
    expect(() => toUnits(valid, '-1')).toThrow(/not a token amount/);
    expect(() => toUnits(valid, '1e3')).toThrow(/not a token amount/);
    expect(() => toUnits(valid, '1'.padEnd(40, '0'))).toThrow(/more than a Jetton balance can hold/);
  });

  it('formats the smallest unit as whole tokens', () => {
    expect(formatUnits(valid, 0n)).toBe('0');
    expect(formatUnits(valid, 1n)).toBe('0.000000001');
    expect(formatUnits(valid, 1_000_000_000n)).toBe('1');
    expect(formatUnits(valid, 1_500_000_000n)).toBe('1.5');
    expect(formatUnits(valid, 4_350_000_000n)).toBe('4.35');
    expect(formatUnits(valid, 100_000_000n * 10n ** 9n)).toBe('100,000,000');
    expect(formatUnits(valid, 99_999_995_650_000_000n)).toBe('99,999,995.65');
    expect(() => formatUnits(valid, -1n)).toThrow(/cannot be negative/);
  });

  it('round-trips every amount it formats', () => {
    for (const units of [0n, 1n, 999_999_999n, 1_000_000_001n, 123_456_789_012_345_678n]) {
      expect(toUnits(valid, formatUnits(valid, units).replaceAll(',', ''))).toBe(units);
    }
  });
});

describe('Command-line arguments', () => {
  const allowed = { flags: ['testnet', 'fresh'], options: ['port', 'master'] };

  it('reads flags and options', () => {
    const args = parseArgs(['--testnet', '--port=4781', '--master=kQabc=='], allowed);
    expect(args.has('testnet')).toBe(true);
    expect(args.has('fresh')).toBe(false);
    expect(args.get('port')).toBe('4781');
    expect(args.get('master')).toBe('kQabc==');
    expect(args.get('missing')).toBeUndefined();
  });

  it('stops on anything it does not recognise, instead of ignoring it', () => {
    expect(() => parseArgs(['--vlaue=5'], allowed)).toThrow(/Unknown option --vlaue/);
    expect(() => parseArgs(['--mainnet'], allowed)).toThrow(/Unknown option --mainnet/);
    expect(() => parseArgs(['testnet'], allowed)).toThrow(/Unexpected argument/);
    expect(() => parseArgs(['-p', '4781'], allowed)).toThrow(/Unexpected argument/);
  });

  it('stops on a repeated, empty or misplaced value', () => {
    expect(() => parseArgs(['--port=1', '--port=2'], allowed)).toThrow(/more than once/);
    expect(() => parseArgs(['--testnet', '--testnet'], allowed)).toThrow(/more than once/);
    expect(() => parseArgs(['--port='], allowed)).toThrow(/needs a value/);
    expect(() => parseArgs(['--port'], allowed)).toThrow(/needs a value/);
    expect(() => parseArgs(['--testnet=yes'], allowed)).toThrow(/does not take a value/);
  });
});
