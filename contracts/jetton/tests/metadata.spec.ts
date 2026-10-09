import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Address, beginCell, type Cell, Dictionary, type Slice, toNano } from '@ton/core';
import { JettonMaster as StandardJettonMaster, JettonWallet as StandardJettonWallet } from '@ton/ton';
import {
  buildOnchainContent,
  deployJetton,
  expectTx,
  inboundBody,
  type LocalJetton,
  type LocalNet,
  loadTokenProfile,
  OP,
  parseOnchainContent,
  startLocalNet,
  TEST_SEED,
  toUnits,
  transfer,
} from './harness';

/**
 * Reads TEP-64 on-chain metadata without using anything from src/token.ts:
 * keys hashed with node:crypto, values walked by hand. If the package's own
 * encoder and decoder were wrong in the same way, this would still notice.
 */
function decodeIndependently(content: Cell): Record<string, string> {
  const data = content.beginParse();
  if (data.loadUint(8) !== 0x00) throw new Error('not on-chain content');
  const fields = data.loadDict(Dictionary.Keys.Buffer(32), Dictionary.Values.Cell());
  const readSnake = (cell: Cell): string => {
    const bytes: Buffer[] = [];
    let slice: Slice | null = cell.beginParse();
    if (slice.loadUint(8) !== 0x00) throw new Error('not snake format');
    while (slice) {
      bytes.push(slice.loadBuffer(slice.remainingBits / 8));
      slice = slice.remainingRefs > 0 ? slice.loadRef().beginParse() : null;
    }
    return Buffer.concat(bytes).toString('utf8');
  };
  const decoded: Record<string, string> = {};
  for (const name of ['name', 'symbol', 'decimals', 'description', 'image', 'uri', 'image_data']) {
    const value = fields.get(createHash('sha256').update(name).digest());
    if (value) decoded[name] = readSnake(value);
  }
  if (Object.keys(decoded).length !== fields.size) throw new Error('content holds keys this decoder does not know');
  return decoded;
}

describe('Metadata (TEP-64)', () => {
  let net: LocalNet;
  let jetton: LocalJetton;

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    jetton = await deployJetton(net);
  });

  it('is the token that was decided: Luminara Oracle Token, LORA, 9 decimals, 100,000,000', () => {
    // Written out on purpose. Changing the token's identity must be a deliberate edit here too.
    expect(JSON.parse(readFileSync(new URL('../token.json', import.meta.url), 'utf8'))).toEqual({
      supply: '100000000',
      metadata: {
        name: 'Luminara Oracle Token',
        symbol: 'LORA',
        decimals: '9',
        description:
          'Utility token of Luminara Suite. Pays for AI search visibility audits and agent API calls. Fixed supply: no minting, no transfer tax, no freeze.',
        image: 'https://luminarasuite.com/icon-512.png',
      },
    });
    expect(jetton.supply).toBe(100_000_000n * 10n ** 9n);
  });

  it('stores exactly token.json on-chain, in the encoding wallets and explorers read', async () => {
    const { jettonContent } = await jetton.master.getGetJettonData();

    expect(decodeIndependently(jettonContent)).toEqual(loadTokenProfile().metadata);
  });

  it('hashes field names the way the standard says', () => {
    // sha256 of the field names, as published with TEP-64.
    const known: Record<string, string> = {
      name: '82a3537ff0dbce7eec35d69edc3a189ee6f17d82f353a553f9aa96cb0be3ce89',
      symbol: 'b76a7ca153c24671658335bbd08946350ffc621fa1c516e7123095d4ffd5c581',
      decimals: 'ee80fd2f1e03480e2282363596ee752d7bb27f50776b95086a0279189675923e',
      description: 'c9046f7a37ad0ea7cee73355984fa5428982f8b37c8f7bcec91f7ac71a7cd104',
      image: '6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d',
    };
    const content = buildOnchainContent({ ...jetton.profile.metadata }).beginParse();
    content.skip(8);
    const fields = content.loadDict(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());

    expect(fields.keys().map((key) => key.toString(16).padStart(64, '0')).sort()).toEqual(Object.values(known).sort());
    for (const [name, hash] of Object.entries(known)) {
      const value = fields.get(BigInt(`0x${hash}`));
      // Snake format: one zero byte, then the text.
      const text = value?.beginParse();
      expect(text?.loadUint(8), name).toBe(0x00);
      expect(text?.loadStringTail(), name).toBe((jetton.profile.metadata as unknown as Record<string, string>)[name]);
    }
  });

  it('the package decoder agrees with the independent one', async () => {
    const { jettonContent } = await jetton.master.getGetJettonData();
    const { fields, keyCount } = parseOnchainContent(jettonContent);

    expect(fields).toEqual(decodeIndependently(jettonContent));
    expect(keyCount).toBe(Object.keys(loadTokenProfile().metadata).length);
  });

  it('does not depend on any off-chain metadata file', async () => {
    const { jettonContent } = await jetton.master.getGetJettonData();

    // On-chain content (tag 0x00) with no `uri` key: the name, symbol and
    // decimals cannot change because a web host changed or went away.
    expect(jettonContent.beginParse().loadUint(8)).toBe(0x00);
    expect(decodeIndependently(jettonContent).uri).toBeUndefined();
  });

  it('keeps values that span more than one cell intact', async () => {
    const description = 'Luminara Oracle Token. '.repeat(40).trim();
    expect(Buffer.byteLength(description)).toBeGreaterThan(127 * 4);
    const content = buildOnchainContent({ ...jetton.profile.metadata, description });
    expect(decodeIndependently(content).description).toBe(description);

    const fresh = await startLocalNet(`${TEST_SEED}/long-description`);
    const long = await deployJetton(fresh, { content });
    expectTx(long.deployment, { to: long.master.address, op: OP.launch, deploy: true, success: true });
    expect(decodeIndependently((await long.master.getGetJettonData()).jettonContent).description).toBe(description);
  });

  it('keeps non-ASCII text intact', () => {
    const name = 'Luminara Oracle Token ✨ ルミナラ';
    const content = buildOnchainContent({ ...jetton.profile.metadata, name });

    expect(decodeIndependently(content).name).toBe(name);
    expect(parseOnchainContent(content).fields.name).toBe(name);
  });

  it('reports the wallet code that holders actually run', async () => {
    const { treasury } = net.wallets;
    const { jettonWalletCode } = await jetton.master.getGetJettonData();
    const treasuryWallet = await jetton.wallet(treasury.address);

    const account = (await net.blockchain.getContract(treasuryWallet.address)).accountState;
    if (account?.type !== 'active' || !account.state.code) throw new Error('Treasury wallet is not deployed.');
    expect(account.state.code.hash().equals(jettonWalletCode.hash())).toBe(true);
    expect((await treasuryWallet.getGetWalletData()).code.hash().equals(jettonWalletCode.hash())).toBe(true);
  });

  it('can be read by the standard @ton/ton Jetton clients', async () => {
    const { treasury, alice } = net.wallets;
    await transfer(jetton, treasury, { to: alice.address, amount: toUnits(jetton.profile, '12.5') });

    const master = net.blockchain.openContract(StandardJettonMaster.create(jetton.master.address));
    const data = await master.getJettonData();
    expect(data.totalSupply).toBe(jetton.supply);
    expect(data.mintable).toBe(false);
    expect(data.adminAddress.equals(jetton.admin)).toBe(true);
    expect(decodeIndependently(data.content).symbol).toBe('LORA');

    const aliceWallet = net.blockchain.openContract(StandardJettonWallet.create(await master.getWalletAddress(alice.address)));
    expect(await aliceWallet.getBalance()).toBe(toUnits(jetton.profile, '12.5'));
  });
});

describe('Wallet discovery (TEP-89)', () => {
  let net: LocalNet;
  let jetton: LocalJetton;

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    jetton = await deployJetton(net);
  });

  // provide_wallet_address#2c76b973 query_id:uint64 owner_address:MsgAddress include_address:Bool
  // Built by hand, the way another contract or a DEX would send it.
  const discover = (owner: Address, includeAddress: boolean, queryId = 7n) =>
    net.wallets.alice.send({
      to: jetton.master.address,
      value: toNano('0.05'),
      body: beginCell()
        .storeUint(OP.provideWalletAddress, 32)
        .storeUint(queryId, 64)
        .storeAddress(owner)
        .storeBit(includeAddress)
        .endCell(),
    });

  it('answers with the wallet address for an owner', async () => {
    const { alice, bob } = net.wallets;
    const result = await discover(bob.address, true, 0x1234567890abn);

    // take_wallet_address#d1735400 query_id:uint64 wallet_address:MsgAddress owner_address:(Maybe ^MsgAddress)
    const reply = expectTx(result, { from: jetton.master.address, to: alice.address, op: OP.takeWalletAddress, success: true });
    const body = inboundBody(reply).beginParse();
    expect(body.loadUint(32)).toBe(OP.takeWalletAddress);
    expect(body.loadUintBig(64)).toBe(0x1234567890abn);
    expect(body.loadAddress().equals((await jetton.wallet(bob.address)).address)).toBe(true);
    expect(body.loadBit()).toBe(true);
    expect(body.loadRef().beginParse().loadAddress().equals(bob.address)).toBe(true);
    expect(body.remainingBits).toBe(0);
    // The answer is not sent with the bounce flag: there is nothing for the master to undo.
    expect(reply.inMessage?.info.type === 'internal' && reply.inMessage.info.bounce).toBe(false);
  });

  it('gives the same address as the getter and as a real transfer', async () => {
    const { treasury, bob } = net.wallets;
    await transfer(jetton, treasury, { to: bob.address, amount: 1n });
    const result = await discover(bob.address, false);

    const body = inboundBody(expectTx(result, { op: OP.takeWalletAddress })).beginParse();
    body.skip(32 + 64);
    const discovered = body.loadAddress();
    expect(discovered.equals(await jetton.master.getGetWalletAddress(bob.address))).toBe(true);
    expect(await jetton.balanceOf(bob.address)).toBe(1n);
    expect(discovered.equals((await jetton.wallet(bob.address)).address)).toBe(true);
  });

  it('leaves the owner out of the answer unless asked', async () => {
    const result = await discover(net.wallets.bob.address, false);

    const body = inboundBody(expectTx(result, { from: jetton.master.address, op: OP.takeWalletAddress })).beginParse();
    body.skip(32 + 64);
    body.loadAddress();
    expect(body.loadMaybeRef()).toBeNull();
    expect(body.remainingBits).toBe(0);
  });

  it('answers with no wallet for an owner outside the basechain', async () => {
    const masterchainOwner = Address.parseRaw(`-1:${'ef'.repeat(32)}`);
    const result = await discover(masterchainOwner, false);

    const body = inboundBody(expectTx(result, { from: jetton.master.address, op: OP.takeWalletAddress })).beginParse();
    body.skip(32 + 64);
    expect(body.loadMaybeAddress()).toBeNull();
  });
});
