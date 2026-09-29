/**
 * Signed-in Idea Scout calls. Payloads never include SEO percentages.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import type { IdeaScoutCard } from './rules';

export interface IdeaScoutCreateResult {
  ok: true;
  id: string;
  card: IdeaScoutCard;
  status: string;
  hosted: boolean;
  ideaCardsRemaining: number | null;
  pulseEnabled: boolean;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return data && typeof data === 'object' ? data : {};
}

export async function createIdeaScout(input: {
  idea: string;
  niche?: string;
  competitorUrls?: string[];
  pulseOptIn?: boolean;
}): Promise<{ ok: true; result: IdeaScoutCreateResult } | { ok: false; error: string; status: number }> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable. Open the app from Telegram or sign in on the web.', status: 0 };
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/idea-scout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idea: input.idea,
        niche: input.niche || undefined,
        competitorUrls: input.competitorUrls || [],
        pulseOptIn: input.pulseOptIn === true,
      }),
    });
    const data = await readJson(res);
    if (!res.ok || data.ok !== true || typeof data.id !== 'string' || !data.card) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`, status: res.status };
    }
    return {
      ok: true,
      result: {
        ok: true,
        id: data.id,
        card: data.card as IdeaScoutCard,
        status: String(data.status || 'ready'),
        hosted: data.hosted !== false,
        ideaCardsRemaining: typeof data.ideaCardsRemaining === 'number' ? data.ideaCardsRemaining : null,
        pulseEnabled: data.pulseEnabled === true,
      },
    };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error', status: 0 };
  }
}

export async function fetchIdeaScout(id: string): Promise<{ ok: true; id: string; card: IdeaScoutCard; niche: string | null } | { ok: false; error: string }> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable' };
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/idea-scout/${encodeURIComponent(id)}`);
    const data = await readJson(res);
    if (!res.ok || data.ok !== true || !data.card) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}` };
    }
    return { ok: true, id, card: data.card as IdeaScoutCard, niche: typeof data.niche === 'string' ? data.niche : null };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function linkIdeaScout(input: {
  id: string;
  domain: string;
  auditRunId?: string;
  measurementStatus?: 'measured' | 'not_measured';
  evidencePresent?: boolean;
}): Promise<{ ok: true; linkedAuditRunId: string | null } | { ok: false; error: string }> {
  const base = apiBase();
  if (!base) return { ok: false, error: 'API unavailable' };
  const body: Record<string, unknown> = { domain: input.domain };
  if (input.auditRunId) body.auditRunId = input.auditRunId;
  if (input.measurementStatus) body.measurementStatus = input.measurementStatus;
  if (input.evidencePresent != null) body.evidencePresent = input.evidencePresent;
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/idea-scout/${encodeURIComponent(input.id)}/link`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await readJson(res);
    if (!res.ok || data.ok !== true) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}` };
    }
    return { ok: true, linkedAuditRunId: typeof data.linkedAuditRunId === 'string' ? data.linkedAuditRunId : null };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}
