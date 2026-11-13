/**
 * Project history and outcomes.
 *   GET  /projects/:id/history
 *   GET  /projects/:id/history/compare?earlierId=&laterId=
 *   GET  /projects/:id/outcomes
 *   POST /projects/:id/outcomes                 { actionKey, title, kind }
 *   POST /projects/:id/outcomes/:actionId/done
 */
import type { Env } from './env';
import { json } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import { isSnapshotKind } from '../services/history/snapshotCompare';
import {
  compareProjectSnapshots,
  getProjectHistory,
  listProjectOutcomes,
  markActionDone,
  recordRecommendedAction,
} from './projectHistoryService';
import { checkStrictWriteThreat } from './threatWriteGate';

const ACTION_KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function decodeId(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return ID_RE.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

type HistoryMatch = {
  projectId: string;
  section: 'history' | 'compare' | 'outcomes' | 'done';
  actionId: string | null;
};

function matchPath(path: string): HistoryMatch | null {
  const matched = path.match(/^\/projects\/([^/]+)\/(history(?:\/compare)?|outcomes(?:\/([^/]+)\/done)?)$/);
  if (!matched) return null;
  const projectId = decodeId(matched[1] || '');
  const section = matched[2] || '';
  if (!projectId) return null;
  if (section === 'history') return { projectId, section: 'history', actionId: null };
  if (section === 'history/compare') return { projectId, section: 'compare', actionId: null };
  if (section === 'outcomes') return { projectId, section: 'outcomes', actionId: null };
  const actionId = matched[3] ? decodeId(matched[3]) : null;
  if (!actionId) return null;
  return { projectId, section: 'done', actionId };
}

export async function handleProjectHistoryRoute(
  request: Request,
  env: Env,
  path: string,
  accountId: string,
): Promise<Response | null> {
  const matched = matchPath(path);
  if (!matched) return null;
  if (!env.DB) return json({ ok: false, error: 'Database unavailable' }, 503);

  if (matched.section === 'history' && request.method === 'GET') {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get('limit') || 50);
    const history = await getProjectHistory(env, accountId, matched.projectId, requested);
    if (!history) return json({ ok: false, error: 'Project not found' }, 404);
    return json({ ok: true, history });
  }

  if (matched.section === 'compare' && request.method === 'GET') {
    const url = new URL(request.url);
    const earlierId = url.searchParams.get('earlierId') || '';
    const laterId = url.searchParams.get('laterId') || '';
    if (!ID_RE.test(earlierId) || !ID_RE.test(laterId)) {
      return json({ ok: false, error: 'earlierId and laterId required' }, 400);
    }
    const delta = await compareProjectSnapshots(env, accountId, matched.projectId, earlierId, laterId);
    if (!delta) return json({ ok: false, error: 'Snapshot not found' }, 404);
    return json({ ok: true, delta });
  }

  if (matched.section === 'outcomes' && request.method === 'GET') {
    const outcomes = await listProjectOutcomes(env, accountId, matched.projectId);
    if (!outcomes) return json({ ok: false, error: 'Project not found' }, 404);
    return json({ ok: true, outcomes });
  }

  if (matched.section === 'outcomes' && request.method === 'POST') {
    const read = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!read.ok) return json({ ok: false, error: read.error }, read.status);
    const body = read.value && typeof read.value === 'object' ? (read.value as Record<string, unknown>) : {};
    const actionKey = typeof body.actionKey === 'string' ? body.actionKey.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const kind = typeof body.kind === 'string' ? body.kind : '';
    if (!ACTION_KEY_RE.test(actionKey) || !title) {
      return json({ ok: false, error: 'actionKey and title required' }, 400);
    }
    if (!isSnapshotKind(kind)) {
      return json({ ok: false, error: 'kind must be audit, keyword, ai_visibility, or instant_audit' }, 400);
    }
    const threat = await checkStrictWriteThreat(env, {
      accountId,
      path: '/api/projects/outcomes',
      surface: 'project_outcome_create',
      content: `${actionKey}\n${title}`,
    });
    if (threat.blocked) {
      return json(
        { ok: false, error: threat.reason || 'Blocked by threat scanner.', code: 'THREAT_BLOCKED' },
        400,
      );
    }
    const outcome = await recordRecommendedAction(env, {
      accountId,
      projectId: matched.projectId,
      actionKey,
      title,
      kind,
    });
    if (!outcome) return json({ ok: false, error: 'Project not found' }, 404);
    return json({ ok: true, outcome });
  }

  if (matched.section === 'done' && request.method === 'POST') {
    const outcome = await markActionDone(env, accountId, matched.projectId, matched.actionId || '');
    if (!outcome) return json({ ok: false, error: 'Action not found' }, 404);
    return json({ ok: true, outcome });
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}
