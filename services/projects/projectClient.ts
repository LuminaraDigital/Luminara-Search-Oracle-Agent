/**
 * Browser client for APS projects / context / reports / API keys.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import type { BusinessDNA } from '../../types';
import type { OutcomeFollowUpView } from '../history/outcomeFollowUp';
import type { SnapshotSignals } from '../history/snapshotCompare';
import type {
  AgentReportSummary,
  ProjectContextBundle,
  ProjectContextPatch,
  SeoProject,
} from './types';

export async function listSeoProjects(): Promise<SeoProject[]> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/projects`);
  if (!r.ok) throw new Error(`list projects failed (${r.status})`);
  const data = (await r.json()) as { projects?: SeoProject[] };
  return data.projects || [];
}

export async function createSeoProject(input: {
  domain: string;
  name?: string;
  clientId?: string;
  dna?: BusinessDNA | null;
}): Promise<SeoProject> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await r.json()) as { ok?: boolean; project?: SeoProject; error?: string };
  if (!r.ok || !data.project) throw new Error(data.error || `create project failed (${r.status})`);
  return data.project;
}

export async function fetchProjectContext(projectId: string): Promise<ProjectContextBundle> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/projects/${encodeURIComponent(projectId)}/context`);
  const data = (await r.json()) as { ok?: boolean; context?: ProjectContextBundle; error?: string };
  if (!r.ok || !data.context) throw new Error(data.error || `context failed (${r.status})`);
  return data.context;
}

export async function patchProjectContext(
  projectId: string,
  updates: ProjectContextPatch[],
): Promise<ProjectContextBundle> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/projects/${encodeURIComponent(projectId)}/context`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ updates }),
  });
  const data = (await r.json()) as { ok?: boolean; context?: ProjectContextBundle; error?: string };
  if (!r.ok || !data.context) throw new Error(data.error || `patch context failed (${r.status})`);
  return data.context;
}

/**
 * Persist Instant Audit strategy into project context (APS A8).
 * Find-or-create by domain (Worker also upserts). Safe no-op when unsigned or offline.
 */
export async function saveAuditStrategyToProject(opts: {
  domain: string;
  dna?: BusinessDNA | null;
  plainEnglishBrief?: string;
  focus?: string;
}): Promise<{ projectId: string; urlHint: string } | null> {
  try {
    const domainNeedle = opts.domain
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase()
      .trim();
    let project: SeoProject | null = null;
    try {
      const existing = await listSeoProjects();
      project =
        existing.find((p) => {
          const d = (p.domain || '').toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
          return d === domainNeedle || d.endsWith(`.${domainNeedle}`) || domainNeedle.endsWith(`.${d}`);
        }) || null;
    } catch {
      project = null;
    }
    if (!project) {
      project = await createSeoProject({
        domain: opts.domain,
        name: opts.dna?.name || opts.domain,
        dna: opts.dna || undefined,
      });
    }
    const updates: ProjectContextPatch[] = [];
    if (opts.plainEnglishBrief?.trim()) {
      updates.push({
        section: 'current_goal',
        content: [
          opts.focus ? `Focus: ${opts.focus}` : '',
          opts.plainEnglishBrief.trim().slice(0, 3900),
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
    }
    updates.push({
      appendResearchLog: {
        summary: `Instant Audit strategy saved for ${opts.domain}. Verdict: context seeded for MCP agents.`,
      },
    });
    await patchProjectContext(project.id, updates);
    return { projectId: project.id, urlHint: `project ${project.id}` };
  } catch {
    return null;
  }
}

export async function listProjectReports(projectId: string): Promise<AgentReportSummary[]> {
  const r = await workerFetchWithAuthRetry(
    `${apiBase()}/api/reports?projectId=${encodeURIComponent(projectId)}`,
  );
  const data = (await r.json()) as { reports?: AgentReportSummary[]; error?: string };
  if (!r.ok) throw new Error(data.error || `list reports failed (${r.status})`);
  return data.reports || [];
}

export type ProjectHistorySnapshot = {
  id: string;
  kind: string;
  measuredAt: number;
  signals: SnapshotSignals;
};

export type ProjectHistoryPayload = {
  projectId: string;
  retentionNote: string;
  snapshots: ProjectHistorySnapshot[];
  trends: Array<{
    kind: string;
    metric: string;
    subject: string;
    latestScore: number | null;
    latestDelta: {
      scoreDelta: number | null;
      label: string;
      droppedEngines: string[];
      gainedEngines: string[];
    } | null;
  }>;
};

export type ProjectOutcomePayload = {
  id: string;
  title: string;
  kind: string;
  status: string;
  beforeValue: number | null;
  afterValue: number | null;
  lift: number | null;
  dataLabel: string;
  followUps?: OutcomeFollowUpView[];
};

export async function fetchProjectHistory(projectId: string): Promise<ProjectHistoryPayload> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/projects/${encodeURIComponent(projectId)}/history`);
  const data = (await r.json()) as { history?: ProjectHistoryPayload; error?: string };
  if (!r.ok || !data.history) throw new Error(data.error || `history failed (${r.status})`);
  return data.history;
}

export async function fetchProjectOutcomes(projectId: string): Promise<ProjectOutcomePayload[]> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/projects/${encodeURIComponent(projectId)}/outcomes`);
  const data = (await r.json()) as { outcomes?: ProjectOutcomePayload[]; error?: string };
  if (!r.ok || !data.outcomes) throw new Error(data.error || `outcomes failed (${r.status})`);
  return data.outcomes;
}

export type ProjectMonitorPayload = {
  enabled: boolean;
  cadence: 'monthly' | 'weekly' | 'daily';
  planCadence: 'monthly' | 'weekly' | 'daily';
  emailOptIn: boolean;
  prompts: string[];
  lastRunAt: number | null;
  nextRunAt: number;
};

export type ProjectAlertPayload = {
  id: string;
  kind: 'regression' | 'lift' | 'weekly';
  summary: string;
  readAt: number | null;
};

export async function fetchProjectMonitor(projectId: string): Promise<{ monitor: ProjectMonitorPayload | null; planCadence: ProjectMonitorPayload['planCadence'] }> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/projects/${encodeURIComponent(projectId)}/monitor`);
  const data = (await r.json()) as { monitor?: ProjectMonitorPayload | null; planCadence?: ProjectMonitorPayload['planCadence']; error?: string };
  if (!r.ok || !data.planCadence) throw new Error(data.error || `monitor failed (${r.status})`);
  return { monitor: data.monitor ?? null, planCadence: data.planCadence };
}

export async function saveProjectMonitor(
  projectId: string,
  input: { enabled: boolean; cadence: ProjectMonitorPayload['cadence']; emailOptIn: boolean },
): Promise<ProjectMonitorPayload> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/projects/${encodeURIComponent(projectId)}/monitor`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await r.json()) as { monitor?: ProjectMonitorPayload; error?: string };
  if (!r.ok || !data.monitor) throw new Error(data.error || `monitor save failed (${r.status})`);
  return data.monitor;
}

export async function fetchProjectAlerts(projectId: string): Promise<ProjectAlertPayload[]> {
  const r = await workerFetchWithAuthRetry(`${apiBase()}/api/projects/${encodeURIComponent(projectId)}/monitor/alerts`);
  const data = (await r.json()) as { alerts?: ProjectAlertPayload[]; error?: string };
  if (!r.ok || !data.alerts) throw new Error(data.error || `alerts failed (${r.status})`);
  return data.alerts;
}

export async function ackProjectAlert(projectId: string, alertId: string): Promise<ProjectAlertPayload> {
  const r = await workerFetchWithAuthRetry(
    `${apiBase()}/api/projects/${encodeURIComponent(projectId)}/monitor/alerts/${encodeURIComponent(alertId)}/read`,
    { method: 'POST' },
  );
  const data = (await r.json()) as { alert?: ProjectAlertPayload; error?: string };
  if (!r.ok || !data.alert) throw new Error(data.error || `alert read failed (${r.status})`);
  return data.alert;
}

export async function markProjectActionDone(projectId: string, actionId: string): Promise<ProjectOutcomePayload> {
  const r = await workerFetchWithAuthRetry(
    `${apiBase()}/api/projects/${encodeURIComponent(projectId)}/outcomes/${encodeURIComponent(actionId)}/done`,
    { method: 'POST' },
  );
  const data = (await r.json()) as { outcome?: ProjectOutcomePayload; error?: string };
  if (!r.ok || !data.outcome) throw new Error(data.error || `mark done failed (${r.status})`);
  return data.outcome;
}
