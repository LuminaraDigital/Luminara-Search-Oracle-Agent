/**
 * Test-only D1 stand-in backed by in-memory SQLite (node:sqlite). It applies the real files in
 * migrations/, so PRIMARY KEY / UNIQUE / CHECK behave like production D1. Each call yields to the
 * event loop first so concurrent Promise.all callers really interleave; batch() is one transaction.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => any };

const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'migrations');
const RETURNS_ROWS = /^\s*(SELECT|WITH|PRAGMA)\b|\bRETURNING\b/i;

const yieldToLoop = () => new Promise<void>((done) => setImmediate(done));

function toSqlValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export type SqliteD1 = D1Database & { sqlite: any };

export function createSqliteD1(options: { skipMigrations?: string[] } = {}): SqliteD1 {
  const sqlite = new DatabaseSync(':memory:');
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (options.skipMigrations?.some((prefix) => file.startsWith(prefix))) continue;
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8'));
  }

  function statement(sql: string, params: unknown[] = []): any {
    const args = () => params.map(toSqlValue);
    const execute = () => {
      const prepared = sqlite.prepare(sql);
      if (RETURNS_ROWS.test(sql)) {
        const rows = prepared.all(...args()).map((row: object) => ({ ...row }));
        return { success: true, results: rows, meta: { changes: 0 } };
      }
      const info = prepared.run(...args());
      return {
        success: true,
        results: [],
        meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
      };
    };
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      execute,
      async first(column?: string) {
        await yieldToLoop();
        const row = sqlite.prepare(sql).get(...args());
        if (!row) return null;
        return column ? (row[column] ?? null) : { ...row };
      },
      async all() {
        await yieldToLoop();
        return execute();
      },
      async run() {
        await yieldToLoop();
        return execute();
      },
    };
  }

  const db = {
    sqlite,
    prepare: (sql: string) => statement(sql),
    async batch(statements: any[]) {
      await yieldToLoop();
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((s) => s.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    async exec(sql: string) {
      await yieldToLoop();
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return db as unknown as SqliteD1;
}
