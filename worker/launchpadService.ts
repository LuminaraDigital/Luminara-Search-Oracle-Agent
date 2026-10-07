/**
 * SMB Launchpad Worker routes (migration 0018). Non-custodial: stores campaign copy,
 * the merchant-registered contract address, and voucher redemption records only.
 * Invariants are documented in worker/README.md and specs/0015-smb-launchpad.md.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { enforceDualRateLimit } from './securityHardening';
import {
  LAUNCHPAD_LIMITS,
  scanCampaignCompliance,
  type CampaignType,
  type ComplianceMilestoneInput,
} from '../services/launchpad/compliance';
import {
  VOUCHER_CODE_RE,
  generateVoucherCode,
  isLaunchpadChain,
  isLaunchpadNetwork,
  normaliseEvmAddress,
} from '../services/launchpad/contracts';
import {
  makeRpc,
  readEscrowSnapshot,
  resolveFactoryAddress,
  resolveRpcUrl,
  verifyDeployment,
  type RpcCall,
} from '../services/launchpad/chainVerify';

type Who = { user: HostedIdentity | null; error?: string };

/** Injectable for tests so no network is touched. */
export interface LaunchpadDeps {
  rpcFor?: (chain: 'xdc' | 'polygon', network: 'testnet' | 'mainnet') => RpcCall;
}

const ID_RE = /^camp_[a-z0-9_]{6,64}$/;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const SYMBOL_RE = /^[A-Z0-9]{2,8}$/;
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;
const ABN_NZBN_RE = /^[0-9 ]{11,17}$/;
const MIN_EXPIRY_MONTHS = 36;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEGRAM_CHAT_RE = /^(-?[0-9]{5,16}|@[a-zA-Z0-9_]{4,32})$/;
const WEBHOOK_RE = /^https:\/\/[^\s/$.?#].[^\s]*$/i;

export interface MilestoneAlertPayload {
  campaignId: string;
  campaignTitle: string;
  businessName: string;
  milestoneIndex: number;
  challengeEndsAt: number;
  proofUri: string;
}

export async function dispatchMilestoneAlerts(
  env: Env,
  campaignId: string,
  payload: MilestoneAlertPayload,
): Promise<{ dispatched: number; errors: number }> {
  if (!env.DB) return { dispatched: 0, errors: 0 };
  const rows = await env.DB.prepare(
    `SELECT subscriber_ref, channel FROM launchpad_subscriptions WHERE campaign_id = ?`,
  ).bind(campaignId).all<{ subscriber_ref: string; channel: string }>();

  let dispatched = 0;
  let errors = 0;
  for (const sub of rows.results || []) {
    try {
      const botToken = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
      if (sub.channel === 'telegram' && botToken) {
        const text = `Milestone Alert: ${payload.businessName} submitted proof for milestone #${payload.milestoneIndex + 1} (${payload.campaignTitle}).\n\nProof: ${payload.proofUri}\n\nChallenge window ends: ${new Date(payload.challengeEndsAt * 1000).toUTCString()}. Review proof or lodge objections in the app before it closes.`;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: sub.subscriber_ref, text }),
        });
        dispatched++;
      } else if (sub.channel === 'webhook') {
        await fetch(sub.subscriber_ref, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event: 'milestone_submitted', ...payload }),
          signal: AbortSignal.timeout(5000),
        });
        dispatched++;
      } else {
        // Email channel or logged notification
        dispatched++;
      }
    } catch {
      errors++;
    }
  }
  return { dispatched, errors };
}

const PUBLIC_CAMPAIGN_COLUMNS = `id, domain, business_name, country, campaign_type, title, description,
  chain, network, token_name, token_symbol, contract_address, target_fiat_cents, fiat_currency,
  voucher_expiry_months, listed_at, created_at`;

function newId(prefix: string): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Date.now().toString(36)}_${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16)}`;
}

export function isLaunchpadEnabled(env: Pick<Env, 'ENVIRONMENT' | 'LAUNCHPAD_ENABLED'>): boolean {
  const flag = String(env.LAUNCHPAD_ENABLED || '').trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return !String(env.ENVIRONMENT || '').trim(); // unset flag: on in local dev only
}

function mainnetAllowed(env: Pick<Env, 'LAUNCHPAD_MAINNET_ENABLED'>): boolean {
  return String(env.LAUNCHPAD_MAINNET_ENABLED || '').trim().toLowerCase() === 'true';
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= max ? s : null;
}

function requireUser(who: Who): { accountId: string } | Response {
  if (!who.user) {
    return json({ ok: false, error: who.error || 'Sign in to manage campaigns.', code: 'AUTH_REQUIRED' }, 401);
  }
  return { accountId: billingId(who.user) };
}

async function rateLimit(env: Env, request: Request, action: string, accountId: string | null, limit: number, windowSec: number) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rl = await enforceDualRateLimit(env, { action, accountId, ip, limitPerKey: limit, windowSec });
  return rl.ok ? null : rl.response;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

interface ValidCampaign {
  businessName: string;
  title: string;
  description: string;
  campaignType: CampaignType;
  domain: string | null;
  abnNzbn: string | null;
  country: 'AU' | 'NZ';
  chain: 'xdc' | 'polygon';
  network: 'testnet' | 'mainnet';
  tokenName: string | null;
  tokenSymbol: string | null;
  targetFiatCents: number;
  fiatCurrency: 'AUD' | 'NZD';
  voucherExpiryMonths: number | null;
  milestones: ComplianceMilestoneInput[];
}

/** Returns a validated campaign or a human-readable error. Exported for tests. */
export function validateCampaignBody(body: Record<string, unknown>, env: Pick<Env, 'LAUNCHPAD_MAINNET_ENABLED'>): ValidCampaign | string {
  const businessName = str(body.businessName, LAUNCHPAD_LIMITS.businessNameMax);
  if (!businessName) return `businessName is required (max ${LAUNCHPAD_LIMITS.businessNameMax} characters).`;
  const title = str(body.title, LAUNCHPAD_LIMITS.titleMax);
  if (!title) return `title is required (max ${LAUNCHPAD_LIMITS.titleMax} characters).`;
  const description = str(body.description, LAUNCHPAD_LIMITS.descriptionMax);
  if (!description) return `description is required (max ${LAUNCHPAD_LIMITS.descriptionMax} characters).`;
  const campaignType = body.campaignType;
  if (campaignType !== 'closed_loop_loyalty' && campaignType !== 'milestone_preorder') {
    return 'campaignType must be closed_loop_loyalty or milestone_preorder.';
  }

  let domain: string | null = null;
  if (body.domain != null && body.domain !== '') {
    const d = String(body.domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!DOMAIN_RE.test(d)) return 'domain must be a bare hostname such as example.com.au.';
    domain = d;
  }

  let abnNzbn: string | null = null;
  if (body.abnNzbn != null && body.abnNzbn !== '') {
    const a = String(body.abnNzbn).trim();
    if (!ABN_NZBN_RE.test(a)) return 'abnNzbn must be an 11-digit ABN or 13-digit NZBN.';
    abnNzbn = a.replace(/\s+/g, '');
    if (abnNzbn.length !== 11 && abnNzbn.length !== 13) return 'abnNzbn must be an 11-digit ABN or 13-digit NZBN.';
  }

  const country = body.country == null ? 'AU' : body.country;
  if (country !== 'AU' && country !== 'NZ') return 'country must be AU or NZ.';

  const chain = body.chain == null ? 'xdc' : body.chain;
  if (!isLaunchpadChain(chain)) return 'chain must be xdc or polygon.';
  const network = body.network == null ? 'testnet' : body.network;
  if (!isLaunchpadNetwork(network)) return 'network must be testnet or mainnet.';
  if (network === 'mainnet' && !mainnetAllowed(env)) {
    return 'Mainnet campaigns are not open yet. Use testnet while contracts complete audit.';
  }

  const tokenName = body.tokenName == null || body.tokenName === '' ? null : str(body.tokenName, 64);
  if (body.tokenName && !tokenName) return 'tokenName max 64 characters.';
  let tokenSymbol: string | null = null;
  if (body.tokenSymbol != null && body.tokenSymbol !== '') {
    const s = String(body.tokenSymbol).trim().toUpperCase();
    if (!SYMBOL_RE.test(s)) return 'tokenSymbol must be 2 to 8 letters or digits.';
    tokenSymbol = s;
  }

  const targetFiatCents = body.targetFiatCents == null ? 0 : Number(body.targetFiatCents);
  if (!Number.isInteger(targetFiatCents) || targetFiatCents < 0 || targetFiatCents > LAUNCHPAD_LIMITS.targetFiatCentsMax) {
    return 'targetFiatCents must be a whole number of cents up to 1,000,000.00.';
  }
  const fiatCurrency = body.fiatCurrency == null ? (country === 'NZ' ? 'NZD' : 'AUD') : body.fiatCurrency;
  if (fiatCurrency !== 'AUD' && fiatCurrency !== 'NZD') return 'fiatCurrency must be AUD or NZD.';

  let voucherExpiryMonths: number | null = null;
  if (body.voucherExpiryMonths != null) {
    const m = Number(body.voucherExpiryMonths);
    if (!Number.isInteger(m) || m < MIN_EXPIRY_MONTHS || m > 120) {
      return `voucherExpiryMonths must be ${MIN_EXPIRY_MONTHS} to 120, or omitted for no expiry (Australian gift card rules require at least 3 years).`;
    }
    voucherExpiryMonths = m;
  }

  const milestones: ComplianceMilestoneInput[] = [];
  if (campaignType === 'milestone_preorder') {
    if (!Array.isArray(body.milestones)) return 'milestones are required for pre-order campaigns.';
    if (body.milestones.length < LAUNCHPAD_LIMITS.milestonesMin || body.milestones.length > LAUNCHPAD_LIMITS.milestonesMax) {
      return `Pre-orders need ${LAUNCHPAD_LIMITS.milestonesMin} to ${LAUNCHPAD_LIMITS.milestonesMax} milestones.`;
    }
    for (const raw of body.milestones as unknown[]) {
      const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const mt = str(m.title, LAUNCHPAD_LIMITS.milestoneTitleMax);
      const pct = Number(m.payoutPercentage);
      if (!mt || !Number.isInteger(pct) || pct <= 0 || pct > 100) {
        return 'Each milestone needs a title and a whole-number payoutPercentage between 1 and 100.';
      }
      const md = m.description == null || m.description === '' ? undefined : str(m.description, 500) ?? undefined;
      milestones.push({ title: mt, description: md, payoutPercentage: pct });
    }
  }

  return {
    businessName, title, description, campaignType, domain, abnNzbn, country, chain, network,
    tokenName, tokenSymbol, targetFiatCents, fiatCurrency, voucherExpiryMonths, milestones,
  };
}

async function loadOwnedCampaign(env: Env, campaignId: string, accountId: string) {
  return env.DB!.prepare(`SELECT * FROM launchpad_campaigns WHERE id = ? AND account_id = ?`)
    .bind(campaignId, accountId)
    .first<Record<string, unknown>>();
}

export async function handleLaunchpadRoute(request: Request, env: Env, who: Who, path: string, deps: LaunchpadDeps = {}): Promise<Response | null> {
  if (path !== '/launchpad' && !path.startsWith('/launchpad/')) return null;
  if (!isLaunchpadEnabled(env)) return json({ ok: false, error: 'Not found' }, 404);
  const method = request.method;

  // Public copy screen. Rate limited by IP; no DB needed.
  if (path === '/launchpad/scan-compliance' && method === 'POST') {
    const limited = await rateLimit(env, request, 'launchpad_scan', who.user ? billingId(who.user) : null, 30, 60);
    if (limited) return limited;
    const body = await readJson(request);
    if (!body) return json({ ok: false, error: 'JSON body required' }, 400);
    const v = validateCampaignBody(body, { LAUNCHPAD_MAINNET_ENABLED: 'true' });
    if (typeof v === 'string') return json({ ok: false, error: v }, 400);
    return json({ ok: true, report: scanCampaignCompliance(v) });
  }

  // Which factories exist and whether mainnet is open. No DB, no secrets.
  if (path === '/launchpad/config' && method === 'GET') {
    const envVars = env as unknown as Record<string, string | undefined>;
    const factories: Record<string, Record<string, string | null>> = {};
    for (const chain of ['xdc', 'polygon'] as const) {
      factories[chain] = {
        testnet: resolveFactoryAddress(chain, 'testnet', envVars),
        mainnet: mainnetAllowed(env) ? resolveFactoryAddress(chain, 'mainnet', envVars) : null,
      };
    }
    return json({ ok: true, factories, mainnetEnabled: mainnetAllowed(env) });
  }

  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);
  const db = env.DB;

  // List: public sees listed campaigns only; ?mine=true returns the caller's drafts and listings.
  if (path === '/launchpad/campaigns' && method === 'GET') {
    const mine = new URL(request.url).searchParams.get('mine') === 'true';
    if (mine) {
      const auth = requireUser(who);
      if (auth instanceof Response) return auth;
      const rows = await db.prepare(
        `SELECT ${PUBLIC_CAMPAIGN_COLUMNS}, compliance_status, updated_at FROM launchpad_campaigns
         WHERE account_id = ? ORDER BY created_at DESC LIMIT 50`,
      ).bind(auth.accountId).all();
      return json({ ok: true, campaigns: rows.results || [] });
    }
    const rows = await db.prepare(
      `SELECT ${PUBLIC_CAMPAIGN_COLUMNS} FROM launchpad_campaigns
       WHERE listed_at IS NOT NULL AND compliance_status = 'approved'
       ORDER BY listed_at DESC LIMIT 50`,
    ).all();
    return json({ ok: true, campaigns: rows.results || [] });
  }

  // Create draft (not public until a contract address is registered).
  if (path === '/launchpad/campaigns' && method === 'POST') {
    const auth = requireUser(who);
    if (auth instanceof Response) return auth;
    const limited = await rateLimit(env, request, 'launchpad_create', auth.accountId, 10, 3600);
    if (limited) return limited;
    const body = await readJson(request);
    if (!body) return json({ ok: false, error: 'JSON body required' }, 400);
    if (body.termsAccepted !== true) {
      return json({ ok: false, error: 'Accept the launchpad terms to create a campaign.' }, 400);
    }
    const v = validateCampaignBody(body, env);
    if (typeof v === 'string') return json({ ok: false, error: v }, 400);

    const compliance = scanCampaignCompliance(v);
    if (!compliance.approved) {
      return json({ ok: false, error: 'Campaign copy needs changes before it can be saved.', compliance }, 422);
    }

    const campaignId = newId('camp');
    const now = new Date().toISOString();
    const stmts = [
      db.prepare(
        `INSERT INTO launchpad_campaigns (
           id, account_id, domain, business_name, abn_nzbn, country, campaign_type, title, description,
           compliance_status, compliance_details, chain, network, token_name, token_symbol,
           target_fiat_cents, fiat_currency, voucher_expiry_months, terms_accepted_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        campaignId, auth.accountId, v.domain, v.businessName, v.abnNzbn, v.country, v.campaignType, v.title,
        v.description, compliance.status, JSON.stringify(compliance), v.chain, v.network, v.tokenName,
        v.tokenSymbol, v.targetFiatCents, v.fiatCurrency, v.voucherExpiryMonths, now, now, now,
      ),
      ...v.milestones.map((m, idx) =>
        db.prepare(
          `INSERT INTO launchpad_milestones (id, campaign_id, milestone_index, title, description, payout_percentage, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(newId('ms'), campaignId, idx, m.title, m.description ?? null, m.payoutPercentage, now),
      ),
    ];
    await db.batch(stmts); // atomic: campaign and milestones land together or not at all
    return json({ ok: true, campaignId, compliance, listed: false });
  }

  // Register the deployed contract (merchant deployed from their own wallet). Lists the campaign.
  const contractMatch = /^\/launchpad\/campaigns\/([^/]+)\/contract$/.exec(path);
  if (contractMatch && (method === 'PUT' || method === 'POST')) {
    const auth = requireUser(who);
    if (auth instanceof Response) return auth;
    const campaignId = contractMatch[1];
    if (!ID_RE.test(campaignId)) return json({ ok: false, error: 'Invalid campaign id' }, 400);
    const body = await readJson(request);
    const address = normaliseEvmAddress(body?.contractAddress);
    if (!address) return json({ ok: false, error: 'contractAddress must be a 0x or xdc address.' }, 400);
    const txHash = body?.txHash == null || body.txHash === '' ? null : String(body.txHash).trim();
    if (txHash && !TX_HASH_RE.test(txHash)) return json({ ok: false, error: 'txHash must be a 0x-prefixed 32-byte hash.' }, 400);

    const campaign = await loadOwnedCampaign(env, campaignId, auth.accountId);
    if (!campaign) return json({ ok: false, error: 'Campaign not found' }, 404);
    if (campaign.compliance_status !== 'approved') return json({ ok: false, error: 'Campaign is not approved' }, 409);
    if (campaign.network === 'mainnet' && !mainnetAllowed(env)) {
      return json({ ok: false, error: 'Mainnet registration is not open yet.' }, 403);
    }
    if (campaign.contract_address) return json({ ok: false, error: 'A contract is already registered for this campaign.' }, 409);

    // Only contracts deployed by OUR factory may be listed. The skip flag is a testnet-only dev escape hatch.
    const chain = String(campaign.chain);
    const network = String(campaign.network);
    if (!isLaunchpadChain(chain) || !isLaunchpadNetwork(network)) return json({ ok: false, error: 'Campaign chain is invalid' }, 409);
    const envVars = env as unknown as Record<string, string | undefined>;
    const skipVerify = network === 'testnet' && envVars.LAUNCHPAD_SKIP_CHAIN_VERIFY === 'true';
    let merchantWallet: string | null = null;
    if (!skipVerify) {
      const factory = resolveFactoryAddress(chain, network, envVars);
      if (!factory) {
        return json({ ok: false, error: 'The Luminara factory is not deployed on this network yet, so contracts cannot be registered.' }, 409);
      }
      if (!txHash) return json({ ok: false, error: 'txHash of the factory deployment is required.' }, 400);
      const rpc = deps.rpcFor ? deps.rpcFor(chain, network) : makeRpc(resolveRpcUrl(chain, network, envVars));
      const verified = await verifyDeployment({
        rpc,
        factoryAddress: factory,
        txHash,
        contractAddress: address,
        kind: campaign.campaign_type === 'milestone_preorder' ? 'preorder_escrow' : 'loyalty_token',
      });
      if (typeof verified === 'string') return json({ ok: false, error: verified }, 422);
      merchantWallet = verified.merchantWallet;
    }

    const now = new Date().toISOString();
    try {
      const res = await db.prepare(
        `UPDATE launchpad_campaigns SET contract_address = ?, contract_tx_hash = ?, listed_at = ?, updated_at = ?
         WHERE id = ? AND account_id = ? AND contract_address IS NULL`,
      ).bind(address, txHash, now, now, campaignId, auth.accountId).run();
      if (!res.meta?.changes) return json({ ok: false, error: 'A contract is already registered for this campaign.' }, 409);
    } catch (err) {
      if (String(err).includes('UNIQUE')) return json({ ok: false, error: 'That contract is already registered to another campaign.' }, 409);
      throw err;
    }
    return json({ ok: true, campaignId, contractAddress: address, listedAt: now, merchantWallet });
  }

  // Live escrow figures read straight from the chain, with resilient caching.
  const onchainMatch = /^\/launchpad\/campaigns\/([^/]+)\/onchain$/.exec(path);
  if (onchainMatch && method === 'GET') {
    const campaignId = onchainMatch[1];
    if (!ID_RE.test(campaignId)) return json({ ok: false, error: 'Invalid campaign id' }, 400);
    const limited = await rateLimit(env, request, 'launchpad_onchain', who.user ? billingId(who.user) : null, 60, 60);
    if (limited) return limited;
    const row = await db.prepare(
      `SELECT chain, network, campaign_type, contract_address, title, business_name FROM launchpad_campaigns
       WHERE id = ? AND listed_at IS NOT NULL AND compliance_status = 'approved'`,
    ).bind(campaignId).first<Record<string, string | null>>();
    if (!row || !row.contract_address) return json({ ok: false, error: 'Campaign not found' }, 404);
    if (row.campaign_type !== 'milestone_preorder') return json({ ok: true, onchain: 'not_applicable' });
    const chain = String(row.chain);
    const network = String(row.network);
    if (!isLaunchpadChain(chain) || !isLaunchpadNetwork(network)) return json({ ok: false, error: 'Campaign chain is invalid' }, 409);

    const forceFresh = new URL(request.url).searchParams.get('fresh') === 'true';
    const cachedRow = await db.prepare(
      `SELECT snapshot_json, updated_at, last_notified_milestone FROM launchpad_snapshots WHERE campaign_id = ?`,
    ).bind(campaignId).first<{ snapshot_json: string; updated_at: string; last_notified_milestone: number }>();

    const now = Date.now();
    const isFresh = cachedRow && (now - new Date(cachedRow.updated_at).getTime()) < 30_000;
    if (isFresh && !forceFresh) {
      try {
        const cachedSnap = JSON.parse(cachedRow.snapshot_json);
        return json({ ok: true, onchain: cachedSnap, cached: true, cachedAt: cachedRow.updated_at });
      } catch {
        // Fall through to query chain
      }
    }

    try {
      const rpc = deps.rpcFor ? deps.rpcFor(chain, network) : makeRpc(resolveRpcUrl(chain, network, env as unknown as Record<string, string | undefined>));
      const snapshot = await readEscrowSnapshot(rpc, row.contract_address);
      const snapshotJson = JSON.stringify(snapshot);
      const nowIso = new Date().toISOString();

      let lastNotified = cachedRow ? cachedRow.last_notified_milestone : -1;
      const details = snapshot.currentMilestoneDetails;
      if (details?.submitted && snapshot.currentMilestone > lastNotified) {
        lastNotified = snapshot.currentMilestone;
        await dispatchMilestoneAlerts(env, campaignId, {
          campaignId,
          campaignTitle: String(row.title || ''),
          businessName: String(row.business_name || ''),
          milestoneIndex: snapshot.currentMilestone,
          challengeEndsAt: details.challengeEndsAt,
          proofUri: details.proofUri,
        });
      }

      await db.prepare(
        `INSERT INTO launchpad_snapshots (campaign_id, state, current_milestone, snapshot_json, last_notified_milestone, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id) DO UPDATE SET
           state = excluded.state,
           current_milestone = excluded.current_milestone,
           snapshot_json = excluded.snapshot_json,
           last_notified_milestone = excluded.last_notified_milestone,
           updated_at = excluded.updated_at`,
      ).bind(campaignId, snapshot.state, snapshot.currentMilestone, snapshotJson, lastNotified, nowIso).run();

      return json({ ok: true, onchain: snapshot, cached: false });
    } catch {
      if (cachedRow) {
        try {
          return json({ ok: true, onchain: JSON.parse(cachedRow.snapshot_json), cached: true, cachedAt: cachedRow.updated_at });
        } catch {
          // Fall through
        }
      }
      return json({ ok: true, onchain: 'not_measured' });
    }
  }

  // Backer opt-in to challenge window and milestone notifications.
  const subscribeMatch = /^\/launchpad\/campaigns\/([^/]+)\/subscribe$/.exec(path);
  if (subscribeMatch && method === 'POST') {
    const campaignId = subscribeMatch[1];
    if (!ID_RE.test(campaignId)) return json({ ok: false, error: 'Invalid campaign id' }, 400);
    const limited = await rateLimit(env, request, 'launchpad_subscribe', who.user ? billingId(who.user) : null, 15, 60);
    if (limited) return limited;
    const body = await readJson(request);
    const channel = String(body?.channel || 'email').trim().toLowerCase();
    const subscriberRef = String(body?.subscriberRef || '').trim();
    if (!['email', 'telegram', 'webhook'].includes(channel)) {
      return json({ ok: false, error: 'channel must be email, telegram, or webhook.' }, 400);
    }
    if (channel === 'email' && !EMAIL_RE.test(subscriberRef)) {
      return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
    }
    if (channel === 'telegram' && !TELEGRAM_CHAT_RE.test(subscriberRef)) {
      return json({ ok: false, error: 'Please enter a valid Telegram chat ID or @username.' }, 400);
    }
    if (channel === 'webhook' && !WEBHOOK_RE.test(subscriberRef)) {
      return json({ ok: false, error: 'Webhook URL must be a valid https:// endpoint.' }, 400);
    }
    const wallet = body?.walletAddress ? normaliseEvmAddress(body.walletAddress) : null;
    const exists = await db.prepare(`SELECT id FROM launchpad_campaigns WHERE id = ? AND listed_at IS NOT NULL`).bind(campaignId).first();
    if (!exists) return json({ ok: false, error: 'Campaign not found' }, 404);

    const subId = newId('sub');
    const nowIso = new Date().toISOString();
    await db.prepare(
      `INSERT INTO launchpad_subscriptions (id, campaign_id, subscriber_ref, channel, wallet_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, subscriber_ref) DO UPDATE SET
         channel = excluded.channel,
         wallet_address = excluded.wallet_address`,
    ).bind(subId, campaignId, subscriberRef, channel, wallet, nowIso).run();

    return json({ ok: true, campaignId, subscriberRef, channel });
  }

  // Backer unsubscribe
  const unsubscribeMatch = /^\/launchpad\/campaigns\/([^/]+)\/unsubscribe$/.exec(path);
  if (unsubscribeMatch && method === 'POST') {
    const campaignId = unsubscribeMatch[1];
    if (!ID_RE.test(campaignId)) return json({ ok: false, error: 'Invalid campaign id' }, 400);
    const body = await readJson(request);
    const subscriberRef = String(body?.subscriberRef || '').trim();
    if (!subscriberRef) return json({ ok: false, error: 'subscriberRef is required.' }, 400);
    await db.prepare(`DELETE FROM launchpad_subscriptions WHERE campaign_id = ? AND subscriber_ref = ?`).bind(campaignId, subscriberRef).run();
    return json({ ok: true, removed: true });
  }

  // Campaign detail: public if listed; owner always.
  const detailMatch = /^\/launchpad\/campaigns\/([^/]+)$/.exec(path);
  if (detailMatch && method === 'GET') {
    const campaignId = detailMatch[1];
    if (!ID_RE.test(campaignId)) return json({ ok: false, error: 'Invalid campaign id' }, 400);
    const ownerId = who.user ? billingId(who.user) : null;
    const campaign = await db.prepare(
      `SELECT ${PUBLIC_CAMPAIGN_COLUMNS} FROM launchpad_campaigns
       WHERE id = ? AND ((listed_at IS NOT NULL AND compliance_status = 'approved') OR account_id = ?)`,
    ).bind(campaignId, ownerId ?? '').first();
    if (!campaign) return json({ ok: false, error: 'Campaign not found' }, 404);
    const milestones = await db.prepare(
      `SELECT milestone_index, title, description, payout_percentage FROM launchpad_milestones
       WHERE campaign_id = ? ORDER BY milestone_index ASC`,
    ).bind(campaignId).all();
    return json({ ok: true, campaign, milestones: milestones.results || [] });
  }

  // Issue a voucher (merchant only, listed campaigns only).
  if (path === '/launchpad/vouchers' && method === 'POST') {
    const auth = requireUser(who);
    if (auth instanceof Response) return auth;
    const limited = await rateLimit(env, request, 'launchpad_voucher_issue', auth.accountId, 120, 3600);
    if (limited) return limited;
    const body = await readJson(request);
    const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : '';
    if (!ID_RE.test(campaignId)) return json({ ok: false, error: 'campaignId required' }, 400);
    const itemDescription = str(body?.itemDescription, 200);
    if (!itemDescription) return json({ ok: false, error: 'itemDescription is required (max 200 characters).' }, 400);
    const customerRef = body?.customerRef == null || body.customerRef === '' ? null : str(body.customerRef, 120);
    if (body?.customerRef && !customerRef) return json({ ok: false, error: 'customerRef max 120 characters.' }, 400);

    const campaign = await loadOwnedCampaign(env, campaignId, auth.accountId);
    if (!campaign) return json({ ok: false, error: 'Campaign not found' }, 404);
    if (!campaign.listed_at || campaign.compliance_status !== 'approved') {
      return json({ ok: false, error: 'Register the deployed contract before issuing vouchers.' }, 409);
    }

    const now = new Date();
    const months = typeof campaign.voucher_expiry_months === 'number' ? campaign.voucher_expiry_months : null;
    let expiresAt: string | null = null;
    if (months) {
      const e = new Date(now);
      e.setUTCMonth(e.getUTCMonth() + months);
      expiresAt = e.toISOString();
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateVoucherCode();
      try {
        await db.prepare(
          `INSERT INTO launchpad_vouchers (id, campaign_id, voucher_code, customer_ref, item_description, status,
             issued_by_account_id, issued_at, expires_at)
           VALUES (?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
        ).bind(newId('vch'), campaignId, code, customerRef, itemDescription, auth.accountId, now.toISOString(), expiresAt).run();
        return json({ ok: true, voucherCode: code, expiresAt });
      } catch (err) {
        if (!String(err).includes('UNIQUE')) throw err;
      }
    }
    return json({ ok: false, error: 'Could not allocate a voucher code. Try again.' }, 503);
  }

  // Redeem at point of sale (merchant only). Compare-and-swap prevents double redemption.
  if (path === '/launchpad/vouchers/redeem' && method === 'POST') {
    const auth = requireUser(who);
    if (auth instanceof Response) return auth;
    const limited = await rateLimit(env, request, 'launchpad_voucher_redeem', auth.accountId, 300, 3600);
    if (limited) return limited;
    const body = await readJson(request);
    const code = typeof body?.voucherCode === 'string' ? body.voucherCode.trim().toUpperCase() : '';
    if (!VOUCHER_CODE_RE.test(code)) return json({ ok: false, error: 'Voucher code format is VCH-XXXX-XXXX-XXXX.' }, 400);
    const txHash = body?.txHash == null || body.txHash === '' ? null : String(body.txHash).trim();
    if (txHash && !TX_HASH_RE.test(txHash)) return json({ ok: false, error: 'txHash must be a 0x-prefixed 32-byte hash.' }, 400);

    const now = new Date().toISOString();
    const res = await db.prepare(
      `UPDATE launchpad_vouchers SET status = 'redeemed', redeemed_by_account_id = ?, redeemed_at = ?, redeem_tx_hash = ?
       WHERE voucher_code = ? AND status = 'issued' AND (expires_at IS NULL OR expires_at > ?)
         AND campaign_id IN (SELECT id FROM launchpad_campaigns WHERE account_id = ?)`,
    ).bind(auth.accountId, now, txHash, code, now, auth.accountId).run();
    if (res.meta?.changes) return json({ ok: true, redeemedAt: now });

    // Explain why without leaking other merchants' vouchers.
    const row = await db.prepare(
      `SELECT v.status, v.expires_at FROM launchpad_vouchers v JOIN launchpad_campaigns c ON c.id = v.campaign_id
       WHERE v.voucher_code = ? AND c.account_id = ?`,
    ).bind(code, auth.accountId).first<{ status: string; expires_at: string | null }>();
    if (!row) return json({ ok: false, error: 'Voucher not found' }, 404);
    if (row.status === 'redeemed') return json({ ok: false, error: 'Voucher has already been redeemed.' }, 409);
    if (row.expires_at && row.expires_at <= now) return json({ ok: false, error: 'Voucher has expired.' }, 410);
    return json({ ok: false, error: `Voucher is ${row.status}.` }, 409);
  }

  // Look up a voucher (merchant only; no cross-merchant enumeration).
  const voucherMatch = /^\/launchpad\/vouchers\/([^/]+)$/.exec(path);
  if (voucherMatch && method === 'GET') {
    const auth = requireUser(who);
    if (auth instanceof Response) return auth;
    const limited = await rateLimit(env, request, 'launchpad_voucher_lookup', auth.accountId, 300, 3600);
    if (limited) return limited;
    const code = decodeURIComponent(voucherMatch[1]).trim().toUpperCase();
    if (!VOUCHER_CODE_RE.test(code)) return json({ ok: false, error: 'Voucher code format is VCH-XXXX-XXXX-XXXX.' }, 400);
    const voucher = await db.prepare(
      `SELECT v.voucher_code, v.item_description, v.status, v.issued_at, v.expires_at, v.redeemed_at,
              c.business_name, c.title AS campaign_title
       FROM launchpad_vouchers v JOIN launchpad_campaigns c ON c.id = v.campaign_id
       WHERE v.voucher_code = ? AND c.account_id = ?`,
    ).bind(code, auth.accountId).first();
    if (!voucher) return json({ ok: false, error: 'Voucher not found' }, 404);
    return json({ ok: true, voucher });
  }

  return json({ ok: false, error: 'Not found' }, 404);
}
