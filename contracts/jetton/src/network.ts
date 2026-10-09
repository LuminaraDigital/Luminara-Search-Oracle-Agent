/**
 * Read-only access to TON testnet and mainnet through the public Toncenter
 * API. Used only to check what is already on-chain. Nothing here can send a
 * transaction: there is no key in this package to sign one with.
 */
import type { Address, ContractProvider } from '@ton/core';
import { TonClient } from '@ton/ton';
import type { Network, ProviderFactory } from './deployment';

const ENDPOINT: Record<Network, string> = {
  mainnet: 'https://toncenter.com/api/v2/jsonRPC',
  testnet: 'https://testnet.toncenter.com/api/v2/jsonRPC',
};

export const EXPLORER: Record<Network, string> = {
  mainnet: 'https://tonviewer.com',
  testnet: 'https://testnet.tonviewer.com',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransient(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  const code = (error as { code?: string })?.code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED';
}

/**
 * A provider factory for a real network. Requests are sent one at a time and
 * spaced out, because the public API allows about one request per second
 * without a key. Set TONCENTER_API_KEY to raise that limit.
 */
export function toncenterProvider(network: Network, apiKey = process.env.TONCENTER_API_KEY): ProviderFactory {
  const client = new TonClient({ endpoint: ENDPOINT[network], apiKey: apiKey || undefined, timeout: 20_000 });
  const gap = apiKey ? 150 : 1_200;
  let queue: Promise<unknown> = Promise.resolve();

  const schedule = <T>(request: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await request();
        } catch (error) {
          if (attempt >= 4 || !isTransient(error)) throw error;
          await sleep(1_500 * (attempt + 1));
        }
      }
    });
    queue = run.then(
      () => sleep(gap),
      () => sleep(gap),
    );
    return run;
  };

  return (address: Address) => {
    const provider = client.provider(address);
    return {
      ...provider,
      getState: () => schedule(() => provider.getState()),
      get: (name, args) => schedule(() => provider.get(name, args)),
    } as ContractProvider;
  };
}
