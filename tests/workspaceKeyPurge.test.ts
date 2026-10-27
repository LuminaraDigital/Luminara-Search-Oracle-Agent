/**
 * Migration 0042 removes plain-text BYOK key maps from stored workspaces and nothing else.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';

const PURGE = '0042_purge_plaintext_workspace_keys';
const purgeSql = readFileSync(resolve(__dirname, '..', 'migrations', `${PURGE}.sql`), 'utf8');

function dbWithRows(rows: Array<[string, string, number]>) {
  const db = createSqliteD1({ skipMigrations: [PURGE] }) as unknown as { sqlite: any };
  const insert = db.sqlite.prepare(`INSERT INTO user_workspace (account_id, payload, updated_at) VALUES (?, ?, ?)`);
  for (const row of rows) insert.run(...row);
  return db.sqlite;
}

function row(sqlite: any, accountId: string) {
  return sqlite.prepare(`SELECT payload, updated_at FROM user_workspace WHERE account_id = ?`).get(accountId) as {
    payload: string;
    updated_at: number;
  };
}

describe('purge plain-text workspace keys', () => {
  const encryptedKeys = { v: 1, ciphertext: 'c', iv: 'i', salt: 's' };

  it('drops only the keys map and keeps encryptedKeys, storage and the version', () => {
    const sqlite = dbWithRows([
      ['acct_both', JSON.stringify({ storage: { luminara_business_dna: '{"n":1}' }, keys: { luminara_groq_key: 'gsk_x' }, encryptedKeys }), 111],
      ['acct_keys_only', JSON.stringify({ keys: { luminara_groq_key: 'gsk_y' } }), 222],
    ]);

    sqlite.exec(purgeSql);

    const both = row(sqlite, 'acct_both');
    expect(JSON.parse(both.payload)).toEqual({ storage: { luminara_business_dna: '{"n":1}' }, encryptedKeys });
    expect(both.updated_at).toBe(111);
    expect(JSON.parse(row(sqlite, 'acct_keys_only').payload)).toEqual({});
  });

  it('leaves rows without keys, and rows that are not valid JSON, untouched', () => {
    const clean = JSON.stringify({ storage: { a: '1' }, encryptedKeys });
    const sqlite = dbWithRows([
      ['acct_clean', clean, 333],
      ['acct_broken', '{not json', 444],
    ]);

    sqlite.exec(purgeSql);
    sqlite.exec(purgeSql);

    expect(row(sqlite, 'acct_clean')).toEqual({ payload: clean, updated_at: 333 });
    expect(row(sqlite, 'acct_broken')).toEqual({ payload: '{not json', updated_at: 444 });
  });
});
