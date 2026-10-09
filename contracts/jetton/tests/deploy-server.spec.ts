import { type IncomingHttpHeaders, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { Address, Cell, loadStateInit, toNano } from '@ton/core';
import { internal } from '@ton/sandbox';
import { JettonMaster } from '../build/LuminaraJetton_JettonMaster';
import { type AppResponse, createDeployApp, createDeployServer, type DeployApp, type DeployServerConfig } from '../src/deployServer';
import { checkMainnetGate, loadPinnedCodeHashes, type TonConnectRequest } from '../src/deployment';
import { buildOnchainContent, type LocalNet, loadTokenProfile, OP, startLocalNet, TEST_SEED } from './harness';

/**
 * The deploy page's server, driven end to end without a network. Its chain
 * reads are pointed at a local sandbox, and the tests play the part of the
 * wallet by sending the requests it produces on that sandbox.
 *
 * Everything the page can ask for is tested on the app directly, with no
 * socket in between. The last block then checks the HTTP layer around it.
 */
describe.skipIf(process.env.JETTON_MUTATION_RUN)('Deploy page server', () => {
  const profile = loadTokenProfile();
  const HOST = '127.0.0.1:4780';
  let net: LocalNet;
  let app: DeployApp;

  const config = (overrides: Partial<DeployServerConfig> = {}): DeployServerConfig => ({
    network: 'testnet',
    profile,
    value: toNano('1'),
    provide: (address) => net.blockchain.provider(address),
    manifestUrl: 'https://example.invalid/tonconnect-manifest.json',
    // Any readable file: these tests never load the browser bundle.
    tonConnectBundle: fileURLToPath(new URL('../token.json', import.meta.url)),
    pollMs: 10,
    ...overrides,
  });

  const json = (response: AppResponse) => JSON.parse(response.body.toString()) as Record<string, any>;
  const get = (path: string, host = HOST) => app({ method: 'GET', url: path, host });
  const post = async (path: string, body: unknown, contentType = 'application/json') => {
    const response = await app({ method: 'POST', url: path, host: HOST, contentType, body: Buffer.from(JSON.stringify(body)) });
    return { status: response.status, body: json(response) };
  };

  /** Does what a wallet does with a TON Connect request: sends each message from the given address. */
  async function approve(from: Address, request: TonConnectRequest) {
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
  }

  beforeEach(async () => {
    net = await startLocalNet(TEST_SEED);
    app = createDeployApp(config());
  });

  it('serves the page with a policy that only lets it talk to itself and to wallets', async () => {
    const response = await get('/');
    const html = response.body.toString();

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(html).toContain('never asks for a recovery phrase');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    const policy = response.headers['content-security-policy'];
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("form-action 'none'");
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');

    // The two scripts the page loads, and nothing else by that method.
    for (const script of ['/app.js', '/tonconnect-ui.min.js']) {
      const served = await get(script);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe('text/javascript; charset=utf-8');
    }
    expect((await app({ method: 'POST', url: '/app.js', host: HOST })).status).toBe(404);
  });

  it('refuses requests that are not addressed to the loopback interface', async () => {
    // What a DNS-rebinding page would send: the right port, somebody else's host name.
    expect((await get('/api/context', 'evil.example')).status).toBe(403);
    expect((await get('/api/context', 'evil.example:4780')).status).toBe(403);
    expect((await get('/api/context', '127.0.0.1.evil.example')).status).toBe(403);
    expect((await get('/api/context', '')).status).toBe(403);
    expect((await get('/', 'evil.example')).status).toBe(403);

    expect((await get('/api/context', 'localhost:4780')).status).toBe(200);
    expect((await get('/api/context', '127.0.0.1')).status).toBe(200);
  });

  it('describes the token and the network to the page', async () => {
    const context = json(await get('/api/context'));

    expect(context.network).toBe('testnet');
    expect(context.chainId).toBe('-3');
    expect(context.token.symbol).toBe('LORA');
    expect(context.token.supply).toBe('100,000,000');
    expect(context.value).toBe('1');
    expect(context.codeHashes).toEqual(loadPinnedCodeHashes());
  });

  it('launches for the connected wallet, then verifies what landed', async () => {
    const wallet = net.wallets.alice.address;

    const prepared = await post('/api/prepare', { wallet: wallet.toRawString() });
    expect(prepared.status).toBe(200);
    expect(Address.parse(prepared.body.admin).equals(wallet)).toBe(true);
    expect(prepared.body.alreadyLaunched).toBe(false);
    expect(prepared.body.request.network).toBe('-3');
    expect(prepared.body.request.from).toBe(wallet.toRawString());
    expect(Cell.fromBase64(prepared.body.request.messages[0].payload).beginParse().loadUint(32)).toBe(OP.launch);

    const before = await post('/api/verify', { wallet: wallet.toRawString(), wait: 0 });
    expect(before.body.status).toBe('pending');

    await approve(wallet, prepared.body.request);

    const after = await post('/api/verify', { wallet: wallet.toRawString(), wait: 5 });
    expect(after.body).toMatchObject({ status: 'verified', mode: 'fresh', burned: '0', totalSupply: '100,000,000' });
    expect(after.body.checks.map((c: { status: string }) => c.status)).not.toContain('fail');
    expect((await post('/api/prepare', { wallet: wallet.toRawString() })).body.alreadyLaunched).toBe(true);
  });

  it('tells the caller once a launch has been verified, and not before', async () => {
    const verified: { network: string; master: string; admin: string }[] = [];
    app = createDeployApp(config({ onVerified: (deployment) => verified.push(deployment) }));
    const wallet = net.wallets.alice.address;

    const prepared = await post('/api/prepare', { wallet: wallet.toRawString() });
    await post('/api/verify', { wallet: wallet.toRawString(), wait: 0 });
    expect(verified).toEqual([]);

    await approve(wallet, prepared.body.request);
    await post('/api/verify', { wallet: wallet.toRawString(), wait: 5 });
    expect(verified).toEqual([{ network: 'testnet', master: prepared.body.master, admin: prepared.body.admin }]);
  });

  it('reports a contract that someone else deployed without launching as not launched, and still launches it', async () => {
    const wallet = net.wallets.alice.address;
    const prepared = await post('/api/prepare', { wallet: wallet.toRawString() });
    const [message] = prepared.body.request.messages;

    // A stranger puts the same code at the address with a plain transfer. They cannot launch it.
    await net.blockchain.sendMessage(
      internal({
        from: net.wallets.mallory.address,
        to: Address.parse(message.address),
        value: toNano('1'),
        stateInit: loadStateInit(Cell.fromBase64(message.stateInit).beginParse()),
        body: new Cell(),
        bounce: true,
      }),
    );
    const shell = await post('/api/verify', { wallet: wallet.toRawString(), wait: 0 });
    expect(shell.body.status).toBe('pending');
    expect(shell.body.checks.filter((c: { status: string }) => c.status === 'fail').map((c: { name: string }) => c.name)).toEqual([
      'The token has been launched and minting is closed',
    ]);
    expect((await post('/api/prepare', { wallet: wallet.toRawString() })).body.alreadyLaunched).toBe(false);

    await approve(wallet, prepared.body.request);
    expect((await post('/api/verify', { wallet: wallet.toRawString(), wait: 5 })).body).toMatchObject({ status: 'verified', mode: 'fresh' });
  });

  it('a request approved from the wrong wallet launches nothing', async () => {
    const prepared = await post('/api/prepare', { wallet: net.wallets.alice.address.toRawString() });

    await approve(net.wallets.bob.address, prepared.body.request);

    expect((await post('/api/verify', { wallet: net.wallets.alice.address.toRawString(), wait: 0 })).body.status).toBe('pending');
    expect((await post('/api/verify', { wallet: net.wallets.bob.address.toRawString(), wait: 0 })).body.status).toBe('pending');
  });

  it('runs the rehearsal from the admin wallet and reports the burn', async () => {
    const wallet = net.wallets.alice.address;
    await approve(wallet, (await post('/api/prepare', { wallet: wallet.toRawString() })).body.request);

    const rehearsal = await post('/api/rehearsal', { wallet: wallet.toRawString() });
    expect(rehearsal.status).toBe(200);
    expect(rehearsal.body.request.messages).toHaveLength(2);
    expect(rehearsal.body.request.from).toBe(wallet.toRawString());
    await approve(wallet, rehearsal.body.request);

    const after = await post('/api/verify', { wallet: wallet.toRawString(), wait: 0 });
    expect(after.body).toMatchObject({ status: 'verified', mode: 'live', burned: '1', totalSupply: '99,999,999' });
  });

  it('opens the mainnet gate only after the testnet token has been launched and rehearsed', async () => {
    const wallet = net.wallets.alice.address;
    const prepared = await post('/api/prepare', { wallet: wallet.toRawString() });
    const master = Address.parse(prepared.body.master);
    const gate = () =>
      checkMainnetGate((address) => net.blockchain.provider(address), { testnetMaster: master, profile, pinned: loadPinnedCodeHashes() });
    const failures = async () => (await gate()).checks.filter((c) => c.status === 'fail').map((c) => c.name);

    expect((await gate()).ok).toBe(false);
    expect(await failures()).toEqual(['The token contract exists']);

    await approve(wallet, prepared.body.request);
    expect((await gate()).ok).toBe(false);
    expect(await failures()).toEqual(['A real wallet has burned tokens on testnet']);

    await approve(wallet, (await post('/api/rehearsal', { wallet: wallet.toRawString() })).body.request);
    expect((await gate()).ok).toBe(true);
    expect(await failures()).toEqual([]);
  });

  it('keeps the mainnet gate shut for a testnet token that does not show what token.json says', async () => {
    const wallet = net.wallets.alice.address;
    const prepared = await post('/api/prepare', { wallet: wallet.toRawString() });
    const master = Address.parse(prepared.body.master);
    await approve(wallet, prepared.body.request);
    await approve(wallet, (await post('/api/rehearsal', { wallet: wallet.toRawString() })).body.request);
    const gate = () =>
      checkMainnetGate((address) => net.blockchain.provider(address), { testnetMaster: master, profile, pinned: loadPinnedCodeHashes() });
    expect((await gate()).ok).toBe(true);

    // The same thing as editing token.json after the rehearsal: the testnet token and the file no longer agree.
    await net.blockchain
      .openContract(JettonMaster.fromAddress(master))
      .send(
        net.wallets.alice.getSender(),
        { value: toNano('0.05') },
        { $$type: 'UpdateContent', queryId: 0n, content: buildOnchainContent({ ...profile.metadata, name: 'Something Else' }) },
      );

    const shut = await gate();
    expect(shut.ok).toBe(false);
    const failures = shut.checks.filter((c) => c.status === 'fail');
    expect(failures.map((c) => c.name)).toEqual(['The metadata is token.json']);
    expect(failures[0].detail).toMatch(/differs from token.json in: name.*rehearse it/);
  });

  it('rejects bad input with a clear message', async () => {
    expect((await post('/api/prepare', {})).body.error).toMatch(/Connect a wallet/);
    expect((await post('/api/prepare', { wallet: 'nonsense' })).body.error).toMatch(/not a TON address/);
    const mainnetFormat = net.wallets.alice.address.toString({ testOnly: false });
    expect((await post('/api/prepare', { wallet: mainnetFormat })).body.error).toMatch(/mainnet-format/);
    expect((await post('/api/prepare', { wallet: `-1:${'ab'.repeat(32)}` })).status).toBe(400);
    expect((await post('/api/prepare', { wallet: `0:${'00'.repeat(32)}` })).body.error).toMatch(/zero address/);
    expect((await post('/api/prepare', ['not', 'an', 'object'])).status).toBe(400);
    expect((await post('/api/prepare', { wallet: 'x' }, 'text/plain')).status).toBe(415);
    expect((await post('/api/prepare', { wallet: 'x'.repeat(10_000) })).status).toBe(413);
    expect((await get('/api/unknown')).status).toBe(404);
    expect((await get('/api/prepare')).status).toBe(404);
  });

  it('on mainnet prepares a mainnet request and never offers the rehearsal', async () => {
    app = createDeployApp(config({ network: 'mainnet' }));
    const wallet = net.wallets.alice.address.toRawString();

    const rehearsal = await post('/api/rehearsal', { wallet });
    expect(rehearsal.status).toBe(403);
    const prepared = await post('/api/prepare', { wallet });
    expect(prepared.body.request.network).toBe('-239');
    expect(Address.parseFriendly(prepared.body.master).isTestOnly).toBe(false);
    expect(Address.parseFriendly(prepared.body.request.messages[0].address)).toMatchObject({ isTestOnly: false, isBounceable: true });
  });

  describe('over HTTP', () => {
    interface Answer {
      status: number;
      headers: IncomingHttpHeaders;
      body: string;
    }

    /**
     * Requests over a real socket. One that gets no answer is sent again, for
     * up to 45 seconds in all: every request here only reads, and some
     * machines briefly time out new loopback connections.
     */
    function client(port: number) {
      const giveUpAt = Date.now() + 45_000;
      return async (options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Answer> => {
        for (;;) {
          try {
            return await new Promise<Answer>((resolve, reject) => {
              const request = httpRequest(
                { host: '127.0.0.1', port, agent: false, timeout: 5_000, method: options.method ?? 'GET', path: options.path, headers: options.headers },
                (response) => {
                  const chunks: Buffer[] = [];
                  response.on('data', (chunk: Buffer) => chunks.push(chunk));
                  response.on('end', () =>
                    resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }),
                  );
                  response.on('error', reject);
                },
              );
              request.on('timeout', () => request.destroy(new Error('No answer within 5 seconds.')));
              request.on('error', reject);
              request.end(options.body);
            });
          } catch (error) {
            if (Date.now() > giveUpAt) throw error;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      };
    }

    it('answers on the loopback interface with the same app', async () => {
      const server = createDeployServer(config());
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { address, port } = server.address() as AddressInfo;
      const http = client(port);
      const wallet = net.wallets.alice.address.toRawString();
      const asJson = { 'content-type': 'application/json' };

      try {
        expect(address).toBe('127.0.0.1');

        const page = await http({ path: '/' });
        expect(page.status).toBe(200);
        expect(page.headers['content-security-policy']).toContain("default-src 'none'");
        expect(page.body).toContain('never asks for a recovery phrase');

        const prepared = await http({ method: 'POST', path: '/api/prepare', headers: asJson, body: JSON.stringify({ wallet }) });
        expect(prepared.status).toBe(200);
        expect(JSON.parse(prepared.body).request.network).toBe('-3');

        // The Host header and the content type are read from the real request.
        expect((await http({ path: '/api/context', headers: { host: 'evil.example' } })).status).toBe(403);
        expect((await http({ method: 'POST', path: '/api/prepare', body: JSON.stringify({ wallet }) })).status).toBe(415);

        // An upload far past the limit is refused, and answered rather than cut off.
        const huge = await http({ method: 'POST', path: '/api/prepare', headers: asJson, body: JSON.stringify({ wallet: 'x'.repeat(2_000_000) }) });
        expect(huge.status).toBe(413);
        expect(JSON.parse(huge.body).error).toMatch(/too large/);
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          // A connection the client gave up on must not keep the server, and the test run, open.
          server.closeAllConnections();
        });
      }
    });
  });
});
