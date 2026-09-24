/**
 * Agent-written HTML reports (APS A3).
 */
import type { Env } from './env';
import {
  REPORT_HTML_BYTE_CAP,
  REPORT_SUMMARY_CAP,
  REPORT_TITLE_CAP,
  type AgentReport,
  type AgentReportSummary,
} from '../services/projects/types';
import { randomId } from '../services/projects/projectUtils';
import { getProject } from './projectService';

function webappOrigin(env: Env): string {
  return (env.WEBAPP_URL || 'https://luminarasuite.com').replace(/\/$/, '');
}

function reportUrl(env: Env, reportId: string): string {
  return `${webappOrigin(env)}/reports/${reportId}`;
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function validateHtml(html: string): string | null {
  const trimmed = html.trim();
  if (!trimmed.includes('<html') && !trimmed.includes('<HTML')) {
    return 'HTML must include an <html> element';
  }
  if (!/<\/html>\s*$/i.test(trimmed)) {
    return 'HTML must end with </html> (document looks incomplete)';
  }
  if (trimmed.includes('`') || trimmed.includes('${')) {
    return 'HTML must not contain backticks or ${ (some MCP clients break on them). Use <code> instead.';
  }
  if (/<script[\s>]/i.test(trimmed)) {
    return 'Scripts are not allowed in agent reports';
  }
  const size = utf8Bytes(trimmed);
  if (size > REPORT_HTML_BYTE_CAP) {
    return `HTML is ${size} bytes; the limit is ${REPORT_HTML_BYTE_CAP}`;
  }
  return null;
}

export async function listAgentReports(
  env: Env,
  accountId: string,
  projectId: string,
): Promise<AgentReportSummary[] | null> {
  if (!env.DB) return null;
  const project = await getProject(env, accountId, projectId);
  if (!project) return null;
  const res = await env.DB.prepare(
    `SELECT id, project_id, title, summary, skill, created_by_label, size_bytes, created_at, updated_at
     FROM agent_reports WHERE project_id = ? AND account_id = ?
     ORDER BY updated_at DESC LIMIT 100`,
  )
    .bind(projectId, accountId)
    .all<{
      id: string;
      project_id: string;
      title: string;
      summary: string;
      skill: string | null;
      created_by_label: string | null;
      size_bytes: number;
      created_at: number;
      updated_at: number;
    }>();
  return (res.results || []).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    summary: r.summary,
    skill: r.skill,
    createdByLabel: r.created_by_label,
    sizeBytes: r.size_bytes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    url: reportUrl(env, r.id),
  }));
}

export async function getAgentReport(
  env: Env,
  accountId: string,
  reportId: string,
  includeHtml: boolean,
): Promise<AgentReport | AgentReportSummary | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT id, project_id, account_id, title, summary, html, skill, created_by_label, size_bytes, share_id, created_at, updated_at
     FROM agent_reports WHERE id = ? AND account_id = ?`,
  )
    .bind(reportId, accountId)
    .first<{
      id: string;
      project_id: string;
      account_id: string;
      title: string;
      summary: string;
      html: string;
      skill: string | null;
      created_by_label: string | null;
      size_bytes: number;
      share_id: string | null;
      created_at: number;
      updated_at: number;
    }>();
  if (!row) return null;
  const summary: AgentReportSummary = {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    summary: row.summary,
    skill: row.skill,
    createdByLabel: row.created_by_label,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    url: reportUrl(env, row.id),
  };
  if (!includeHtml) return summary;
  return { ...summary, html: row.html, shareId: row.share_id };
}

export async function saveAgentReport(
  env: Env,
  accountId: string,
  input: {
    projectId: string;
    title: string;
    summary: string;
    html: string;
    skill?: string;
    reportId?: string;
    createdByLabel?: string;
    createdByUserId?: string;
  },
): Promise<{ ok: true; report: AgentReportSummary } | { ok: false; error: string; status: number }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable', status: 503 };
  const project = await getProject(env, accountId, input.projectId);
  if (!project) return { ok: false, error: 'Project not found', status: 404 };

  const title = String(input.title || '').trim().slice(0, REPORT_TITLE_CAP);
  if (!title) return { ok: false, error: 'title required', status: 400 };
  const summary = String(input.summary || '').trim().slice(0, REPORT_SUMMARY_CAP);
  if (!summary) return { ok: false, error: 'summary required (verdict + top action + key numbers)', status: 400 };
  const html = String(input.html || '').trim();
  const htmlErr = validateHtml(html);
  if (htmlErr) return { ok: false, error: htmlErr, status: 400 };

  const now = Date.now();
  const sizeBytes = utf8Bytes(html);
  const skill = input.skill ? String(input.skill).slice(0, 64) : null;
  const label = input.createdByLabel ? String(input.createdByLabel).slice(0, 64) : null;
  const userId = input.createdByUserId || null;

  if (input.reportId) {
    const existing = await env.DB.prepare(
      `SELECT id FROM agent_reports WHERE id = ? AND account_id = ? AND project_id = ?`,
    )
      .bind(input.reportId, accountId, input.projectId)
      .first();
    if (!existing) return { ok: false, error: 'reportId not found for this project', status: 404 };
    await env.DB.prepare(
      `UPDATE agent_reports SET title = ?, summary = ?, html = ?, skill = COALESCE(?, skill),
       size_bytes = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(title, summary, html, skill, sizeBytes, now, input.reportId)
      .run();
    const list = await listAgentReports(env, accountId, input.projectId);
    const found = list?.find((r) => r.id === input.reportId);
    if (!found) return { ok: false, error: 'Report updated but not readable', status: 500 };
    return { ok: true, report: found };
  }

  const id = randomId('rpt');
  try {
    await env.DB.prepare(
      `INSERT INTO agent_reports
       (id, project_id, account_id, title, summary, html, skill, created_by_label, created_by_user_id, size_bytes, share_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
      .bind(id, input.projectId, accountId, title, summary, html, skill, label, userId, sizeBytes, now, now)
      .run();
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/UNIQUE/i.test(msg)) {
      return {
        ok: false,
        error: `A report titled "${title}" already exists. Pass reportId to replace it, or change the title.`,
        status: 409,
      };
    }
    return { ok: false, error: 'Could not save report', status: 500 };
  }

  return {
    ok: true,
    report: {
      id,
      projectId: input.projectId,
      title,
      summary,
      skill,
      createdByLabel: label,
      sizeBytes,
      createdAt: now,
      updatedAt: now,
      url: reportUrl(env, id),
    },
  };
}

/** Public HTML fetch for sandboxed viewer (owner session required via route). */
export async function getAgentReportHtmlForAccount(
  env: Env,
  accountId: string,
  reportId: string,
): Promise<{ html: string; title: string } | null> {
  const full = await getAgentReport(env, accountId, reportId, true);
  if (!full || !('html' in full)) return null;
  return { html: full.html, title: full.title };
}
