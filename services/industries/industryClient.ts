import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import { DEFAULT_INDUSTRY_ID, parseIndustryId } from './industryProfiles';

const PENDING_KEY = 'luminara_pending_industry';

export function rememberIndustryChoice(industryId: string): void {
  const id = parseIndustryId(industryId);
  if (!id) return;
  try {
    sessionStorage.setItem(PENDING_KEY, id);
  } catch {
    /* private mode */
  }
}

export async function saveAccountIndustry(industryId: string): Promise<boolean> {
  const id = parseIndustryId(industryId);
  const base = apiBase();
  if (!id || !base) return false;
  const response = await workerFetchWithAuthRetry(`${base}/api/account/industry`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ industryId: id }),
  });
  if (!response.ok) return false;
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  return true;
}

export async function flushPendingIndustry(): Promise<void> {
  let pending: string | null = null;
  try {
    pending = sessionStorage.getItem(PENDING_KEY);
  } catch {
    return;
  }
  if (pending) await saveAccountIndustry(pending);
}

export async function saveProjectIndustry(projectId: string, industryId: string): Promise<boolean> {
  const id = parseIndustryId(industryId) || DEFAULT_INDUSTRY_ID;
  const base = apiBase();
  if (!base) return false;
  const response = await workerFetchWithAuthRetry(`${base}/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ industryId: id }),
  });
  return response.ok;
}
