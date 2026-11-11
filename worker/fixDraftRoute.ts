/**
 * Ask-metered page drafts. The same builder serves the web route and the MCP tool.
 * Draft only: nothing is published.
 */
import { buildFixDraft, isFixDraftKind, type FixDraftInput, type FixDraftKind } from '../services/audit/fixDraft';
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import type { McpCreditClass } from '../services/projects/types';
import { identifiedForRequest } from './authMiddleware';
import { identify, json } from './workerUtils';
import { checkHostedQuota, QUOTA_CAPACITY_ERROR, refundMeteredQuota } from './quotaMiddleware';

const FIELD_KEYS = ['businessName', 'agentName', 'suburb', 'phone', 'address', 'serviceArea', 'findingTitle', 'domain'] as const;

export type ParsedFixDraft =
  | { ok: true; input: FixDraftInput }
  | { ok: false; error: string };

function field(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (!text) return undefined;
  if (text.length > 200) return undefined;
  return text;
}

export function parseFixDraftBody(raw: unknown): ParsedFixDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Send a JSON object with a kind.' };
  }
  const body = raw as Record<string, unknown>;
  if (!isFixDraftKind(body.kind)) {
    return { ok: false, error: 'kind must be suburb_page, agent_bio, about_page, faq_block, or json_ld.' };
  }
  const input: FixDraftInput = { kind: body.kind };
  for (const key of FIELD_KEYS) {
    if (body[key] == null || body[key] === '') continue;
    if (typeof body[key] !== 'string') return { ok: false, error: `${key} must be a string.` };
    const value = field(body[key]);
    if (!value) return { ok: false, error: `${key} is too long.` };
    input[key] = value;
  }
  return { ok: true, input };
}

export async function createFixDraft(
  env: Env,
  user: HostedIdentity,
  input: FixDraftInput,
): Promise<Response> {
  const quota = await checkHostedQuota(env, user, { bucket: 'ask' });
  if (!quota.ok) {
    const capacity = quota.error === QUOTA_CAPACITY_ERROR;
    return json(
      {
        ok: false,
        error: quota.error,
        code: capacity ? 'HOSTED_CAPACITY' : 'ASK_DAILY_CAP',
        limit: quota.limit,
        remaining: quota.remaining,
      },
      capacity ? 503 : 402,
    );
  }
  try {
    const draft = buildFixDraft(input);
    return json({
      ok: true,
      draft,
      askLimit: quota.limit,
      askRemaining: quota.remaining,
    });
  } catch {
    await refundMeteredQuota(env, quota);
    return json({ ok: false, error: 'The draft could not be built.' }, 500);
  }
}

export async function handleFixDraftRoute(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/fix-drafts') return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const who = identifiedForRequest(request) ?? await identify(request, env);
  if (!who.user) return json({ ok: false, error: who.error || 'Sign in required.' }, 401);
  const text = await request.text();
  if (text.length > 8_000) return json({ ok: false, error: 'Request is too large.' }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'Body must be JSON.' }, 400);
  }
  const parsed = parseFixDraftBody(raw);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  return createFixDraft(env, who.user, parsed.input);
}

type McpResult = { text: string; structuredContent?: Record<string, unknown>; isError?: boolean };

export const FIX_DRAFT_MCP_TOOLS: Array<{
  name: string;
  description: string;
  creditClass: McpCreditClass;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: { env: Env; user: HostedIdentity }) => Promise<McpResult>;
}> = [
  {
    name: 'draft_fix',
    description:
      'Draft a suburb page, agent bio, about page, FAQ block, or RealEstateAgent JSON-LD from fields you pass. Draft only: nothing is published. Uses one Ask from the same daily allowance as chat, and also counts as one MCP call. Do not invent rankings, review counts, or years in business. Omit any fact you do not have.',
    creditClass: 'free',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['suburb_page', 'agent_bio', 'about_page', 'faq_block', 'json_ld'] },
        domain: { type: 'string', description: 'Hostname of the agency site. A habitat token is limited to its own domain.' },
        businessName: { type: 'string' },
        agentName: { type: 'string' },
        suburb: { type: 'string' },
        phone: { type: 'string' },
        address: { type: 'string' },
        serviceArea: { type: 'string' },
        findingTitle: { type: 'string' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const parsed = parseFixDraftBody(args);
      if (!parsed.ok) return { text: parsed.error, isError: true };
      const response = await createFixDraft(ctx.env, ctx.user, parsed.input);
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        draft?: { markdown?: string; jsonLd?: string | null; blank?: string[]; filled?: string[]; note?: string; kind?: FixDraftKind };
        askRemaining?: number;
      };
      if (!body.ok || !body.draft?.markdown) {
        return { text: body.error || 'The draft was not created.', structuredContent: { code: body.code || 'DRAFT_FAILED' }, isError: true };
      }
      return {
        text: body.draft.markdown,
        structuredContent: {
          kind: body.draft.kind,
          jsonLd: body.draft.jsonLd,
          filled: body.draft.filled,
          blank: body.draft.blank,
          note: body.draft.note,
          askRemaining: body.askRemaining ?? null,
        },
      };
    },
  },
];
