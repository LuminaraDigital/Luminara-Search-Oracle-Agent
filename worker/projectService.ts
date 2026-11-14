/**
 * D1-backed SEO projects (APS A1).
 */
import type { Env } from './env';
import type { SeoProject } from '../services/projects/types';
import { normalizeProjectDomain, randomId } from '../services/projects/projectUtils';
import { DEFAULT_INDUSTRY_ID, parseIndustryId, type IndustryId } from '../services/industries/industryProfiles';

type ProjectRow = {
  id: string;
  account_id: string;
  client_id: string;
  domain: string;
  name: string;
  industry_id: string | null;
  default_location_code: string | null;
  default_language_code: string | null;
  created_at: number;
  updated_at: number;
};

const PROJECT_SELECT = `id, account_id, client_id, domain, name, default_location_code, default_language_code, created_at, updated_at,
  (SELECT industry_id FROM project_industries WHERE project_id = projects.id) AS industry_id`;

function rowToProject(row: ProjectRow): SeoProject {
  return {
    id: row.id,
    accountId: row.account_id,
    clientId: row.client_id || '',
    domain: row.domain,
    name: row.name,
    industryId: parseIndustryId(row.industry_id) || DEFAULT_INDUSTRY_ID,
    defaultLocationCode: row.default_location_code,
    defaultLanguageCode: row.default_language_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProjects(env: Env, accountId: string, clientId?: string): Promise<SeoProject[]> {
  if (!env.DB) return [];
  const scoped = typeof clientId === 'string';
  const res = await env.DB.prepare(
    `SELECT ${PROJECT_SELECT}
     FROM projects WHERE account_id = ?${scoped ? ' AND client_id = ?' : ''} ORDER BY updated_at DESC LIMIT 200`,
  )
    .bind(...(scoped ? [accountId, clientId] : [accountId]))
    .all<ProjectRow>();
  return (res.results || []).map(rowToProject);
}

export async function findProjectByDomain(
  env: Env,
  accountId: string,
  domain: string,
  clientId?: string | null,
): Promise<SeoProject | null> {
  if (!env.DB) return null;
  const host = normalizeProjectDomain(domain);
  if (!host) return null;
  const scoped = typeof clientId === 'string';
  const row = await env.DB.prepare(
    `SELECT ${PROJECT_SELECT}
     FROM projects WHERE account_id = ? AND domain = ?${scoped ? ' AND client_id = ?' : ''}
     ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(...(scoped ? [accountId, host, clientId] : [accountId, host]))
    .first<ProjectRow>();
  return row ? rowToProject(row) : null;
}

export async function getProject(
  env: Env,
  accountId: string,
  projectId: string,
): Promise<SeoProject | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT ${PROJECT_SELECT} FROM projects WHERE id = ? AND account_id = ?`,
  )
    .bind(projectId, accountId)
    .first<ProjectRow>();
  return row ? rowToProject(row) : null;
}

export async function getProjectById(env: Env, projectId: string): Promise<SeoProject | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT ${PROJECT_SELECT} FROM projects WHERE id = ?`)
    .bind(projectId)
    .first<ProjectRow>();
  return row ? rowToProject(row) : null;
}

export async function createProject(
  env: Env,
  accountId: string,
  input: {
    domain: string;
    name?: string;
    clientId?: string;
    industryId?: IndustryId;
    defaultLocationCode?: string;
    defaultLanguageCode?: string;
  },
): Promise<{ ok: true; project: SeoProject } | { ok: false; error: string; status: number }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable', status: 503 };
  const domain = normalizeProjectDomain(input.domain);
  if (!domain) return { ok: false, error: 'domain required', status: 400 };
  const clientId = String(input.clientId || '').trim();
  const name = (input.name || domain).trim().slice(0, 120) || domain;
  const now = Date.now();
  const id = randomId('proj');

  const existing = await env.DB.prepare(
    `SELECT ${PROJECT_SELECT} FROM projects WHERE account_id = ? AND domain = ? AND client_id = ?`,
  )
    .bind(accountId, domain, clientId)
    .first<ProjectRow>();
  if (existing) {
    return { ok: true, project: rowToProject(existing) };
  }

  try {
    await env.DB.prepare(
      `INSERT INTO projects
       (id, account_id, client_id, domain, name, default_location_code, default_language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        accountId,
        clientId,
        domain,
        name,
        input.defaultLocationCode || null,
        input.defaultLanguageCode || null,
        now,
        now,
      )
      .run();
    await setProjectIndustry(env, id, input.industryId || (await accountIndustryId(env, accountId)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'insert failed';
    if (/UNIQUE/i.test(msg)) {
      const again = await env.DB.prepare(
        `SELECT ${PROJECT_SELECT} FROM projects WHERE account_id = ? AND domain = ? AND client_id = ?`,
      )
        .bind(accountId, domain, clientId)
        .first<ProjectRow>();
      if (again) return { ok: true, project: rowToProject(again) };
    }
    return { ok: false, error: 'Could not create project', status: 500 };
  }

  const project = await getProject(env, accountId, id);
  if (!project) return { ok: false, error: 'Project created but not readable', status: 500 };
  return { ok: true, project };
}

export async function accountIndustryId(env: Env, accountId: string): Promise<IndustryId> {
  if (!env.DB) return DEFAULT_INDUSTRY_ID;
  const row = await env.DB.prepare(`SELECT industry_id FROM account_industries WHERE account_id = ?`)
    .bind(accountId)
    .first<{ industry_id: string }>();
  return parseIndustryId(row?.industry_id) || DEFAULT_INDUSTRY_ID;
}

export async function setAccountIndustry(env: Env, accountId: string, industryId: IndustryId): Promise<void> {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO account_industries (account_id, industry_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET industry_id = excluded.industry_id, updated_at = excluded.updated_at`,
  )
    .bind(accountId, industryId, now)
    .run();
}

export async function setProjectIndustry(env: Env, projectId: string, industryId: IndustryId): Promise<void> {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO project_industries (project_id, industry_id, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET industry_id = excluded.industry_id, updated_at = excluded.updated_at`,
  )
    .bind(projectId, industryId, now)
    .run();
}
