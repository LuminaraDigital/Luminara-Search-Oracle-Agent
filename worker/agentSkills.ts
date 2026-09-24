/**
 * Runtime agent skill catalog: methodology prompts as versioned data.
 *
 * Storage: D1 table agent_skills (migrations/0010) holding one row per
 * (skill_slug, version). The agent reads the latest enabled version at
 * runtime; a KV copy at `skill:{slug}:latest` (TTL 300s) serves as a hot
 * cache so steady-state reads do not hit D1.
 *
 * Honesty invariant: bundled prompts are the fallback when D1 is empty or
 * unavailable. A fallback is ALWAYS marked version 0 so callers can tell the
 * runtime prompt apart from a seeded one, and fallbacks are NEVER written
 * back into D1 from this module.
 *
 * Additive only: failures degrade to the fallback path; missing table errors
 * (pre-migration databases) are treated as "no row".
 */

export type AgentSkill = {
  slug: string;
  version: number;
  promptBody: string;
  modelHint?: string;
};

type SkillStoreEnv = {
  DB?: D1Database;
  LUMINARA_KV?: KVNamespace;
};

type SkillRow = {
  prompt_body: string;
  version: number;
  model_hint: string | null;
};

const kvKey = (slug: string) => `skill:${slug}:latest`;
const KV_TTL_SECONDS = 300;
const MISSING_TABLE_RE = /no such table: agent_skills/i;

function rowToSkill(slug: string, row: SkillRow): AgentSkill {
  const skill: AgentSkill = { slug, version: Number(row.version), promptBody: row.prompt_body };
  if (row.model_hint) skill.modelHint = row.model_hint;
  return skill;
}

export async function loadAgentSkill(
  env: SkillStoreEnv,
  slug: string,
  opts?: { fallbackPrompt?: string },
): Promise<AgentSkill | null> {
  // 1. KV hot cache. Errors count as a miss; the cache must never take a
  //    request down.
  if (env.LUMINARA_KV) {
    try {
      const cached = (await env.LUMINARA_KV.get(kvKey(slug), 'json')) as
        | { version?: number; promptBody?: string; modelHint?: string }
        | null;
      if (cached && typeof cached.promptBody === 'string' && typeof cached.version === 'number') {
        const hit: AgentSkill = { slug, version: cached.version, promptBody: cached.promptBody };
        if (cached.modelHint) hit.modelHint = cached.modelHint;
        return hit;
      }
    } catch {
      // KV outage: fall through to D1.
    }
  }

  // 2. D1: latest enabled version.
  if (env.DB) {
    try {
      const row = await env.DB.prepare(
        'SELECT prompt_body, version, model_hint FROM agent_skills WHERE skill_slug = ? AND enabled = 1 ORDER BY version DESC LIMIT 1',
      )
        .bind(slug)
        .first<SkillRow>();
      if (row) {
        const skill = rowToSkill(slug, row);
        // Best-effort cache fill; do not fail the read on KV errors.
        if (env.LUMINARA_KV) {
          try {
            await env.LUMINARA_KV.put(
              kvKey(slug),
              JSON.stringify({ version: skill.version, promptBody: skill.promptBody, modelHint: skill.modelHint }),
              { expirationTtl: KV_TTL_SECONDS },
            );
          } catch {
            // ignore
          }
        }
        return skill;
      }
    } catch (err) {
      if (!MISSING_TABLE_RE.test(String(err && (err as Error).message))) throw err;
      // Pre-migration database: treat as empty and fall through to fallback.
    }
  }

  // 3. Bundled fallback, marked version 0. NEVER seeded into D1 from here.
  if (opts?.fallbackPrompt) {
    return { slug, version: 0, promptBody: opts.fallbackPrompt };
  }
  return null;
}

export async function upsertAgentSkillVersion(
  env: SkillStoreEnv,
  params: { slug: string; promptBody: string; modelHint?: string; createdBy?: string; notes?: string },
): Promise<{ version: number }> {
  if (!env.DB) {
    throw new Error('agent_skills requires a D1 database (env.DB). Check your wrangler.toml d1_databases binding.');
  }
  const maxRow = await env.DB.prepare('SELECT MAX(version) AS v FROM agent_skills WHERE skill_slug = ?')
    .bind(params.slug)
    .first<{ v: number | null }>();
  const version = (maxRow?.v ?? 0) + 1;
  await env.DB.prepare(
    'INSERT INTO agent_skills (skill_slug, version, enabled, prompt_body, model_hint, created_at, created_by, notes) VALUES (?, ?, 1, ?, ?, ?, ?, ?)',
  )
    .bind(
      params.slug,
      version,
      params.promptBody,
      params.modelHint ?? null,
      Date.now(),
      params.createdBy ?? null,
      params.notes ?? null,
    )
    .run();

  // Invalidate the cached latest so the next read sees this version.
  if (env.LUMINARA_KV) {
    try {
      await env.LUMINARA_KV.delete(kvKey(params.slug));
    } catch {
      // best effort: a stale cache entry expires on its own within 300s
    }
  }
  return { version };
}

export async function setAgentSkillEnabled(
  env: SkillStoreEnv,
  slug: string,
  version: number,
  enabled: boolean,
): Promise<boolean> {
  if (!env.DB) {
    throw new Error('agent_skills requires a D1 database (env.DB). Check your wrangler.toml d1_databases binding.');
  }
  const result = await env.DB.prepare('UPDATE agent_skills SET enabled = ? WHERE skill_slug = ? AND version = ?')
    .bind(enabled ? 1 : 0, slug, version)
    .run();
  const changed = Number(result.meta?.changes ?? 0) > 0;
  if (changed && env.LUMINARA_KV) {
    try {
      await env.LUMINARA_KV.delete(kvKey(slug));
    } catch {
      // best effort: cache expires on its own
    }
  }
  return changed;
}
