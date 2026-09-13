import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc16Xmodem, isTonPaymentConfigured, validateTonAddress } from '../worker/tonPayment';
// @ts-expect-error untyped .mjs helper shared with scripts/validate-env.mjs
import * as scriptTon from '../scripts/lib/tonAddress.mjs';
// @ts-expect-error untyped .mjs helper
import { parseJsonc } from '../scripts/lib/jsonc.mjs';

/** Synthetic user-friendly address: fill-pattern hash bytes plus a computed CRC. Not a real wallet. */
function syntheticTonAddress(tag: number, fill: number, workchain = 0x00): string {
  const bytes = new Uint8Array(36);
  bytes[0] = tag;
  bytes[1] = workchain;
  bytes.fill(fill, 2, 34);
  const crc = crc16Xmodem(bytes.subarray(0, 34));
  bytes[34] = crc >> 8;
  bytes[35] = crc & 0xff;
  return Buffer.from(bytes).toString('base64url');
}

const EQ = syntheticTonAddress(0x11, 0x3c);
const UQ = syntheticTonAddress(0x51, 0x3c);
const KQ = syntheticTonAddress(0x91, 0x3c);
const ZERO_Q = syntheticTonAddress(0xd1, 0x3c);
const RAW_BASECHAIN = '0:' + '0'.repeat(64);
const RAW_MASTERCHAIN = '-1:' + 'F'.repeat(64);

function flipLastChar(value: string): string {
  return value.slice(0, -1) + (value.endsWith('A') ? 'B' : 'A');
}

describe('validateTonAddress', () => {
  it('CRC16/XMODEM matches the standard check value in both implementations', () => {
    const check = new TextEncoder().encode('123456789');
    expect(crc16Xmodem(check)).toBe(0x31c3);
    expect(scriptTon.crc16Xmodem(check)).toBe(0x31c3);
  });

  it('synthetic fixtures carry the expected prefixes', () => {
    expect(EQ.startsWith('EQ')).toBe(true);
    expect(UQ.startsWith('UQ')).toBe(true);
    expect(KQ.startsWith('kQ')).toBe(true);
    expect(ZERO_Q.startsWith('0Q')).toBe(true);
    expect(EQ).toHaveLength(48);
  });

  it('accepts mainnet friendly and raw addresses in production', () => {
    for (const address of [EQ, UQ, RAW_BASECHAIN, RAW_MASTERCHAIN, `  ${EQ}  `]) {
      expect(validateTonAddress(address, { production: true }).ok).toBe(true);
    }
  });

  it('tolerates the standard base64 (+ /) spelling', () => {
    const withMarks = syntheticTonAddress(0x11, 0xfb);
    expect(withMarks).toMatch(/[-_]/);
    const standard = withMarks.replace(/-/g, '+').replace(/_/g, '/');
    expect(validateTonAddress(standard, { production: true }).ok).toBe(true);
  });

  it('rejects testnet kQ/0Q in production but allows them elsewhere', () => {
    for (const address of [KQ, ZERO_Q]) {
      const prod = validateTonAddress(address, { production: true });
      expect(prod.ok).toBe(false);
      if (!prod.ok) expect(prod.reason).toMatch(/testnet/);
      expect(validateTonAddress(address, { production: false })).toEqual({ ok: true, format: 'friendly', testnet: true });
    }
  });

  it.each([
    ['empty', ''],
    ['undefined', undefined],
    ['non-string', 42],
    ['placeholder', 'EQ_MERCHANT_WALLET'],
    ['bad checksum', flipLastChar(EQ)],
    ['47 chars', EQ.slice(0, 47)],
    ['49 chars', `${EQ}A`],
    ['masterchain friendly', syntheticTonAddress(0x11, 0x3c, 0xff)],
    ['unknown flag', syntheticTonAddress(0x22, 0x3c)],
    ['raw short hex', '0:' + '0'.repeat(63)],
    ['raw bad workchain', '1:' + '0'.repeat(64)],
    ['raw non-hex', '0:' + 'g'.repeat(64)],
  ])('rejects %s', (_label, address) => {
    expect(validateTonAddress(address, { production: false }).ok).toBe(false);
  });

  it('script implementation stays in parity with the worker implementation', () => {
    const inputs: unknown[] = [
      EQ, UQ, KQ, ZERO_Q, RAW_BASECHAIN, RAW_MASTERCHAIN, flipLastChar(EQ), 'EQ_MERCHANT_WALLET', '', undefined,
      syntheticTonAddress(0x11, 0x3c, 0xff), syntheticTonAddress(0x51, 0xfb).replace(/_/g, '/'),
    ];
    for (const input of inputs) {
      for (const production of [true, false]) {
        const worker = validateTonAddress(input, { production });
        const script = scriptTon.validateTonAddress(input, { production });
        expect({ input, production, ok: script.ok, testnet: script.testnet })
          .toEqual({ input, production, ok: worker.ok, testnet: worker.ok ? worker.testnet : undefined });
      }
    }
  });
});

describe('isTonPaymentConfigured', () => {
  it('is true only for an address valid in the current environment', () => {
    expect(isTonPaymentConfigured({ ENVIRONMENT: 'production', TON_RECEIVING_ADDRESS: EQ })).toBe(true);
    expect(isTonPaymentConfigured({ ENVIRONMENT: 'production', TON_RECEIVING_ADDRESS: undefined })).toBe(false);
    expect(isTonPaymentConfigured({ ENVIRONMENT: 'production', TON_RECEIVING_ADDRESS: KQ })).toBe(false);
    expect(isTonPaymentConfigured({ ENVIRONMENT: 'staging', TON_RECEIVING_ADDRESS: KQ })).toBe(true);
    expect(isTonPaymentConfigured({ ENVIRONMENT: undefined, TON_RECEIVING_ADDRESS: 'garbage' })).toBe(false);
  });
});

describe('parseJsonc', () => {
  it('strips comments and trailing commas without touching // inside strings', () => {
    const parsed = parseJsonc(`{
      // line comment
      "url": "https://luminarasuite.com/path//double", /* block */
      "quote": "a \\"quoted\\" // not a comment",
      "list": [1, 2, ],
      /* multi
         line */
      "nested": { "k": "v", },
    }`);
    expect(parsed).toEqual({
      url: 'https://luminarasuite.com/path//double',
      quote: 'a "quoted" // not a comment',
      list: [1, 2],
      nested: { k: 'v' },
    });
  });

  it('parses the repository wrangler.jsonc', async () => {
    const { readFileSync } = await import('node:fs');
    const config = parseJsonc(readFileSync(resolve(__dirname, '..', 'wrangler.jsonc'), 'utf8'));
    expect(config.env.production.vars.ENVIRONMENT).toBe('production');
  });
});

describe('checkProductionTonAddress', () => {
  const withAddress = (address: unknown) => ({ env: { production: { vars: { TON_RECEIVING_ADDRESS: address } } } });

  it('fails when the address is missing, unless allowMissing downgrades it to a warning', () => {
    expect(scriptTon.checkProductionTonAddress({ env: { production: { vars: {} } } }).ok).toBe(false);
    const allowed = scriptTon.checkProductionTonAddress({ env: { production: { vars: {} } } }, { allowMissing: true });
    expect(allowed.ok).toBe(true);
    expect(allowed.warning).toMatch(/TON_RECEIVING_ADDRESS/);
  });

  it('fails on invalid or testnet addresses even with allowMissing', () => {
    for (const address of [KQ, 'EQ_MERCHANT_WALLET', 123]) {
      const result = scriptTon.checkProductionTonAddress(withAddress(address), { allowMissing: true });
      expect(result.ok).toBe(false);
      if (typeof address === 'string' && address.length > 8) expect(result.message).not.toContain(address);
    }
  });

  it('passes a valid mainnet address and fails without a production vars block', () => {
    expect(scriptTon.checkProductionTonAddress(withAddress(EQ)).ok).toBe(true);
    expect(scriptTon.checkProductionTonAddress({ vars: { TON_RECEIVING_ADDRESS: EQ } }).ok).toBe(false);
  });
});

describe('scripts/validate-env.mjs TON gate', () => {
  const root = resolve(__dirname, '..');
  const script = resolve(root, 'scripts', 'validate-env.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'lum-validate-env-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function wranglerWith(address?: string): string {
    const file = join(dir, `wrangler-${Math.random().toString(36).slice(2)}.jsonc`);
    const tonLine = address === undefined ? '' : `"TON_RECEIVING_ADDRESS": "${address}", // merchant wallet`;
    writeFileSync(
      file,
      `{
        // staging.luminarasuite.com lives in "staging"
        "env": {
          "staging": { "vars": { "WEBAPP_URL": "https://staging.luminarasuite.com/" } },
          "production": {
            "vars": {
              "WEBAPP_URL": "https://luminarasuite.com/", // trailing comment after a URL
              ${tonLine}
            },
          },
        },
      }`,
      'utf8',
    );
    return file;
  }

  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });

  it('fails production mode when TON_RECEIVING_ADDRESS is missing', () => {
    const result = run('--prod', `--wrangler=${wranglerWith()}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/TON_RECEIVING_ADDRESS is not set/);
  });

  it('fails production mode on a testnet address without printing it', () => {
    const result = run('--prod', `--wrangler=${wranglerWith(KQ)}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/testnet/);
    expect(result.stderr + result.stdout).not.toContain(KQ);
  });

  it('passes production mode with a valid mainnet address', () => {
    const result = run('--mode=production', `--wrangler=${wranglerWith(UQ)}`);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('--allow-missing-ton downgrades a missing address to a warning', () => {
    const result = run('--prod', '--allow-missing-ton', `--wrangler=${wranglerWith()}`);
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/WARNING/);
  });

  it('staging mode does not require a TON address', () => {
    expect(run('--staging', `--wrangler=${wranglerWith()}`).status).toBe(0);
  });
});
