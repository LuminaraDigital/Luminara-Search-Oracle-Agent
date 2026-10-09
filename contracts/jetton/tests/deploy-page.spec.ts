import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { Address, Cell, loadStateInit, toNano } from '@ton/core';
import { internal } from '@ton/sandbox';
import { createDeployApp, type DeployServerConfig } from '../src/deployServer';
import type { Network, TonConnectRequest } from '../src/deployment';
import { type LocalNet, type LocalWallet, loadTokenProfile, startLocalNet, TEST_SEED } from './harness';

/**
 * The deploy page itself: the script a person clicks through to launch the
 * token. It runs here exactly as the browser loads it, against a stand-in
 * for the page's elements, the real server app, a local sandbox for the
 * chain, and a stand-in for the wallet whose approvals the tests decide.
 */

const HTML = readFileSync(fileURLToPath(new URL('../scripts/deploy-page.html', import.meta.url)), 'utf8');
const SCRIPT = readFileSync(fileURLToPath(new URL('../scripts/deploy-page.js', import.meta.url)), 'utf8');
const UNREACHABLE = /Could not reach the deploy page server/;
const DECLINED = '[TON_CONNECT_SDK_ERROR] UserRejectsError: User rejects the action in the wallet.';
const ALREADY_LAUNCHED = 'This token is already launched for this wallet. Nothing more to send.';
const SENT_NOT_ARRIVED = 'Your wallet sent the transaction, but it is not on-chain yet. Do not send it again. Press "Check again" in a minute.';
const NOTHING_LAUNCHED = 'Nothing was launched by this attempt unless your wallet shows a sent transaction.';
const MINUTE = 60_000;

/** As much of an HTML element as the page script uses. */
class FakeElement {
  textContent = '';
  className = '';
  href = '';
  hidden = false;
  disabled = false;
  checked = false;
  readonly children: FakeElement[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(readonly tag: string) {}

  replaceChildren(...nodes: FakeElement[]) {
    this.children.length = 0;
    this.children.push(...nodes);
  }

  append(...nodes: FakeElement[]) {
    this.children.push(...nodes);
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  /** Everything a person would read in this element. */
  get text(): string {
    return [this.textContent, ...this.children.map((child) => child.text)].filter(Boolean).join(' ');
  }
}

interface WalletStatus {
  account: { address: string; chain: string };
}

interface Page {
  $: (id: string) => FakeElement;
  boxes: FakeElement[];
  /** What the page passed to TON Connect. */
  tonConnect: { options: Record<string, any> | null };
  /** Tells the page a wallet connected or disconnected, as TON Connect does. */
  wallet: (status: WalletStatus | null) => void;
  /** What the wallet does with a request. Each test sets it. */
  approval: { handle: (request: TonConnectRequest) => Promise<unknown>; requests: TonConnectRequest[] };
  network: {
    /** This many of the next calls to the server fail without an answer. */
    failNext: number;
    /** The next call to the server gets this answer instead of a real one. */
    answerNext: { status: number; body: Record<string, unknown> } | null;
    calls: string[];
    /** The waits the page asked for, in milliseconds. They are recorded and skipped. */
    waits: number[];
  };
  /** The page's clock, as milliseconds ahead of the real one. */
  clock: { ahead: number };
}

describe.skipIf(process.env.JETTON_MUTATION_RUN)('Deploy page', () => {
  const profile = loadTokenProfile();
  let net: LocalNet;
  let alice: LocalWallet;

  /** Loads the page for `network`, backed by the real server app and the local sandbox. */
  function open(network: Network = 'testnet'): Page {
    const config: DeployServerConfig = {
      network,
      profile,
      value: toNano('1'),
      provide: (address) => net.blockchain.provider(address),
      manifestUrl: 'https://example.invalid/tonconnect-manifest.json',
      tonConnectBundle: fileURLToPath(new URL('../token.json', import.meta.url)),
      pollMs: 5,
    };
    const app = createDeployApp(config);

    // The elements of the real page. Asking for one that is not there fails the test.
    const elements = new Map<string, FakeElement>();
    const boxes: FakeElement[] = [];
    for (const [, tag, attributes] of HTML.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)) {
      const element = new FakeElement(tag);
      element.hidden = /\shidden\b/.test(attributes);
      const id = attributes.match(/\sid="([^"]+)"/)?.[1];
      if (id) elements.set(id, element);
      if (/\sclass="[^"]*\bconfirm-box\b/.test(attributes)) boxes.push(element);
    }
    const $ = (id: string) => {
      const element = elements.get(id);
      if (!element) throw new Error(`The page has no element with id "${id}".`);
      return element;
    };
    const document = {
      title: '',
      getElementById: $,
      createElement: (tag: string) => new FakeElement(tag),
      querySelectorAll: (selector: string) => {
        if (selector !== '.confirm-box') throw new Error(`Unexpected selector ${selector}.`);
        return boxes;
      },
    };

    const page: Page = {
      $,
      boxes,
      tonConnect: { options: null },
      wallet: () => {
        throw new Error('The page has not started TON Connect yet.');
      },
      approval: {
        requests: [],
        handle: async () => {
          throw new Error('The page asked the wallet for an approval this test did not expect.');
        },
      },
      network: { failNext: 0, answerNext: null, calls: [], waits: [] },
      clock: { ahead: 0 },
    };

    class TonConnectUI {
      constructor(options: Record<string, any>) {
        page.tonConnect.options = options;
      }

      onStatusChange(listener: (status: WalletStatus | null) => void) {
        page.wallet = listener;
      }

      sendTransaction(request: TonConnectRequest) {
        page.approval.requests.push(request);
        return page.approval.handle(request);
      }
    }

    // The page reaches its server through this instead of a socket.
    const fetch = async (path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      page.network.calls.push(`${init?.method ?? 'GET'} ${path}`);
      if (page.network.failNext > 0) {
        page.network.failNext--;
        throw new TypeError('Failed to fetch');
      }
      if (page.network.answerNext) {
        const { status, body } = page.network.answerNext;
        page.network.answerNext = null;
        return { ok: status >= 200 && status < 300, status, json: async () => body };
      }
      // The page waits up to 150 seconds for a transaction to land. Here a second of that takes a millisecond.
      const sent = init?.body === undefined ? undefined : (JSON.parse(init.body) as Record<string, unknown>);
      if (sent && typeof sent.wait === 'number') sent.wait /= 1000;
      const response = await app({
        method: init?.method ?? 'GET',
        url: path,
        host: '127.0.0.1:4780',
        contentType: init?.headers?.['content-type'],
        body: sent === undefined ? undefined : Buffer.from(JSON.stringify(sent)),
      });
      return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => JSON.parse(response.body.toString()) };
    };

    // The page's waits are recorded and then skipped.
    const timer = (callback: () => void, ms: number) => {
      page.network.waits.push(ms);
      return setTimeout(callback, 0);
    };
    const clock = { now: () => Date.now() + page.clock.ahead };

    new Function('window', 'document', 'fetch', 'setTimeout', 'Date', SCRIPT)({ TON_CONNECT_UI: { TonConnectUI } }, document, fetch, timer, clock);
    return page;
  }

  /** Waits until the page shows what `seen` looks for. */
  async function until(seen: () => boolean, what: string) {
    for (let waited = 0; waited < 20_000; waited += 5) {
      if (seen()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`The page never showed: ${what}`);
  }

  /** Does what a wallet does when its owner approves: sends each message from the owner's address. */
  const approve = (from: Address) => async (request: TonConnectRequest) => {
    for (const message of request.messages) {
      await net.blockchain.sendMessage(
        internal({
          from,
          to: Address.parse(message.address),
          value: BigInt(message.amount),
          stateInit: message.stateInit ? loadStateInit(Cell.fromBase64(message.stateInit).beginParse()) : undefined,
          body: message.payload ? Cell.fromBase64(message.payload) : new Cell(),
          bounce: true,
        }),
      );
    }
    return { boc: '' };
  };

  const connected = (wallet: LocalWallet, chain: '-3' | '-239' = '-3'): WalletStatus => ({
    account: { address: wallet.address.toRawString(), chain },
  });

  /** The page is neither waiting for its server nor for the wallet. */
  const idle = (page: Page) => !page.$('recheck').disabled;

  /** Opens the page, connects alice and waits for the launch to be prepared. */
  async function openAndConnect(network: Network = 'testnet') {
    const page = open(network);
    await until(() => page.tonConnect.options !== null, 'TON Connect started');
    page.wallet(connected(alice, network === 'mainnet' ? '-239' : '-3'));
    await until(() => !page.$('step-deploy').hidden && page.$('summary').children.length > 0 && idle(page), 'the launch summary');
    return page;
  }

  /** Clicks Deploy with a wallet that approves, and waits for the verdict. */
  async function launch(page: Page) {
    page.approval.handle = approve(alice.address);
    page.$('deploy').fire('click');
    await until(() => page.$('verify-status').text.startsWith('Verified.') && page.$('deploy').disabled && idle(page), 'a verified launch');
  }

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    alice = net.wallets.alice;
  });

  it('shows the token and the network, and offers nothing to approve before a wallet is connected', async () => {
    const page = open();
    await until(() => page.tonConnect.options !== null, 'TON Connect started');

    expect(page.$('network').text).toBe('TESTNET');
    expect(page.$('title').text).toBe('Deploy Luminara Oracle Token (LORA) to testnet');
    expect(page.$('token').text).toContain('100,000,000 LORA, minted once, never again');
    expect(page.$('token').text).toContain('1 TON');
    for (const id of ['step-deploy', 'step-verify', 'step-rehearsal', 'step-next', 'mainnet-confirm']) expect(page.$(id).hidden).toBe(true);
    expect(page.$('error').text).toBe('');
    expect(page.network.calls).toEqual(['GET /api/context']);
    expect(page.approval.requests).toEqual([]);

    // TON Connect is given the manifest, the place for its button, and told not to report usage.
    expect(page.tonConnect.options).toEqual({
      manifestUrl: 'https://example.invalid/tonconnect-manifest.json',
      buttonRootId: 'connect',
      analytics: { mode: 'off' },
    });
  });

  it('refuses a wallet that is on the other network', async () => {
    const page = open();
    await until(() => page.tonConnect.options !== null, 'TON Connect started');

    page.wallet(connected(alice, '-239'));
    await until(() => page.$('error').text !== '', 'an error');

    expect(page.$('error').text).toMatch(/Your wallet is on mainnet, but this page deploys to testnet/);
    expect(page.$('step-deploy').hidden).toBe(true);
    expect(page.network.calls).toEqual(['GET /api/context']);
  });

  it('launches with one approval, verifies what landed, and then has nothing more to send', async () => {
    const page = await openAndConnect();
    const master = page.$('summary').children[3].text;
    expect(page.$('summary').text).toContain(alice.address.toString({ bounceable: true, testOnly: true }));
    expect(page.$('summary').text).toMatch(/passed \d+ of \d+ checks/);
    expect(page.$('deploy').disabled).toBe(false);
    expect(page.$('deploy-status').text).toMatch(/terminal that started this page prints the same address/);

    let callsBeforeTheWallet: string[] = [];
    page.approval.handle = async (request) => {
      callsBeforeTheWallet = [...page.network.calls];
      return approve(alice.address)(request);
    };
    page.$('deploy').fire('click');
    await until(() => page.$('verify-status').text.startsWith('Verified.') && page.$('deploy').disabled && idle(page), 'a verified launch');

    // The request was prepared again at the click, so the wallet never gets one that has gone stale.
    expect(callsBeforeTheWallet).toEqual(['GET /api/context', 'POST /api/prepare', 'POST /api/prepare']);

    // One request, to the token contract the page showed, from the connected wallet.
    expect(page.approval.requests).toHaveLength(1);
    const [request] = page.approval.requests;
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].address).toBe(master);
    expect(request.messages[0].amount).toBe(toNano('1').toString());
    expect(request.network).toBe('-3');
    expect(request.from).toBe(alice.address.toRawString());

    expect(page.$('verify-status').text).toBe('Verified. The reviewed code is deployed and the admin holds the whole supply.');
    const statuses = page.$('checks').children.map((check) => check.children[0].text);
    expect(statuses.length).toBeGreaterThan(5);
    expect(new Set(statuses)).toEqual(new Set(['PASS']));
    expect(page.$('explorer').href).toBe(`https://testnet.tonviewer.com/${master}`);
    expect(page.$('error').text).toBe('');

    // Launched: the button stays off, and the page says why.
    expect(page.$('deploy').disabled).toBe(true);
    expect(page.$('deploy-status').text).toBe(ALREADY_LAUNCHED);
    page.$('deploy').fire('click');
    await until(() => idle(page), 'the page to settle');
    expect(page.approval.requests).toHaveLength(1);

    // On testnet the next steps are the rehearsal, then the mainnet command with this token's address.
    expect(page.$('step-rehearsal').hidden).toBe(false);
    expect(page.$('next').text).toContain(`npm run jetton:deploy:mainnet -- --testnet-master=${master} --confirm-mainnet`);
  });

  it('rehearses with one more approval and reports the burn', async () => {
    const page = await openAndConnect();
    await launch(page);

    page.$('rehearse').fire('click');
    await until(() => page.$('rehearsal-status').text.startsWith('Done.'), 'a finished rehearsal');

    expect(page.approval.requests).toHaveLength(2);
    expect(page.approval.requests[1].messages).toHaveLength(2);
    expect(page.$('rehearsal-status').text).toBe('Done. 1 LORA burned in total; the supply is now 99,999,999.');
    expect(page.$('verify-status').text).toBe('Verified. The reviewed code is deployed and the token has been used since.');
    expect(page.$('next').text).toContain('Rehearsal done: 1 LORA burned on testnet.');
    expect(page.$('error').text).toBe('');
  });

  it('when the wallet declines, nothing is sent and the page says so', async () => {
    const page = await openAndConnect();
    page.approval.handle = async () => {
      throw new Error(DECLINED);
    };

    page.$('deploy').fire('click');
    await until(() => page.$('error').text !== '' && idle(page), 'an error');

    expect(page.$('error').text).toBe('The transaction was not approved in the wallet. Nothing was sent.');
    expect(page.$('deploy-status').text).toBe(NOTHING_LAUNCHED);
    expect(page.$('step-verify').hidden).toBe(true);
    // The owner can simply try again.
    expect(page.$('deploy').disabled).toBe(false);
    await launch(page);
    expect(page.approval.requests).toHaveLength(2);
  });

  it('when the wallet fails in some other way, it points to the check and not to another attempt', async () => {
    const page = await openAndConnect();
    page.approval.handle = async () => {
      throw new Error('[TON_CONNECT_SDK_ERROR] Unknown error: the connection to the wallet was lost');
    };

    page.$('deploy').fire('click');
    await until(() => page.$('error').text !== '' && idle(page), 'an error');

    // Nobody can tell from here whether the wallet sent it.
    expect(page.$('error').text).toMatch(/The wallet did not confirm the transaction \(.*connection to the wallet was lost\)/);
    expect(page.$('error').text).toMatch(/press "Check again"\. Do not send it twice\./);
    expect(page.$('error').text).not.toMatch(/Nothing was sent/);
    expect(page.$('deploy-status').text).toBe(NOTHING_LAUNCHED);
    expect(page.$('step-verify').hidden).toBe(false);

    // It had in fact been sent. "Check again" finds it, and there is nothing left to approve.
    await approve(alice.address)(page.approval.requests[0]);
    page.$('recheck').fire('click');
    await until(() => page.$('verify-status').text.startsWith('Verified.') && idle(page), 'a verified launch');
    expect(page.$('deploy').disabled).toBe(true);
    expect(page.$('deploy-status').text).toBe(ALREADY_LAUNCHED);
    expect(page.approval.requests).toHaveLength(1);
  });

  it('rides out a connection to its own server that fails for a moment', async () => {
    const page = open();
    await until(() => page.tonConnect.options !== null, 'TON Connect started');

    page.network.failNext = 3;
    page.wallet(connected(alice));
    await until(() => !page.$('step-deploy').hidden && page.$('summary').children.length > 0, 'the launch summary');

    expect(page.network.calls.filter((call) => call === 'POST /api/prepare')).toHaveLength(4);
    expect(page.network.waits).toEqual([250, 500, 1000]);
    expect(page.$('error').text).toBe('');
  });

  it('says so when its server is gone, without pretending anything happened', async () => {
    const page = open();
    await until(() => page.tonConnect.options !== null, 'TON Connect started');

    page.network.failNext = Number.POSITIVE_INFINITY;
    page.wallet(connected(alice));
    await until(() => page.$('error').text !== '', 'an error');

    expect(page.$('error').text).toMatch(UNREACHABLE);
    // Six tries in all, with a growing wait between them.
    expect(page.network.waits).toEqual([250, 500, 1000, 2000, 3000]);
    expect(page.$('step-deploy').hidden).toBe(true);
    expect(page.approval.requests).toEqual([]);
  });

  it('never suggests sending again when the check fails after the wallet has sent', async () => {
    const page = await openAndConnect();
    // The wallet sends the launch, and from then on the page cannot reach its server.
    page.approval.handle = async (request) => {
      await approve(alice.address)(request);
      page.network.failNext = Number.POSITIVE_INFINITY;
      return { boc: '' };
    };

    page.$('deploy').fire('click');
    await until(() => page.$('error').text !== '' && idle(page), 'an error');

    expect(page.$('error').text).toMatch(UNREACHABLE);
    expect(page.$('deploy-status').text).toMatch(/Your wallet sent the transaction.*Do not send it again.*Check again/);
    expect(page.$('deploy-status').text).not.toMatch(/Nothing was launched/);
    expect(page.$('deploy').disabled).toBe(true);
    expect(page.$('step-verify').hidden).toBe(false);
    expect(page.$('verify-status').text).toBe('Not checked yet.');

    // Once the server answers again, "Check again" finds the launch.
    page.network.failNext = 0;
    page.$('recheck').fire('click');
    await until(() => page.$('verify-status').text.startsWith('Verified.') && idle(page), 'a verified launch');
    expect(page.$('error').text).toBe('');
    expect(page.$('deploy').disabled).toBe(true);
    expect(page.$('deploy-status').text).toBe(ALREADY_LAUNCHED);
    expect(page.approval.requests).toHaveLength(1);
  });

  it('does not mistake an error from the check for a refusal in the wallet', async () => {
    const page = await openAndConnect();
    // The wallet sends. The check then fails with wording a refusal might also use.
    page.approval.handle = async (request) => {
      await approve(alice.address)(request);
      page.network.answerNext = { status: 500, body: { error: 'The request to the network was canceled.' } };
      return { boc: '' };
    };

    page.$('deploy').fire('click');
    await until(() => page.$('error').text !== '' && idle(page), 'an error');

    expect(page.$('error').text).toBe('The request to the network was canceled.');
    expect(page.$('deploy-status').text).toMatch(/Your wallet sent the transaction.*Do not send it again/);
    expect(page.$('deploy').disabled).toBe(true);
  });

  it('keeps Deploy off while a sent launch can still arrive, and finds it when it does', async () => {
    const page = await openAndConnect();
    // The wallet says it sent the launch, but the network has not taken it in yet.
    page.approval.handle = async () => ({ boc: '' });

    page.$('deploy').fire('click');
    await until(() => page.$('deploy-status').text === SENT_NOT_ARRIVED && idle(page), 'the launch reported as sent but not arrived');

    expect(page.$('verify-status').text).toMatch(/The token is not launched yet/);
    expect(page.$('deploy').disabled).toBe(true);
    expect(page.$('error').text).toBe('');

    // Checking again too early changes nothing.
    page.$('recheck').fire('click');
    await until(() => idle(page), 'the page to settle');
    expect(page.$('deploy-status').text).toBe(SENT_NOT_ARRIVED);
    expect(page.$('deploy').disabled).toBe(true);

    // It arrives late.
    await approve(alice.address)(page.approval.requests[0]);
    page.$('recheck').fire('click');
    await until(() => page.$('verify-status').text.startsWith('Verified.') && idle(page), 'a verified launch');
    expect(page.$('deploy').disabled).toBe(true);
    expect(page.$('deploy-status').text).toBe(ALREADY_LAUNCHED);
    expect(page.approval.requests).toHaveLength(1);
  });

  it('lets a launch be sent again only once the first one can no longer arrive', async () => {
    const page = await openAndConnect();
    page.approval.handle = async () => ({ boc: '' });
    page.$('deploy').fire('click');
    await until(() => page.$('deploy-status').text === SENT_NOT_ARRIVED && idle(page), 'the launch reported as sent but not arrived');
    const validUntil = page.approval.requests[0].validUntil * 1000;

    // Just before the request expires (plus a minute for clocks that differ): still off.
    page.clock.ahead = validUntil + MINUTE - Date.now() - 10_000;
    page.$('recheck').fire('click');
    await until(() => idle(page), 'the page to settle');
    expect(page.$('deploy').disabled).toBe(true);
    expect(page.$('deploy-status').text).toBe(SENT_NOT_ARRIVED);

    // After that the network would refuse the first one, so a second cannot launch twice.
    page.clock.ahead = validUntil + MINUTE - Date.now() + 10_000;
    page.$('recheck').fire('click');
    await until(() => page.$('deploy-status').text.startsWith('That transaction did not arrive') && idle(page), 'the expiry notice');
    expect(page.$('deploy-status').text).toBe('That transaction did not arrive before it expired. You can press Deploy again.');
    expect(page.$('deploy').disabled).toBe(false);

    await launch(page);
    expect(page.approval.requests).toHaveLength(2);
  });

  it('keeps the rehearsal waiting through failed reads instead of giving up', async () => {
    const page = await openAndConnect();
    await launch(page);
    // The wallet sends the rehearsal. The next six calls to the server get no answer: one whole read.
    page.approval.handle = async (request) => {
      await approve(alice.address)(request);
      page.network.failNext = 6;
      return { boc: '' };
    };

    page.$('rehearse').fire('click');
    await until(() => page.$('rehearsal-status').text.startsWith('Done.'), 'a finished rehearsal');

    expect(page.$('rehearsal-status').text).toBe('Done. 1 LORA burned in total; the supply is now 99,999,999.');
    expect(page.approval.requests).toHaveLength(2);
  });

  it('on mainnet unlocks Deploy only when all three statements are ticked, and offers no rehearsal', async () => {
    const page = await openAndConnect('mainnet');
    expect(page.$('network').text).toBe('MAINNET');
    expect(page.$('mainnet-confirm').hidden).toBe(false);
    expect(page.boxes).toHaveLength(3);

    expect(page.$('deploy').disabled).toBe(true);
    for (const [index, box] of page.boxes.entries()) {
      box.checked = true;
      box.fire('change');
      expect(page.$('deploy').disabled).toBe(index < page.boxes.length - 1);
    }
    page.boxes[1].checked = false;
    page.boxes[1].fire('change');
    expect(page.$('deploy').disabled).toBe(true);
    page.boxes[1].checked = true;
    page.boxes[1].fire('change');

    await launch(page);

    const [request] = page.approval.requests;
    expect(request.network).toBe('-239');
    expect(Address.parseFriendly(request.messages[0].address).isTestOnly).toBe(false);
    expect(page.$('step-rehearsal').hidden).toBe(true);
    expect(page.$('next').text).toContain('LORA is live on mainnet.');
    expect(page.$('next').text).toContain(`npm run jetton:verify -- --network=mainnet --master=${request.messages[0].address}`);
    expect(page.$('explorer').href).toBe(`https://tonviewer.com/${request.messages[0].address}`);
  });

  it('forgets everything about a wallet when it disconnects', async () => {
    const page = await openAndConnect();

    page.wallet(null);

    for (const id of ['step-deploy', 'step-verify', 'step-rehearsal', 'step-next']) expect(page.$(id).hidden).toBe(true);
    expect(page.$('wallet-status').text).toBe('');
    // A click that arrives late finds nothing to send.
    expect(page.$('deploy').disabled).toBe(true);
  });
});
