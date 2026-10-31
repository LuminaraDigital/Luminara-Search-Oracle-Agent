import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Env } from '../worker/env';
import { collectExportPayload, eraseAccountRows } from '../worker/privacyService';
import { ERASE_RETAINED, ERASED_TABLES, EXPORT_EXEMPT, EXPORTED_TABLES } from '../worker/privacyTables';
import { createSqliteD1 } from './helpers/sqliteD1';

const ACCOUNT_KEYS = ['account_id', 'owner_account_id', 'owner_id', 'user_id'];
const source = readFileSync(resolve(__dirname, '..', 'worker', 'privacyService.ts'), 'utf8');

function accountKeyedTables(): string[] {
  const { sqlite } = createSqliteD1();
  const tables = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  return tables
    .map((row) => row.name)
    .filter((name) =>
      (sqlite.prepare(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>).some((col) => ACCOUNT_KEYS.includes(col.name)),
    );
}

function kvStub() {
  const deleted: string[] = [];
  return { deleted, kv: { delete: async (key: string) => void deleted.push(key) } };
}

describe('privacy coverage', () => {
  it('erases every account-keyed table or records why it stays', () => {
    const missing = accountKeyedTables().filter(
      (table) =>
        !ERASED_TABLES.includes(table) &&
        !ERASE_RETAINED[table] &&
        !new RegExp(`(DELETE FROM|UPDATE) ${table}\\b`).test(source),
    );
    expect(missing).toEqual([]);
  });

  it('exports every account-keyed table or records why it does not', () => {
    const missing = accountKeyedTables().filter(
      (table) =>
        !EXPORTED_TABLES.includes(table) &&
        !EXPORT_EXEMPT[table] &&
        !new RegExp(`\\bFROM ${table}( c)? WHERE`).test(source.split('async function softDeleteAccount')[0]),
    );
    expect(missing).toEqual([]);
  });

  it('runs the export against the real schema without leaking secrets', async () => {
    const db = createSqliteD1();
    db.sqlite.exec(`INSERT INTO gsc_oauth_tokens (account_id, refresh_token_enc, scopes, updated_at) VALUES ('acct', 'secret-token', 'read', 1)`);
    const payload = await collectExportPayload({ DB: db } as unknown as Env, 'acct');
    expect(payload.searchConsoleConnection).toEqual([{ scopes: 'read', updated_at: 1 }]);
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  });

  it('removes saved text, credentials and the KV workspace, and leaves other accounts alone', async () => {
    const db = createSqliteD1();
    for (const account of ['acct', 'other']) {
      db.sqlite.exec(`
        INSERT INTO rsi_memory_documents (id, account_id, kind, domain, title, body, created_at)
          VALUES ('doc-${account}', '${account}', 'audit', 'a.com', 't', 'audit text', 1);
        INSERT INTO gsc_oauth_tokens (account_id, refresh_token_enc, scopes, updated_at) VALUES ('${account}', 'x', 'read', 1);
        INSERT INTO api_keys (id, account_id, key_hash, name, created_at) VALUES ('key-${account}', '${account}', 'hash-${account}', 'n', 1);
      `);
    }
    const { deleted, kv } = kvStub();
    await eraseAccountRows({ DB: db, LUMINARA_KV: kv } as unknown as Env, 'acct');
    for (const table of ['rsi_memory_documents', 'gsc_oauth_tokens', 'api_keys']) {
      const rows = db.sqlite.prepare(`SELECT account_id FROM ${table}`).all() as Array<{ account_id: string }>;
      expect(rows.map((row) => row.account_id)).toEqual(['other']);
    }
    expect(deleted).toContain('workspace:acct');
  });

  it('erases a run whose child belongs to another account', async () => {
    const db = createSqliteD1();
    db.sqlite.exec(`PRAGMA foreign_keys = ON;
      INSERT INTO run_provenance (run_id, surface, account_id, started_at, status) VALUES ('parent', 'oracle_chat', 'acct', 1, 'done');
      INSERT INTO run_provenance (run_id, parent_run_id, surface, account_id, started_at, status) VALUES ('child', 'parent', 'oracle_chat', 'other', 1, 'done');
    `);
    await eraseAccountRows({ DB: db } as unknown as Env, 'acct');
    expect(db.sqlite.prepare(`SELECT run_id, parent_run_id FROM run_provenance`).all()).toEqual([{ run_id: 'child', parent_run_id: null }]);
  });
});
