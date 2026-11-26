/** Export files in R2 are deleted by the daily privacy job once their download link has expired. */
import { describe, expect, it } from 'vitest';
import type { Env } from '../worker/env';
import { purgeExpiredPrivacyExports } from '../worker/privacyService';
import { createSqliteD1 } from './helpers/sqliteD1';

function r2Stub(fail = false) {
  const objects = new Set<string>(['privacy-exports/acct/old.json', 'privacy-exports/acct/new.json']);
  return {
    objects,
    bucket: {
      delete: async (key: string) => {
        if (fail) throw new Error('r2 down');
        objects.delete(key);
      },
    },
  };
}

function seed(db: ReturnType<typeof createSqliteD1>) {
  db.sqlite.exec(`
    INSERT INTO privacy_jobs (id, account_id, kind, status, r2_object_key, expires_at, created_at, updated_at) VALUES
      ('old', 'acct', 'export', 'ready', 'privacy-exports/acct/old.json', 1000, 1, 1),
      ('new', 'acct', 'export', 'ready', 'privacy-exports/acct/new.json', 9000, 1, 1);
  `);
}

describe('privacy export purge', () => {
  it('deletes expired export files and marks the job purged, leaving live exports alone', async () => {
    const db = createSqliteD1();
    seed(db);
    const r2 = r2Stub();
    const kvDeleted: string[] = [];
    const env = {
      DB: db,
      DESKTOP_RELEASES: r2.bucket,
      LUMINARA_KV: { delete: async (key: string) => void kvDeleted.push(key) },
    } as unknown as Env;
    expect(await purgeExpiredPrivacyExports(env, 5000)).toBe(1);
    expect([...r2.objects]).toEqual(['privacy-exports/acct/new.json']);
    expect(kvDeleted).toEqual(['privacy:export:old']);
    expect(db.sqlite.prepare(`SELECT id, status, r2_object_key FROM privacy_jobs ORDER BY id`).all()).toEqual([
      { id: 'new', status: 'ready', r2_object_key: 'privacy-exports/acct/new.json' },
      { id: 'old', status: 'purged', r2_object_key: null },
    ]);
  });

  it('keeps the job ready when the file delete fails, so the next run retries', async () => {
    const db = createSqliteD1();
    seed(db);
    const env = { DB: db, DESKTOP_RELEASES: r2Stub(true).bucket } as unknown as Env;
    expect(await purgeExpiredPrivacyExports(env, 5000)).toBe(0);
    expect(db.sqlite.prepare(`SELECT status FROM privacy_jobs WHERE id = 'old'`).get()).toEqual({ status: 'ready' });
  });
});
