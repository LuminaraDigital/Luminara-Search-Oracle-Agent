/**
 * Remove historical MCP tool inputs from org_audit_logs and reseal the hash chain.
 *
 * Staging, from the staging deploy job, after the Time Travel bookmark and
 * d1 migrations apply, before the Worker deploy:
 *   npm run db:strip-mcp-audit-inputs -- --staging
 *
 * Production, from the production deploy job on main, same point in the job:
 *   CONFIRM_PROD_AUDIT_STRIP=1 npm run db:strip-mcp-audit-inputs -- --prod
 *
 * A second run writes nothing. This does not run inside `d1 migrations apply`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mcpAuditStripTarget, stripMcpAuditInputs } from '../worker/stripMcpAuditInputs';

type D1Result = { results?: unknown[]; success?: boolean; meta?: { changes?: number } };

function wranglerConfig(): { accountId: string; stagingId: string; productionId: string } {
  const text = readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const json = JSON.parse(text) as {
    account_id: string;
    env: {
      staging: { d1_databases: { binding: string; database_id: string }[] };
      production: { d1_databases: { binding: string; database_id: string }[] };
    };
  };
  const idFor = (envName: 'staging' | 'production') => {
    const db = json.env[envName].d1_databases.find((item) => item.binding === 'DB');
    if (!db?.database_id) throw new Error(`wrangler.jsonc has no ${envName} DB binding.`);
    return db.database_id;
  };
  return { accountId: json.account_id, stagingId: idFor('staging'), productionId: idFor('production') };
}

function resultList(body: unknown): D1Result[] {
  if (!body || typeof body !== 'object') throw new Error('D1 returned an empty body.');
  const record = body as { success?: boolean; errors?: { message?: string }[]; result?: unknown };
  if (record.success === false) {
    const message = record.errors?.map((item) => item.message || 'D1 error').join('; ');
    throw new Error(message || 'D1 query failed.');
  }
  if (!Array.isArray(record.result)) throw new Error('D1 returned no result list.');
  return record.result as D1Result[];
}

function remoteDb(opts: { accountId: string; token: string; databaseId: string; fetchImpl: typeof fetch }) {
  async function query(payload: { sql: string; params: unknown[] } | { batch: { sql: string; params: unknown[] }[] }): Promise<D1Result[]> {
    const res = await opts.fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/d1/database/${opts.databaseId}/query`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`D1 query failed (${res.status}): ${text.slice(0, 400)}`);
    return resultList(JSON.parse(text) as unknown);
  }

  function prepare(sql: string) {
    const stmt = {
      sql,
      params: [] as unknown[],
      bind(...next: unknown[]) {
        stmt.params = next;
        return stmt;
      },
      async all() {
        const [row] = await query({ sql: stmt.sql, params: stmt.params });
        return { results: row?.results || [], success: true, meta: row?.meta || {} };
      },
      async first() {
        const read = await stmt.all();
        return read.results[0] ?? null;
      },
      async run() {
        const [row] = await query({ sql: stmt.sql, params: stmt.params });
        return { success: true, meta: row?.meta || { changes: 0 }, results: row?.results || [] };
      },
    };
    return stmt;
  }

  return {
    prepare,
    async batch(statements: { sql: string; params: unknown[] }[]) {
      const rows = await query({ batch: statements.map((statement) => ({ sql: statement.sql, params: statement.params })) });
      return rows.map((row) => ({ success: true, meta: { changes: Number(row.meta?.changes || 0) }, results: row.results || [] }));
    },
  };
}

async function main(): Promise<number> {
  const target = mcpAuditStripTarget(process.argv.slice(2), process.env);
  const config = wranglerConfig();
  const token = process.env.CLOUDFLARE_API_TOKEN || '';
  if (!token) {
    console.error('CLOUDFLARE_API_TOKEN is required.');
    return 1;
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || config.accountId;
  const databaseId = target.envName === 'production' ? config.productionId : config.stagingId;
  const db = remoteDb({ accountId, token, databaseId, fetchImpl: globalThis.fetch });
  const result = await stripMcpAuditInputs(db as unknown as Parameters<typeof stripMcpAuditInputs>[0]);
  console.log(`[audit-strip] ${target.database}: orgs ${result.orgs}, rows ${result.rows}`);
  return 0;
}

const code = await main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  return 1;
});
process.exit(code);
