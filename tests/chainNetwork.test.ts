import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { resolveTonApiBases, merchantAddressMatchesNetwork, resolveChainNetwork } from '../worker/chainNetwork';
import {
  probeXdcRpc,
  probeXdcRpcCached,
  XDC_CHAIN_ID,
  XDC_PROBE_TIMEOUT_MS,
  type XdcProbeResult,
} from '../worker/chain/xdcRpc';
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

  const XDC_ENV = { CHAIN_NETWORK: 'testnet', CHAIN_XDC_RPC_URL: 'https://rpc.apothem.network' };

  function createProbeKv() {
    const store = new Map<string, string>();
    const puts: Array<{ key: string; ttl: number | undefined }> = [];
    return {
      store,
      puts,
      async get(key: string, type?: string) {
        const val = store.get(key);
        if (val === undefined) return null;
        return type === 'json' ? JSON.parse(val) : val;
      },
      async put(key: string, value: string, opts?: { expirationTtl?: number }) {
        puts.push({ key, ttl: opts?.expirationTtl });
        store.set(key, value);
      },
    };
  }

  it.each([
    ['honours the abort signal', true],
    ['ignores the abort signal', false],
  ])('returns ok:false after 3 s when the RPC hangs and %s', async (_label, abortable) => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetcher = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init?.signal ?? undefined;
            if (abortable) signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );
      let settled: XdcProbeResult | null = null;
      const pending = probeXdcRpc(XDC_ENV, fetcher as never).then((res) => (settled = res));

      await vi.advanceTimersByTimeAsync(XDC_PROBE_TIMEOUT_MS - 1);
      expect(settled).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;

      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/timed out/i);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches the probe in KV for 60 s so a second health call performs no fetch', async () => {
    const kv = createProbeKv();
    const env = { ...XDC_ENV, LUMINARA_KV: kv } as never;
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x33' }), { status: 200 }),
    );

    const first = await probeXdcRpcCached(env, fetcher as never);
    const second = await probeXdcRpcCached(env, fetcher as never);

    expect(first).toEqual({ ok: true, chainId: 51, network: 'testnet' });
    expect(second).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const urlTag = createHash('sha256').update(XDC_ENV.CHAIN_XDC_RPC_URL).digest('hex').slice(0, 8);
    expect(kv.puts).toEqual([{ key: `health:xdc:testnet:${urlTag}`, ttl: 60 }]);
  });

  it('does not serve a cached result after the RPC URL changes', async () => {
    const kv = createProbeKv();
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x33' }), { status: 200 }),
    );

    await probeXdcRpcCached({ ...XDC_ENV, LUMINARA_KV: kv } as never, fetcher as never);
    await probeXdcRpcCached(
      { ...XDC_ENV, CHAIN_XDC_RPC_URL: 'https://erpc.apothem.network', LUMINARA_KV: kv } as never,
      fetcher as never,
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new Set(kv.puts.map((p) => p.key)).size).toBe(2);
  });

  it('caches a failed probe too, so a dead RPC is not retried on every health call', async () => {
    const kv = createProbeKv();
    const env = { ...XDC_ENV, LUMINARA_KV: kv } as never;
    const fetcher = vi.fn(async () => new Response('bad gateway', { status: 502 }));

    expect((await probeXdcRpcCached(env, fetcher as never)).ok).toBe(false);
    expect((await probeXdcRpcCached(env, fetcher as never)).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('probes every time when KV is unbound or failing, without throwing', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x33' }), { status: 200 }),
    );
    expect((await probeXdcRpcCached(XDC_ENV, fetcher as never)).ok).toBe(true);
    expect((await probeXdcRpcCached(XDC_ENV, fetcher as never)).ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);

    const brokenKv = {
      get: async () => {
        throw new Error('simulated KV outage');
      },
      put: async () => {
        throw new Error('simulated KV outage');
      },
    };
    expect((await probeXdcRpcCached({ ...XDC_ENV, LUMINARA_KV: brokenKv } as never, fetcher as never)).ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
