/**
 * Browser client for APS projects / context / reports / API keys.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import type { BusinessDNA } from '../../types';
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
