import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chainFor,
  connectWallet,
  daysToSeconds,
  deployEscrow,
  deployLoyaltyToken,
  describeWalletError,
  ensureChain,
  parseNativeAmount,
  percentagesToBps,
  sha256Hex,
  type DeployEscrowInput,
  type DeployTokenInput,
} from '../services/launchpad/wallet';
import { formatWei } from '../services/launchpad/format';

const ADDR = '0x1234567890abcdef1234567890ABCDEF12345678';
const FACTORY = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

type Req = { method: string; params?: unknown[] };

function stubEthereum(handler: (req: Req) => unknown) {
  const request = vi.fn(async (req: Req) => handler(req));
  vi.stubGlobal('ethereum', { request });
  return request;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('percentagesToBps', () => {
  it('converts valid shares to bps summing to 10000', () => {
    expect(percentagesToBps([30, 70])).toEqual([3000, 7000]);
    expect(percentagesToBps([100])).toEqual([10000]);
    expect(percentagesToBps([33.33, 33.33, 33.34])).toEqual([3333, 3333, 3334]);
  });
  it('rejects shares not totalling 100%', () => {
    expect(() => percentagesToBps([30, 60])).toThrow(/exactly 100%/);
    expect(() => percentagesToBps([60, 60])).toThrow(/exactly 100%/);
  });
  it('rejects empty and more than 10 milestones', () => {
    expect(() => percentagesToBps([])).toThrow(/1 to 10/);
    expect(() => percentagesToBps(Array(11).fill(100 / 11))).toThrow(/1 to 10/);
    expect(percentagesToBps(Array(10).fill(10))).toHaveLength(10);
  });
  it('rejects zero, negative and non-finite shares', () => {
    expect(() => percentagesToBps([100, 0])).toThrow(/positive share/);
    expect(() => percentagesToBps([150, -50])).toThrow(/positive share/);
    expect(() => percentagesToBps([NaN, 100])).toThrow(/positive share/);
  });
});

describe('daysToSeconds', () => {
  it('converts whole days within bounds', () => {
    expect(daysToSeconds(1, 1, 90, 'X')).toBe(86400n);
    expect(daysToSeconds(90, 1, 90, 'X')).toBe(90n * 86400n);
  });
  it('rejects out of range and non-integers with the label', () => {
    expect(() => daysToSeconds(0, 1, 90, 'Funding period')).toThrow(/Funding period must be a whole number from 1 to 90/);
    expect(() => daysToSeconds(91, 1, 90, 'X')).toThrow();
    expect(() => daysToSeconds(1.5, 1, 90, 'X')).toThrow();
    expect(() => daysToSeconds(NaN, 1, 90, 'X')).toThrow();
  });
});

describe('parseNativeAmount', () => {
  it('parses valid amounts', () => {
    expect(parseNativeAmount('1', 'A')).toBe(10n ** 18n);
    expect(parseNativeAmount(' 2.5 ', 'A')).toBe(25n * 10n ** 17n);
  });
  it('accepts 18 decimals', () => {
    expect(parseNativeAmount('0.000000000000000001', 'A')).toBe(1n);
  });
  it('rejects 19 decimals', () => {
    expect(() => parseNativeAmount('0.0000000000000000001', 'Goal')).toThrow(/Goal must be a positive number/);
  });
  it('rejects zero', () => {
    expect(() => parseNativeAmount('0', 'Goal')).toThrow(/greater than zero/);
    expect(() => parseNativeAmount('0.000', 'Goal')).toThrow(/greater than zero/);
  });
  it('rejects garbage', () => {
    for (const bad of ['', 'abc', '-1', '1e5', '1,5', '1.', '.5', '0x10']) {
      expect(() => parseNativeAmount(bad, 'Goal')).toThrow(/positive number/);
    }
  });
});

describe('describeWalletError', () => {
  it('maps user rejection', () => {
    expect(describeWalletError({ code: 4001, message: 'x' })).toMatch(/cancelled/);
    expect(describeWalletError(new Error('User rejected the request.'))).toMatch(/cancelled/);
  });
  it('maps nested cause.data.errorName', () => {
    const err = { message: 'boom', cause: { cause: { data: { errorName: 'HardCapExceeded' } } } };
    expect(describeWalletError(err)).toBe('That pledge would exceed the campaign hard cap.');
    expect(describeWalletError({ data: { errorName: 'ZeroAmount' } })).toBe('Amount must be greater than zero.');
  });
  it('ignores unknown error names and falls through', () => {
    expect(describeWalletError({ message: 'plain', cause: { data: { errorName: 'Nope' } } })).toBe('plain');
  });
  it('maps insufficient funds', () => {
    expect(describeWalletError({ shortMessage: 'insufficient funds for gas' })).toMatch(/Not enough balance/);
  });
  it('truncates fallback to first line and 200 chars', () => {
    expect(describeWalletError(new Error('first\nsecond'))).toBe('first');
    expect(describeWalletError(new Error('a'.repeat(500)))).toHaveLength(200);
  });
  it('handles empty and nullish input', () => {
    expect(describeWalletError({})).toBe('Wallet request failed.');
    expect(describeWalletError(undefined)).toBe('Wallet request failed.');
  });
});

describe('chainFor', () => {
  it('returns correct chain ids and native currency', () => {
    expect(chainFor('xdc', 'mainnet').id).toBe(50);
    expect(chainFor('xdc', 'testnet').id).toBe(51);
    expect(chainFor('polygon', 'mainnet').id).toBe(137);
    expect(chainFor('polygon', 'testnet').id).toBe(80002);
    expect(chainFor('xdc', 'mainnet').nativeCurrency.symbol).toBe('XDC');
    expect(chainFor('polygon', 'mainnet').rpcUrls.default.http[0]).toMatch(/^https:\/\//);
  });
});

describe('sha256Hex', () => {
  it('matches known vectors', async () => {
    expect(await sha256Hex('abc')).toBe('0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('')).toBe('0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('connectWallet', () => {
  it('returns the lower-cased first account', async () => {
    const request = stubEthereum(() => [ADDR]);
    const s = await connectWallet();
    expect(s.address).toBe(ADDR.toLowerCase());
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
  });
  it('accepts xdc-prefixed accounts', async () => {
    stubEthereum(() => ['xdc' + ADDR.slice(2)]);
    expect((await connectWallet()).address).toBe(ADDR.toLowerCase());
  });
  it('throws when the wallet returns no account', async () => {
    stubEthereum(() => []);
    await expect(connectWallet()).rejects.toThrow(/no account/);
  });
  it('throws when no wallet is installed', async () => {
    await expect(connectWallet()).rejects.toThrow(/No wallet found/);
  });
});

describe('ensureChain', () => {
  it('does nothing when already on the right chain (case-insensitive)', async () => {
    const request = stubEthereum((r) => (r.method === 'eth_chainId' ? '0x89' : null));
    await ensureChain('polygon', 'mainnet');
    expect(request).toHaveBeenCalledTimes(1);
    const upper = stubEthereum((r) => (r.method === 'eth_chainId' ? '0x13882' : null));
    await ensureChain('polygon', 'testnet');
    expect(upper).toHaveBeenCalledTimes(1);
  });
  it('switches chain when different', async () => {
    const request = stubEthereum((r) => (r.method === 'eth_chainId' ? '0x1' : null));
    await ensureChain('xdc', 'mainnet');
    expect(request).toHaveBeenLastCalledWith({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x32' }] });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('adds the chain on 4902 then does not re-switch', async () => {
    const request = stubEthereum((r) => {
      if (r.method === 'eth_chainId') return '0x1';
      if (r.method === 'wallet_switchEthereumChain') throw Object.assign(new Error('unknown chain'), { code: 4902 });
      return null;
    });
    await ensureChain('xdc', 'testnet');
    const add = request.mock.calls.find((c) => c[0].method === 'wallet_addEthereumChain')![0];
    const p = (add.params as Array<Record<string, unknown>>)[0];
    expect(p.chainId).toBe('0x33');
    expect(p.chainName).toBe('XDC Apothem Testnet');
    expect(p.rpcUrls).toEqual(['https://rpc.apothem.network']);
    expect(p.blockExplorerUrls).toEqual(['https://testnet.xdcscan.com']);
  });
  it('rethrows non-4902 switch errors (e.g. user rejection)', async () => {
    stubEthereum((r) => {
      if (r.method === 'eth_chainId') return '0x1';
      throw Object.assign(new Error('rejected'), { code: 4001 });
    });
    await expect(ensureChain('xdc', 'mainnet')).rejects.toThrow('rejected');
  });
  it('throws when no wallet is installed', async () => {
    await expect(ensureChain('xdc', 'mainnet')).rejects.toThrow(/No wallet found/);
  });
});

describe('deployEscrow validation (throws before any wallet call)', () => {
  const base: DeployEscrowInput = {
    chain: 'polygon',
    network: 'testnet',
    factoryAddress: FACTORY,
    softCapNative: '1',
    hardCapNative: '5',
    fundingDays: 30,
    deliveryDays: 90,
    challengeDays: 7,
    milestonePercentages: [50, 50],
  };

  async function expectRejectsWithoutWallet(input: DeployEscrowInput, msg: RegExp) {
    const request = stubEthereum(() => {
      throw new Error('wallet must not be called');
    });
    await expect(deployEscrow(input)).rejects.toThrow(msg);
    expect(request).not.toHaveBeenCalled();
  }

  it('rejects softCap > hardCap', () => expectRejectsWithoutWallet({ ...base, softCapNative: '6' }, /Maximum goal must be at least/));
  it('rejects bad soft cap', () => expectRejectsWithoutWallet({ ...base, softCapNative: 'abc' }, /Minimum goal/));
  it('rejects bad funding days', () => expectRejectsWithoutWallet({ ...base, fundingDays: 91 }, /Funding period/));
  it('rejects delivery not after funding', () => expectRejectsWithoutWallet({ ...base, deliveryDays: 30 }, /Delivery deadline/));
  it('rejects delivery over 730 days', () => expectRejectsWithoutWallet({ ...base, deliveryDays: 731 }, /Delivery deadline/));
  it('rejects fractional delivery days', () => expectRejectsWithoutWallet({ ...base, deliveryDays: 90.5 }, /Delivery deadline/));
  it('rejects bad challenge window', () => expectRejectsWithoutWallet({ ...base, challengeDays: 31 }, /Challenge window/));
  it('rejects milestones not totalling 100%', () => expectRejectsWithoutWallet({ ...base, milestonePercentages: [50, 40] }, /exactly 100%/));
  it('rejects when no factory is configured', () =>
    expectRejectsWithoutWallet({ ...base, factoryAddress: null }, /factory is not deployed/));
  it('rejects an invalid factory override', () =>
    expectRejectsWithoutWallet({ ...base, factoryAddress: 'not-an-address' }, /factory is not deployed/));
});

describe('deployLoyaltyToken validation (throws before any wallet call)', () => {
  const base: DeployTokenInput = {
    chain: 'xdc',
    network: 'testnet',
    factoryAddress: FACTORY,
    name: 'Coffee',
    symbol: 'CFE',
    initialSupply: 100,
    maxSupply: 1000,
  };

  async function expectRejectsWithoutWallet(input: DeployTokenInput, msg: RegExp) {
    const request = stubEthereum(() => {
      throw new Error('wallet must not be called');
    });
    await expect(deployLoyaltyToken(input)).rejects.toThrow(msg);
    expect(request).not.toHaveBeenCalled();
  }

  it('rejects zero max supply', () => expectRejectsWithoutWallet({ ...base, maxSupply: 0 }, /Maximum supply/));
  it('rejects fractional max supply', () => expectRejectsWithoutWallet({ ...base, maxSupply: 10.5 }, /Maximum supply/));
  it('rejects negative initial supply', () => expectRejectsWithoutWallet({ ...base, initialSupply: -1 }, /Initial supply/));
  it('rejects initial > max', () => expectRejectsWithoutWallet({ ...base, initialSupply: 1001 }, /Initial supply/));
  it('rejects fractional initial supply', () => expectRejectsWithoutWallet({ ...base, initialSupply: 1.5 }, /Initial supply/));
  it('rejects when no factory is configured', () =>
    expectRejectsWithoutWallet({ ...base, factoryAddress: null }, /factory is not deployed/));
});

describe('formatWei', () => {
  it('formats whole, fractional and zero values', () => {
    expect(formatWei('0')).toBe('0');
    expect(formatWei('1000000000000000000')).toBe('1');
    expect(formatWei('1500000000000000000')).toBe('1.5');
    expect(formatWei('123456789012345678901')).toBe('123.4567');
  });
  it('truncates (not rounds) to maxDecimals and trims trailing zeros', () => {
    expect(formatWei('1999999999999999999')).toBe('1.9999');
    expect(formatWei('1000010000000000000', 4)).toBe('1');
    expect(formatWei('1000010000000000000', 5)).toBe('1.00001');
    expect(formatWei('1234567890000000000', 18)).toBe('1.23456789');
  });
  it('handles sub-1 values and leading zeros', () => {
    expect(formatWei('1')).toBe('0');
    expect(formatWei('1', 18)).toBe('0.000000000000000001');
    expect(formatWei('00012000000000000000', 4)).toBe('0.012');
    expect(formatWei('500000000000000000')).toBe('0.5');
  });
});
