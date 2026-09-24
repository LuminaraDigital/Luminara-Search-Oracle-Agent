/**
 * Shared project memory (APS A2).
 */
import type { Env } from './env';
import type { BusinessDNA } from '../types';
import {
  COMPETITOR_CAP,
  CUSTOM_SECTION_CAP,
  KEY_PAGE_CAP,
  RESEARCH_LOG_DAYS,
  SECTION_CHAR_CAP,
  TYPED_CONTEXT_KEYS,
  type ContextAuthor,
  type KeyPageRole,
  type ProjectCompetitor,
  type ProjectContextBundle,
  type ProjectContextPatch,
  type ProjectContextSection,
  type ProjectKeyPage,
  type ProjectResearchLogEntry,
  type TypedContextKey,
} from '../services/projects/types';
import { isoDateUTC, normalizeProjectDomain, randomId } from '../services/projects/projectUtils';
import { getProject } from './projectService';

const KEY_PAGE_ROLES: KeyPageRole[] = ['hub', 'spoke', 'money', 'other'];

function clampContent(content: string): string {
  return String(content || '').slice(0, SECTION_CHAR_CAP);
}

function isTypedKey(key: string): key is TypedContextKey {
  return (TYPED_CONTEXT_KEYS as readonly string[]).includes(key);
}

function renderDigest(bundle: Omit<ProjectContextBundle, 'digestMarkdown'>): string {
  const lines: string[] = [`# Project context (${bundle.projectId})`, ''];
  if (bundle.missingSections.length) {
    lines.push(`Missing: ${bundle.missingSections.join(', ')}`, '');
  }
  for (const s of bundle.sections) {
    if (!s.content.trim()) continue;
    lines.push(`## ${s.title || s.key}`, s.content.trim(), '');
  }
  if (bundle.competitors.length) {
    lines.push('## Competitors');
    for (const c of bundle.competitors) {
      lines.push(`- ${c.domain}${c.name ? ` (${c.name})` : ''}${c.notes ? `: ${c.notes}` : ''}`);
    }
    lines.push('');
  }
  if (bundle.keyPages.length) {
    lines.push('## Key pages');
    for (const p of bundle.keyPages) {
      lines.push(`- [${p.role}] ${p.url}${p.topic ? ` - ${p.topic}` : ''}`);
    }
    lines.push('');
  }
  if (bundle.researchLog.length) {
    lines.push('## Recent research');
    for (const e of bundle.researchLog.slice(0, 10)) {
      lines.push(`- ${e.entryDate}: ${e.summary}`);
    }
  }
  return lines.join('\n').replace(/\u2014/g, '-');
}

export async function getProjectContext(
  env: Env,
  accountId: string,
  projectId: string,
): Promise<ProjectContextBundle | null> {
  if (!env.DB) return null;
  const project = await getProject(env, accountId, projectId);
  if (!project) return null;

  const [sectionsRes, compsRes, pagesRes, logRes] = await Promise.all([
    env.DB.prepare(
      `SELECT key, title, content, updated_at, updated_by FROM project_context_sections WHERE project_id = ?`,
    )
      .bind(projectId)
      .all<{ key: string; title: string | null; content: string; updated_at: number; updated_by: string }>(),
    env.DB.prepare(
      `SELECT id, domain, name, notes, updated_at, updated_by FROM project_competitors WHERE project_id = ? ORDER BY domain`,
    )
      .bind(projectId)
      .all<{
        id: string;
        domain: string;
        name: string | null;
        notes: string | null;
        updated_at: number;
        updated_by: string;
      }>(),
    env.DB.prepare(
      `SELECT id, url, role, topic, notes, updated_at, updated_by FROM project_key_pages WHERE project_id = ? ORDER BY url`,
    )
      .bind(projectId)
      .all<{
        id: string;
        url: string;
        role: string;
        topic: string | null;
        notes: string | null;
        updated_at: number;
        updated_by: string;
      }>(),
    env.DB.prepare(
      `SELECT id, entry_date, summary, created_by, created_at FROM project_research_log
       WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
      .bind(projectId)
      .all<{
        id: string;
        entry_date: string;
        summary: string;
        created_by: string;
        created_at: number;
      }>(),
  ]);

  const sections: ProjectContextSection[] = (sectionsRes.results || []).map((r) => ({
    key: r.key,
    title: r.title,
    content: r.content,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by as ContextAuthor,
  }));
  const byKey = new Map(sections.map((s) => [s.key, s]));
  const missingSections = TYPED_CONTEXT_KEYS.filter((k) => !byKey.get(k)?.content?.trim());

  const competitors: ProjectCompetitor[] = (compsRes.results || []).map((r) => ({
    id: r.id,
    domain: r.domain,
    name: r.name,
    notes: r.notes,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by as ContextAuthor,
  }));
  const keyPages: ProjectKeyPage[] = (pagesRes.results || []).map((r) => ({
    id: r.id,
    url: r.url,
    role: (KEY_PAGE_ROLES.includes(r.role as KeyPageRole) ? r.role : 'other') as KeyPageRole,
    topic: r.topic,
    notes: r.notes,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by as ContextAuthor,
  }));
  const researchLog: ProjectResearchLogEntry[] = (logRes.results || []).map((r) => ({
    id: r.id,
    entryDate: r.entry_date,
    summary: r.summary,
    createdBy: r.created_by as ContextAuthor,
    createdAt: r.created_at,
  }));

  const partial = {
    projectId,
    sections,
    missingSections,
    competitors,
    keyPages,
    researchLog,
  };
  return { ...partial, digestMarkdown: renderDigest(partial) };
}

export async function seedContextFromDna(
  env: Env,
  accountId: string,
  projectId: string,
  dna: BusinessDNA,
): Promise<void> {
  const patches: ProjectContextPatch[] = [];
  const overview = [
    dna.name && `Business: ${dna.name}`,
    dna.mission && `Mission: ${dna.mission}`,
    dna.targetAudience && `Audience: ${dna.targetAudience}`,
    dna.industry && `Industry: ${dna.industry}`,
  ]
    .filter(Boolean)
    .join('\n');
  if (overview) patches.push({ section: 'business_overview', content: overview });
  const positioning = [dna.usp && `USP: ${dna.usp}`, ...(dna.perceivedGaps || []).map((g) => `Gap: ${g}`)]
    .filter(Boolean)
    .join('\n');
  if (positioning) patches.push({ section: 'positioning', content: positioning });
  if (dna.competitors?.length) {
    patches.push({
      addCompetitors: dna.competitors.map((d) => ({ domain: normalizeProjectDomain(d) || d })),
    });
  }
  if (patches.length) {
    await updateProjectContext(env, accountId, projectId, patches, 'onboarding');
  }
}

export async function updateProjectContext(
  env: Env,
  accountId: string,
  projectId: string,
  updates: ProjectContextPatch[],
  author: ContextAuthor,
): Promise<{ ok: true; context: ProjectContextBundle } | { ok: false; error: string; status: number }> {
  if (!env.DB) return { ok: false, error: 'Database unavailable', status: 503 };
  const project = await getProject(env, accountId, projectId);
  if (!project) return { ok: false, error: 'Project not found', status: 404 };
  if (!Array.isArray(updates) || updates.length === 0) {
    return { ok: false, error: 'updates array required', status: 400 };
  }

  const now = Date.now();

  for (const op of updates) {
    if ('section' in op && op.section) {
      if (!isTypedKey(op.section)) {
        return { ok: false, error: `Unknown typed section: ${op.section}`, status: 400 };
      }
      await env.DB.prepare(
        `INSERT INTO project_context_sections (project_id, key, title, content, updated_at, updated_by)
         VALUES (?, ?, NULL, ?, ?, ?)
         ON CONFLICT(project_id, key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      )
        .bind(projectId, op.section, clampContent(op.content), now, author)
        .run();
      continue;
    }

    if ('customSection' in op && op.customSection) {
      const slug = String(op.customSection)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64);
      if (!slug) return { ok: false, error: 'customSection slug required', status: 400 };
      const key = `custom:${slug}`;
      const countRow = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM project_context_sections WHERE project_id = ? AND key LIKE 'custom:%'`,
      )
        .bind(projectId)
        .first<{ c: number }>();
      const existing = await env.DB.prepare(
        `SELECT key FROM project_context_sections WHERE project_id = ? AND key = ?`,
      )
        .bind(projectId, key)
        .first();
      if (!existing && Number(countRow?.c || 0) >= CUSTOM_SECTION_CAP) {
        return { ok: false, error: `Custom section limit is ${CUSTOM_SECTION_CAP}`, status: 400 };
      }
      await env.DB.prepare(
        `INSERT INTO project_context_sections (project_id, key, title, content, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, key) DO UPDATE SET
           title = COALESCE(excluded.title, project_context_sections.title),
           content = excluded.content,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      )
        .bind(projectId, key, op.title || slug, clampContent(op.content), now, author)
        .run();
      continue;
    }

    if ('deleteCustomSection' in op && op.deleteCustomSection) {
      const key = op.deleteCustomSection.startsWith('custom:')
        ? op.deleteCustomSection
        : `custom:${op.deleteCustomSection}`;
      await env.DB.prepare(`DELETE FROM project_context_sections WHERE project_id = ? AND key = ?`)
        .bind(projectId, key)
        .run();
      continue;
    }

    if ('addCompetitors' in op && op.addCompetitors) {
      const countRow = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM project_competitors WHERE project_id = ?`,
      )
        .bind(projectId)
        .first<{ c: number }>();
      let count = Number(countRow?.c || 0);
      for (const c of op.addCompetitors) {
        const domain = normalizeProjectDomain(c.domain);
        if (!domain) continue;
        const existing = await env.DB.prepare(
          `SELECT id FROM project_competitors WHERE project_id = ? AND domain = ?`,
        )
          .bind(projectId, domain)
          .first<{ id: string }>();
        if (existing) {
          await env.DB.prepare(
            `UPDATE project_competitors SET name = COALESCE(?, name), notes = COALESCE(?, notes), updated_at = ?, updated_by = ?
             WHERE id = ?`,
          )
            .bind(c.name || null, c.notes || null, now, author, existing.id)
            .run();
        } else {
          if (count >= COMPETITOR_CAP) {
            return { ok: false, error: `Competitor limit is ${COMPETITOR_CAP}`, status: 400 };
          }
          await env.DB.prepare(
            `INSERT INTO project_competitors (id, project_id, domain, name, notes, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(randomId('cmp'), projectId, domain, c.name || null, c.notes || null, now, author)
            .run();
          count += 1;
        }
      }
      continue;
    }

    if ('removeCompetitors' in op && op.removeCompetitors) {
      for (const d of op.removeCompetitors) {
        const domain = normalizeProjectDomain(d) || d;
        await env.DB.prepare(`DELETE FROM project_competitors WHERE project_id = ? AND domain = ?`)
          .bind(projectId, domain)
          .run();
      }
      continue;
    }

    if ('addKeyPages' in op && op.addKeyPages) {
      const countRow = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM project_key_pages WHERE project_id = ?`,
      )
        .bind(projectId)
        .first<{ c: number }>();
      let count = Number(countRow?.c || 0);
      for (const p of op.addKeyPages) {
        const url = String(p.url || '').trim();
        if (!url) continue;
        const role: KeyPageRole = KEY_PAGE_ROLES.includes(p.role) ? p.role : 'other';
        const existing = await env.DB.prepare(
          `SELECT id FROM project_key_pages WHERE project_id = ? AND url = ?`,
        )
          .bind(projectId, url)
          .first<{ id: string }>();
        if (existing) {
          await env.DB.prepare(
            `UPDATE project_key_pages SET role = ?, topic = COALESCE(?, topic), notes = COALESCE(?, notes),
             updated_at = ?, updated_by = ? WHERE id = ?`,
          )
            .bind(role, p.topic || null, p.notes || null, now, author, existing.id)
            .run();
        } else {
          if (count >= KEY_PAGE_CAP) {
            return { ok: false, error: `Key page limit is ${KEY_PAGE_CAP}`, status: 400 };
          }
          await env.DB.prepare(
            `INSERT INTO project_key_pages (id, project_id, url, role, topic, notes, updated_at, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(randomId('page'), projectId, url, role, p.topic || null, p.notes || null, now, author)
            .run();
          count += 1;
        }
      }
      continue;
    }

    if ('removeKeyPages' in op && op.removeKeyPages) {
      for (const url of op.removeKeyPages) {
        await env.DB.prepare(`DELETE FROM project_key_pages WHERE project_id = ? AND url = ?`)
          .bind(projectId, String(url).trim())
          .run();
      }
      continue;
    }

    if ('appendResearchLog' in op && op.appendResearchLog) {
      const summary = String(op.appendResearchLog.summary || '').trim().slice(0, 2000);
      if (!summary) return { ok: false, error: 'research log summary required', status: 400 };
      await env.DB.prepare(
        `INSERT INTO project_research_log (id, project_id, entry_date, summary, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(randomId('rlog'), projectId, isoDateUTC(now), summary, author, now)
        .run();
      const pruneBefore = now - RESEARCH_LOG_DAYS * 24 * 60 * 60 * 1000;
      await env.DB.prepare(`DELETE FROM project_research_log WHERE project_id = ? AND created_at < ?`)
        .bind(projectId, pruneBefore)
        .run();
      continue;
    }

    if ('removeResearchLog' in op && op.removeResearchLog) {
      for (const id of op.removeResearchLog) {
        await env.DB.prepare(`DELETE FROM project_research_log WHERE project_id = ? AND id = ?`)
          .bind(projectId, id)
          .run();
      }
      continue;
    }

    return { ok: false, error: 'Unrecognized patch operation', status: 400 };
  }

  await env.DB.prepare(`UPDATE projects SET updated_at = ? WHERE id = ? AND account_id = ?`)
    .bind(now, projectId, accountId)
    .run();

  const context = await getProjectContext(env, accountId, projectId);
  if (!context) return { ok: false, error: 'Context missing after update', status: 500 };
  return { ok: true, context };
}
