import { describe, expect, it, vi } from 'vitest';
import { resolveTonApiBases, merchantAddressMatchesNetwork, resolveChainNetwork } from '../worker/chainNetwork';
import { probeXdcRpc, XDC_CHAIN_ID } from '../worker/chain/xdcRpc';
import { validateTonAddress, crc16Xmodem } from '../worker/tonPayment';

function syntheticTonAddress(tag: number, fill: number): string {
  const bytes = new Uint8Array(36);
  bytes[0] = tag;
  bytes[1] = 0x00;
  bytes.fill(fill, 2, 34);
  const crc = crc16Xmodem(bytes.subarray(0, 34));
  bytes[34] = crc >> 8;
  bytes[35] = crc & 0xff;
  return Buffer.from(bytes).toString('base64url');
}

describe('chainNetwork', () => {
  it('resolveChainNetwork accepts only testnet|mainnet', () => {
    expect(resolveChainNetwork({ CHAIN_NETWORK: 'testnet' })).toBe('testnet');
    expect(resolveChainNetwork({ CHAIN_NETWORK: 'MAINNET' })).toBe('mainnet');
    expect(resolveChainNetwork({ CHAIN_NETWORK: 'devnet' })).toBeNull();
    expect(resolveChainNetwork({})).toBeNull();
  });

  it('rejects missing CHAIN_TON_API_BASE', () => {
    expect(
      resolveTonApiBases({
        CHAIN_NETWORK: 'mainnet',
        CHAIN_TON_API_BASE: '',
      }),
    ).toBeNull();
  });

  it('rejects mismatched Toncenter hosts', () => {
    expect(
      resolveTonApiBases({
        CHAIN_NETWORK: 'testnet',
        CHAIN_TON_API_BASE: 'https://toncenter.com/api/v3',
      }),
    ).toBeNull();
    expect(
      resolveTonApiBases({
        CHAIN_NETWORK: 'mainnet',
        CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
      }),
    ).toBeNull();
    expect(
      resolveTonApiBases({
        CHAIN_NETWORK: 'testnet',
        CHAIN_TON_API_BASE: 'https://testnet.toncenter.com/api/v3',
        CHAIN_TON_API_FALLBACK_BASE: 'https://testnet.tonapi.io',
      })?.toncenter,
    ).toBe('https://testnet.toncenter.com/api/v3');
  });

  it('merchantAddressMatchesNetwork rejects raw and cross-network friendly', () => {
    const main = validateTonAddress(syntheticTonAddress(0x11, 0x22), { production: true });
    const test = validateTonAddress(syntheticTonAddress(0x91, 0x22), { production: false });
    expect(merchantAddressMatchesNetwork(main, 'mainnet').ok).toBe(true);
    expect(merchantAddressMatchesNetwork(main, 'testnet').ok).toBe(false);
    expect(merchantAddressMatchesNetwork(test, 'testnet').ok).toBe(true);
    expect(merchantAddressMatchesNetwork({ ok: true, format: 'raw', testnet: false }, 'mainnet').ok).toBe(false);
  });
});

describe('xdcRpc probe', () => {
  it('accepts Apothem chainId 51 for testnet', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x33' }), { status: 200 }),
    );
    const res = await probeXdcRpc(
      {
        CHAIN_NETWORK: 'testnet',
        CHAIN_XDC_RPC_URL: 'https://rpc.apothem.network',
      },
      fetcher as never,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.chainId).toBe(XDC_CHAIN_ID.testnet);
  });

  it('fails closed on chainId mismatch when probing', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x32' }), { status: 200 }),
    );
    const res = await probeXdcRpc(
      {
        CHAIN_NETWORK: 'testnet',
        CHAIN_XDC_RPC_URL: 'https://rpc.apothem.network',
        PROOF_XDC_ENABLED: 'true',
      },
      fetcher as never,
    );
    expect(res.ok).toBe(false);
  });
});
