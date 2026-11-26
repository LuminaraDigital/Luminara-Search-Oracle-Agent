import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Env } from '../worker/env';
import { collectExportPayload, eraseAccountRows } from '../worker/privacyService';
import {
  ERASE_PSEUDONYMIZED,
  ERASE_RETAINED,
  ERASED_ACCOUNT_PLACEHOLDER,
  ERASED_TABLES,
  EXPORT_EXEMPT,
  EXPORTED_TABLES,
} from '../worker/privacyTables';
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
        !ERASE_PSEUDONYMIZED[table] &&
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

  it('hands an organization to the next member and removes one left empty', async () => {
    const db = createSqliteD1();
    db.sqlite.exec(`
      INSERT INTO users (id, source, account_id, created_at, last_seen_at) VALUES ('login', 'firebase', 'acct', 1, 1);
      INSERT INTO organizations (id, name, slug, tier, created_at, updated_at) VALUES
        ('shared', 'Shared', 'shared', 'standard', 1, 1), ('solo', 'Pat''s Organization', 'solo', 'standard', 1, 1);
      INSERT INTO organization_memberships (org_id, user_id, role, status, joined_at) VALUES
        ('shared', 'login', 'owner', 'active', 1), ('shared', 'late', 'analyst', 'active', 3),
        ('shared', 'early', 'analyst', 'active', 2), ('solo', 'login', 'owner', 'active', 1);
      INSERT INTO org_audit_logs (id, org_id, actor_id, action, ip_address, hash, created_at) VALUES ('log', 'solo', 'login', 'x', '1.2.3.4', 'h', 1);
    `);
    await eraseAccountRows({ DB: db } as unknown as Env, 'acct');
    expect(db.sqlite.prepare(`SELECT id FROM organizations`).all()).toEqual([{ id: 'shared' }]);
    expect(db.sqlite.prepare(`SELECT id FROM org_audit_logs`).all()).toEqual([]);
    expect(db.sqlite.prepare(`SELECT user_id, role FROM organization_memberships ORDER BY joined_at`).all()).toEqual([
      { user_id: 'early', role: 'owner' },
      { user_id: 'late', role: 'analyst' },
    ]);
  });

  it('removes an off-chain Launchpad campaign and closes out one on a public chain', async () => {
    const db = createSqliteD1();
    const columns = `id, account_id, domain, business_name, abn_nzbn, country, campaign_type, title, description, compliance_status,
      compliance_details, chain, network, token_name, token_symbol, contract_address, target_fiat_cents, fiat_currency, terms_accepted_at, listed_at, created_at, updated_at`;
    const row = (id: string, contract: string, listed: string) =>
      `('${id}', 'acct', 'a.com', 'Biz', '123', 'AU', 'voucher', 't', 'd', 'passed', '{}', 'ton', 'mainnet', 'T', 'T', ${contract}, 1, 'AUD', 1, ${listed}, 1, 1)`;
    db.sqlite.exec(`INSERT INTO launchpad_campaigns (${columns}) VALUES ${row('draft', 'NULL', 'NULL')}, ${row('onchain', "'0xabc'", "'2026-01-01'")};
      INSERT INTO launchpad_vouchers (id, campaign_id, voucher_code, customer_ref, item_description, status, issued_by_account_id, issued_at, expires_at)
        VALUES ('open', 'onchain', 'CODE1', 'wallet', 'item', 'issued', 'acct', 1, 2), ('used', 'onchain', 'CODE2', 'wallet', 'item', 'redeemed', 'acct', 1, 2);
      INSERT INTO launchpad_subscriptions (id, campaign_id, subscriber_ref, channel, created_at) VALUES ('sub', 'onchain', 'ref', 'telegram', 1);`);
    await eraseAccountRows({ DB: db } as unknown as Env, 'acct');
    expect(db.sqlite.prepare(`SELECT id, abn_nzbn, compliance_details, listed_at FROM launchpad_campaigns`).all()).toEqual([
      { id: 'onchain', abn_nzbn: null, compliance_details: null, listed_at: null },
    ]);
    expect(db.sqlite.prepare(`SELECT id, status, customer_ref FROM launchpad_vouchers ORDER BY id`).all()).toEqual([
      { id: 'open', status: 'cancelled', customer_ref: null },
      { id: 'used', status: 'redeemed', customer_ref: null },
    ]);
    expect(db.sqlite.prepare(`SELECT id FROM launchpad_subscriptions`).all()).toEqual([]);
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
  it('wipes every listed table for the erased account and leaves another account untouched', async () => {
    const db = createSqliteD1();
    const fill = (table: string, account: string, n: number) => {
      const cols = db.sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: unknown;
        pk: number;
      }>;
      const { sql: createSql } = db.sqlite.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(table) as { sql: string };
      // First value each CHECK (col IN (...)) allows, so enum columns get a legal value.
      const allowed = new Map<string, string>();
      for (const m of createSql.matchAll(/(\w+)\s+IN\s*\(\s*'([^']*)'/gi)) if (!allowed.has(m[1])) allowed.set(m[1], m[2]);
      // A foreign key points at the row this filler made in the parent table for the same account.
      const fks = new Map<string, string>();
      for (const fk of db.sqlite.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{ table: string; from: string; to: string }>) {
        fks.set(fk.from, `${fk.table}-${fk.to}-${account}`);
      }
      const names: string[] = [];
      const values: unknown[] = [];
      for (const col of cols) {
        if (col.name === 'account_id') {
          names.push(col.name);
          values.push(account);
        } else if ((col.notnull || col.pk) && col.dflt_value === null) {
          names.push(col.name);
          values.push(
            fks.get(col.name) ?? allowed.get(col.name) ?? (/INT|REAL|NUM/i.test(col.type) ? n : `${table}-${col.name}-${account}`),
          );
        }
      }
      db.sqlite.prepare(`INSERT INTO "${table}" (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...values);
    };
    const filled: string[] = [];
    const skipped: Record<string, string> = {};
    // Parents first, so a foreign key finds its row.
    const fillOrder = [...ERASED_TABLES].sort((a, b) => Number(a === 'budget_incidents') - Number(b === 'budget_incidents'));
    for (const table of fillOrder) {
      try {
        fill(table, 'acct', 1);
        fill(table, 'other', 2);
        filled.push(table);
      } catch (err) {
        skipped[table] = err instanceof Error ? err.message : String(err);
      }
    }
    expect(skipped).toEqual({});
    await eraseAccountRows({ DB: db } as unknown as Env, 'acct');
    for (const table of filled) {
      const rows = db.sqlite.prepare(`SELECT account_id FROM "${table}"`).all() as Array<{ account_id: string }>;
      expect(rows.map((row) => row.account_id), table).toEqual(['other']);
    }
  });

  it('keeps spend ledger totals but unlinks them from the erased account', async () => {
    const db = createSqliteD1();
    db.sqlite.exec(`
      INSERT INTO cost_events (id, account_id, project_id, tool_name, provider, billed_cents, credit_class, run_id, created_at)
        VALUES ('c1', 'acct', 'p1', 'tool', 'dataforseo', 12, 'paid', 'r1', 1), ('c2', 'other', 'p2', 'tool', 'dataforseo', 5, 'paid', 'r2', 1);
    `);
    await eraseAccountRows({ DB: db } as unknown as Env, 'acct');
    expect(db.sqlite.prepare(`SELECT id, account_id, project_id, run_id, billed_cents FROM cost_events ORDER BY id`).all()).toEqual([
      { id: 'c1', account_id: ERASED_ACCOUNT_PLACEHOLDER, project_id: null, run_id: null, billed_cents: 12 },
      { id: 'c2', account_id: 'other', project_id: 'p2', run_id: 'r2', billed_cents: 5 },
    ]);
  });

  it('removes the seat an erased person holds in another agency workspace', async () => {
    const db = createSqliteD1();
    db.sqlite.exec(`
      INSERT INTO users (id, source, account_id, email, created_at, last_seen_at) VALUES ('fb:u1', 'firebase', 'acct', 'pat@example.com', 1, 1);
      INSERT INTO client_workspaces (id, account_id, name, created_at, updated_at) VALUES ('ws', 'agency', 'Agency', 1, 1);
      INSERT INTO client_workspace_members (workspace_id, email, user_id, role, status, invited_at) VALUES
        ('ws', 'pat@example.com', 'fb:u1', 'staff', 'active', 1),
        ('ws', 'invitee@example.com', NULL, 'staff', 'invited', 1),
        ('ws', 'boss@example.com', 'fb:boss', 'owner', 'active', 1);
    `);
    await eraseAccountRows({ DB: db } as unknown as Env, 'acct');
    expect(db.sqlite.prepare(`SELECT email FROM client_workspace_members ORDER BY email`).all()).toEqual([
      { email: 'boss@example.com' },
      { email: 'invitee@example.com' },
    ]);
  });
});
