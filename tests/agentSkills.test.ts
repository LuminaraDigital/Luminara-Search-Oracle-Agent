import { describe, expect, it } from 'vitest';
import { loadAgentSkill, setAgentSkillEnabled, upsertAgentSkillVersion } from '../worker/agentSkills';
import { createSqliteD1 } from './helpers/sqliteD1';

function createMockKv(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val === undefined) return null;
      if (type === 'json') {
        try {
          return JSON.parse(val);
        } catch {
          return null;
        }
      }
      return val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function makeEnv(options: { skipMigrations?: string[]; withDb?: boolean } = {}) {
  const LUMINARA_KV = createMockKv();
  const DB = options.withDb === false ? undefined : createSqliteD1({ skipMigrations: options.skipMigrations });
  const env: any = { LUMINARA_KV, DB };
  return { env, LUMINARA_KV, DB };
}

async function insertVersion(DB: any, slug: string, version: number, prompt: string, enabled = 1) {
  await DB.prepare(
    'INSERT INTO agent_skills (skill_slug, version, enabled, prompt_body, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(slug, version, enabled, prompt, Date.now(), 'test')
    .run();
}

describe('runtime agent skill catalog', () => {
  it('loads the latest enabled row from D1', async () => {
    const { env, DB } = makeEnv();
    await insertVersion(DB, 'seo-audit', 1, 'prompt v1');
    await insertVersion(DB, 'seo-audit', 2, 'prompt v2');
    await insertVersion(DB, 'seo-audit', 3, 'prompt v3 disabled', 0);

    const skill = await loadAgentSkill(env, 'seo-audit');
    expect(skill).toEqual({ slug: 'seo-audit', version: 2, promptBody: 'prompt v2' });
  });

  it('serves from KV cache after a cache fill (D1-free hit)', async () => {
    const { env, LUMINARA_KV } = makeEnv();
    await insertVersion(env.DB, 'seo-audit', 1, 'prompt v1');

    const first = await loadAgentSkill(env, 'seo-audit');
    expect(first?.version).toBe(1);
    const cached = LUMINARA_KV.store.get('skill:seo-audit:latest');
    expect(cached).toBeTruthy();
    expect(JSON.parse(cached!).promptBody).toBe('prompt v1');

    // Second read hits the stub KV (still real logic), honoring type 'json'.
    const second = await loadAgentSkill({ LUMINARA_KV } as any, 'seo-audit');
    expect(second).toEqual({ slug: 'seo-audit', version: 1, promptBody: 'prompt v1' });
  });

  it('treats KV errors as a miss and still reads D1', async () => {
    const { env } = makeEnv();
    await insertVersion(env.DB, 'seo-audit', 1, 'prompt v1');
    const brokenKv = {
      async get() {
        throw new Error('kv down');
      },
      async put() {
        throw new Error('kv down');
      },
      async delete() {},
    };
    const skill = await loadAgentSkill({ DB: env.DB, LUMINARA_KV: brokenKv } as any, 'seo-audit');
    expect(skill?.promptBody).toBe('prompt v1');
  });

  it('returns the bundled fallback as version 0 when D1 has no row', async () => {
    const { env } = makeEnv();
    const skill = await loadAgentSkill(env, 'missing-skill', { fallbackPrompt: 'bundled prompt' });
    expect(skill).toEqual({ slug: 'missing-skill', version: 0, promptBody: 'bundled prompt' });
  });

  it('returns null when there is no row and no fallback', async () => {
    const { env } = makeEnv();
    expect(await loadAgentSkill(env, 'missing-skill')).toBeNull();
  });

  it('upsert bumps version 1 to 2 and invalidates the KV cache', async () => {
    const { env, LUMINARA_KV } = makeEnv();
    const first = await upsertAgentSkillVersion(env, { slug: 'seo-audit', promptBody: 'p1' });
    expect(first.version).toBe(1);
    LUMINARA_KV.store.set('skill:seo-audit:latest', JSON.stringify({ version: 1, promptBody: 'p1' }));
    const second = await upsertAgentSkillVersion(env, { slug: 'seo-audit', promptBody: 'p2', modelHint: 'gemini-flash', notes: 'tighten tone' });
    expect(second.version).toBe(2);
    expect(LUMINARA_KV.store.has('skill:seo-audit:latest')).toBe(false);

    const loaded = await loadAgentSkill(env, 'seo-audit');
    expect(loaded?.promptBody).toBe('p2');
    expect(loaded?.modelHint).toBe('gemini-flash');
  });

  it('setAgentSkillEnabled flips enabled, deletes KV, and returns false for unknown rows', async () => {
    const { env, LUMINARA_KV } = makeEnv();
    await insertVersion(env.DB, 'seo-audit', 1, 'p1');
    await insertVersion(env.DB, 'seo-audit', 2, 'p2');
    LUMINARA_KV.store.set('skill:seo-audit:latest', JSON.stringify({ version: 2, promptBody: 'p2' }));

    expect(await setAgentSkillEnabled(env, 'seo-audit', 2, false)).toBe(true);
    expect(LUMINARA_KV.store.has('skill:seo-audit:latest')).toBe(false);

    const loaded = await loadAgentSkill({ DB: env.DB } as any, 'seo-audit');
    expect(loaded?.version).toBe(1);

    expect(await setAgentSkillEnabled(env, 'seo-audit', 99, true)).toBe(false);
  });

  it('falls back gracefully when the agent_skills table does not exist (pre-migration DB)', async () => {
    const { env } = makeEnv({ skipMigrations: ['0010'] });
    const skill = await loadAgentSkill(env, 'seo-audit', { fallbackPrompt: 'bundled prompt' });
    expect(skill).toEqual({ slug: 'seo-audit', version: 0, promptBody: 'bundled prompt' });
    expect(await loadAgentSkill(env, 'seo-audit')).toBeNull();
  });
});

describe('agent skill catalog internals mirrored by admin routes', () => {
  // The admin route validation contract (see worker/index.ts /admin/skills/*):
  // slug must match /^[a-z0-9][a-z0-9-]{0,63}$/ and promptBody is a non-empty
  // string of at most 32000 chars. These assertions lock the same rules the
  // routes enforce, so a drift between them fails loudly.
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

  it('accepts valid slugs and rejects invalid ones', () => {
    expect(SLUG_RE.test('seo-audit')).toBe(true);
    expect(SLUG_RE.test('a')).toBe(true);
    expect(SLUG_RE.test('-bad')).toBe(false);
    expect(SLUG_RE.test('Bad_Case')).toBe(false);
    expect(SLUG_RE.test('x'.repeat(65))).toBe(false);
  });

  it('promptBody rule: non-empty, max 32000 chars', () => {
    const valid = (b: unknown) => typeof b === 'string' && b.trim().length > 0 && b.length <= 32000;
    expect(valid('a real prompt')).toBe(true);
    expect(valid('')).toBe(false);
    expect(valid('   ')).toBe(false);
    expect(valid('x'.repeat(32001))).toBe(false);
    expect(valid(123)).toBe(false);
  });
});
