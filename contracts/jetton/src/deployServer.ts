/**
 * The local deploy page.
 *
 * A small HTTP server, bound to 127.0.0.1 only, that serves one page. On that
 * page you connect your own wallet with TON Connect and approve a
 * transaction in the wallet app. The server computes what to send, proves it
 * on a local sandbox first, and afterwards reads the chain to check the
 * result.
 *
 * The server never sees a key or a seed phrase and cannot sign anything. The
 * only thing that can spend Toncoin is your wallet app, when you approve.
 *
 * The connected wallet is always the admin: the contract only lets the admin
 * launch it, so the supply can only ever go to a wallet that has just proven
 * it can sign.
 *
 * createDeployApp holds everything the page can ask for and knows nothing
 * about sockets, so it is tested directly. createDeployServer is the thin
 * HTTP layer around it.
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type Address, fromNano } from '@ton/core';
import {
  CHAIN_ID,
  type Check,
  deploymentAddresses,
  loadPinnedCodeHashes,
  type Network,
  parseAddressFor,
  prepareDeployment,
  prepareRehearsal,
  type ProviderFactory,
  REHEARSAL_TOKENS,
  verifyDeployment,
} from './deployment';
import { EXPLORER } from './network';
import { formatUnits, supplyInUnits, type TokenProfile } from './token';

export interface DeployServerConfig {
  network: Network;
  profile: TokenProfile;
  /** Toncoin sent with the launch. */
  value: bigint;
  /** Read access to the network being deployed to. */
  provide: ProviderFactory;
  manifestUrl: string;
  /** File path of the TON Connect UI browser bundle. */
  tonConnectBundle: string;
  /** Milliseconds between chain reads while waiting for a transaction to land. */
  pollMs?: number;
  /**
   * Called each time a launch has been prepared for a wallet. The deploy tool
   * prints it in the terminal: a second place to read the address the wallet
   * app must show, one that the page and its scripts cannot change.
   */
  onPrepared?: (launch: { network: Network; admin: string; master: string; value: string }) => void;
  /** Called each time a launched token has been verified on-chain, so the caller can record it. */
  onVerified?: (deployment: { network: Network; master: string; admin: string }) => void;
}

/** A request as the page sends it, without the connection it arrived on. */
export interface AppRequest {
  method: string;
  /** The request target: a path, with or without a query string. */
  url: string;
  /** The Host header. */
  host: string;
  contentType?: string;
  /** The request body as received. */
  body?: Buffer;
}

export interface AppResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
}

export type DeployApp = (request: AppRequest) => Promise<AppResponse>;

const PAGE = new URL('../scripts/deploy-page.html', import.meta.url);
const SCRIPT = new URL('../scripts/deploy-page.js', import.meta.url);
const MAX_BODY_BYTES = 8 * 1024;
const MAX_WAIT_SECONDS = 180;
const CODE_CHECK = 'The token contract runs the reviewed code';
const ADMIN_WALLET_CHECK = 'The admin wallet exists and runs the reviewed code';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseJson(request: AppRequest): Record<string, unknown> {
  if (!String(request.contentType ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Send JSON.');
  }
  const body = request.body ?? Buffer.alloc(0);
  if (body.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
  try {
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Request body is not a JSON object.');
  }
}

/**
 * Reads a request body, keeping no more than the app is willing to look at
 * (plus the chunk that crosses the limit, so the app can tell it was too
 * large). Whatever follows is read and dropped, so an answer can still be sent.
 */
function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
      size += chunk.length;
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

export function createDeployApp(config: DeployServerConfig): DeployApp {
  const { network, profile, provide } = config;
  const testOnly = network === 'testnet';
  const friendly = (address: Address) => address.toString({ bounceable: true, testOnly });
  const pollMs = config.pollMs ?? 4_000;
  const genesis = supplyInUnits(profile);

  const walletFrom = (body: Record<string, unknown>): Address => {
    if (typeof body.wallet !== 'string') throw new HttpError(400, 'Connect a wallet first.');
    try {
      const wallet = parseAddressFor(network, body.wallet);
      if (wallet.workChain !== 0) throw new Error('The wallet must be in the basechain (workchain 0).');
      return wallet;
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Invalid wallet address.');
    }
  };

  const verify = (master: Address, admin: Address, fresh: boolean) =>
    verifyDeployment(provide, { master, admin, profile, pinned: loadPinnedCodeHashes(), fresh });

  const routes: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
    'GET /api/context': async () => ({
      network,
      chainId: CHAIN_ID[network],
      explorer: EXPLORER[network],
      manifestUrl: config.manifestUrl,
      token: {
        ...profile.metadata,
        supply: formatUnits(profile, genesis),
      },
      value: fromNano(config.value),
      codeHashes: loadPinnedCodeHashes(),
      rehearsalTokens: REHEARSAL_TOKENS,
    }),

    'POST /api/prepare': async (body) => {
      const admin = walletFrom(body);
      const prepared = await prepareDeployment({ network, admin, profile, value: config.value });
      const onChain = await verify(prepared.master, admin, false);
      if (!onChain.launched) {
        config.onPrepared?.({ network, admin: friendly(admin), master: friendly(prepared.master), value: fromNano(prepared.value) });
      }
      return {
        admin: friendly(admin),
        master: friendly(prepared.master),
        adminWallet: friendly(prepared.adminWallet),
        value: fromNano(prepared.value),
        request: prepared.request,
        dryRun: prepared.dryRun,
        alreadyLaunched: onChain.launched,
      };
    },

    'POST /api/verify': async (body) => {
      const admin = walletFrom(body);
      const wait = Math.min(Math.max(Number(body.wait) || 0, 0), MAX_WAIT_SECONDS);
      const deadline = Date.now() + wait * 1000;
      const { master } = await deploymentAddresses(admin, profile);
      const reply = (status: 'pending' | 'verified' | 'failed', mode: 'fresh' | 'live' | null, checks: Check[], totalSupply?: bigint) => {
        if (status === 'verified') config.onVerified?.({ network, master: friendly(master), admin: friendly(admin) });
        return {
          status,
          mode,
          master: friendly(master),
          checks,
          totalSupply: totalSupply === undefined ? null : formatUnits(profile, totalSupply),
          burned: totalSupply === undefined ? '0' : formatUnits(profile, genesis - totalSupply),
        };
      };

      for (;;) {
        const fresh = await verify(master, admin, true);
        if (fresh.ok) return reply('verified', 'fresh', fresh.checks, fresh.totalSupply);
        const failed = fresh.checks.filter((c) => c.status === 'fail').map((c) => c.name);
        if (failed.includes(CODE_CHECK)) return reply('failed', null, fresh.checks);

        // Nothing there yet, launch not processed yet, or the genesis mint is still on
        // its way to the admin wallet (it lands a few seconds after the launch).
        const stillLanding = !fresh.launched || failed.every((name) => name === ADMIN_WALLET_CHECK);
        if (stillLanding && Date.now() < deadline) {
          await sleep(pollMs);
          continue;
        }
        if (!fresh.launched) return reply('pending', null, fresh.checks);

        // Launched but not pristine: either something is wrong, or the token has been used since.
        const live = await verify(master, admin, false);
        return live.ok
          ? reply('verified', 'live', live.checks, live.totalSupply)
          : reply('failed', 'live', fresh.checks, fresh.totalSupply);
      }
    },

    'POST /api/rehearsal': async (body) => {
      if (network !== 'testnet') throw new HttpError(403, 'The rehearsal burns tokens. It only runs on testnet.');
      return { request: await prepareRehearsal({ admin: walletFrom(body), profile }) };
    },
  };

  const files: Record<string, { read: () => Buffer; type: string }> = {
    '/': { read: () => readFileSync(PAGE), type: 'text/html; charset=utf-8' },
    '/app.js': { read: () => readFileSync(SCRIPT), type: 'text/javascript; charset=utf-8' },
    '/tonconnect-ui.min.js': { read: () => readFileSync(config.tonConnectBundle), type: 'text/javascript; charset=utf-8' },
  };

  const headers = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    // The page talks to this server, to TON Connect bridges and to the wallet list. Nothing else.
    'content-security-policy':
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; " +
      "connect-src 'self' https: wss:; font-src 'self' data:; frame-src https:; base-uri 'none'; form-action 'none'",
  };

  return async (request) => {
    const reply = (status: number, type: string, body: string | Buffer): AppResponse => ({
      status,
      headers: { ...headers, 'content-type': type },
      body,
    });
    try {
      // Only answer requests addressed to this machine by its loopback name,
      // so a web page elsewhere cannot reach the server through a DNS trick.
      const host = request.host.replace(/:\d+$/, '');
      if (host !== '127.0.0.1' && host !== 'localhost') throw new HttpError(403, 'This server only answers on 127.0.0.1.');

      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      const file = request.method === 'GET' ? files[path] : undefined;
      if (file) return reply(200, file.type, file.read());

      const route = routes[`${request.method} ${path}`];
      if (!route) throw new HttpError(404, 'Not found.');
      const body = request.method === 'POST' ? parseJson(request) : {};
      return reply(200, 'application/json; charset=utf-8', JSON.stringify(await route(body)));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      return reply(status, 'application/json; charset=utf-8', JSON.stringify({ error: message }));
    }
  };
}

/** The app behind an HTTP server. The caller binds it, to 127.0.0.1 only. */
export function createDeployServer(config: DeployServerConfig): Server {
  const app = createDeployApp(config);
  return createServer((request, response) => {
    void (async () => {
      try {
        const answer = await app({
          method: request.method ?? 'GET',
          url: request.url ?? '/',
          host: String(request.headers.host ?? ''),
          contentType: request.headers['content-type'],
          body: request.method === 'POST' ? await readBody(request) : undefined,
        });
        response.writeHead(answer.status, answer.headers);
        response.end(answer.body);
      } catch {
        // The request broke off while it was being read. There is nobody to answer.
        response.destroy();
      }
    })();
  });
}
