/**
 * Idempotent D1 to Firestore backfill planner.
 * Default is a dry run. `--apply` plus `--project` writes. `luminara-suite` is refused
 * unless `--i-understand-prod` is set. Document ids match the Worker mirror.
 */
import { createFirestoreClient } from './firestoreRest';
import { tokenProviderFromEnv, type GcpTokenProvider } from './gcpToken';
import { eraseTargetsFromExport, purgeFirestoreAccount, readErasedLedger, ERASE_PAGE_SIZE } from './accountMirror';
import {
  AUDIT_COLLECTION,
  PROD_GCP_PROJECT,
  USER_COLLECTION,
  auditExportToWrite,
  userDocId,
  userExportToFields,
} from './dataPlaneDocs';
import type { DataPlaneEnv } from './dataPlaneDocs';

export const BACKFILL_USAGE = [
  'Usage:',
  '  npm run db:backfill:firestore -- --from-users users.json --from-audits audits.json --project luminara-suite-staging',
  '  npm run db:backfill:firestore -- --apply --from-users users.json --from-audits audits.json --project luminara-suite-staging',
  '  npm run db:backfill:firestore -- --reconcile-erases pending.json --project luminara-suite-staging',
  '  npm run db:backfill:firestore -- --apply --reconcile-erases pending.json --project luminara-suite-staging',
  '',
  'The default is a dry run: counts and sample field names, no Firestore calls.',
  '--apply writes and requires --project.',
  '--erased is a firestore_erase_ledger export. Those login ids and account ids are skipped.',
  '--reconcile-erases deletes the Firestore docs for pending erases. It does not backfill.',
  'Project luminara-suite is refused unless --i-understand-prod is also passed.',
  'Export files contain email addresses. Keep them out of git and delete them after the run.',
  'Do not select email_unsub_token. The planner drops that column if it is present.',
].join('\n');

const PROJECT_ID = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export type BackfillArgs = {
  mode: 'dry-run' | 'apply';
  project: string | null;
  understandProd: boolean;
  usersPath: string | null;
  auditsPath: string | null;
  erasedPath: string | null;
  reconcilePath: string | null;
};

export type PlannedWrite = {
  collection: typeof USER_COLLECTION | typeof AUDIT_COLLECTION;
  id: string;
  fields: Record<string, unknown>;
};

export function parseBackfillArgs(argv: readonly string[]): { ok: true; args: BackfillArgs } | { ok: false; error: string; help?: boolean } {
  let mode: 'dry-run' | 'apply' | null = null;
  let project: string | null = null;
  let understandProd = false;
  let usersPath: string | null = null;
  let auditsPath: string | null = null;
  let erasedPath: string | null = null;
  let reconcilePath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') return { ok: false, error: BACKFILL_USAGE, help: true };
    if (arg === '--dry-run') {
      if (mode === 'apply') return { ok: false, error: 'Pass only one of --dry-run or --apply.' };
      mode = 'dry-run';
      continue;
    }
    if (arg === '--apply') {
      if (mode === 'dry-run') return { ok: false, error: 'Pass only one of --dry-run or --apply.' };
      mode = 'apply';
      continue;
    }
    if (arg === '--i-understand-prod') {
      understandProd = true;
      continue;
    }
    if (arg === '--project' || arg === '--from-users' || arg === '--from-audits' || arg === '--erased' || arg === '--reconcile-erases') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) return { ok: false, error: `${arg} needs a value.` };
      i += 1;
      if (arg === '--project') project = value;
      if (arg === '--from-users') usersPath = value;
      if (arg === '--from-audits') auditsPath = value;
      if (arg === '--erased') erasedPath = value;
      if (arg === '--reconcile-erases') reconcilePath = value;
      continue;
    }
    const shown = arg.startsWith('--') && arg.length <= 40 ? arg : '(rejected)';
    return { ok: false, error: `Unknown argument ${shown}.` };
  }
  if (project && !PROJECT_ID.test(project)) return { ok: false, error: '--project must be a GCP project id.' };
  if (project === PROD_GCP_PROJECT && !understandProd) {
    return { ok: false, error: `Refusing project ${PROD_GCP_PROJECT}. Pass --i-understand-prod to target production.` };
  }
  const selected = mode ?? 'dry-run';
  if (selected === 'apply' && !project) return { ok: false, error: '--apply requires --project.' };
  if (reconcilePath && (usersPath || auditsPath || erasedPath)) {
    return { ok: false, error: '--reconcile-erases runs on its own.' };
  }
  if (!reconcilePath && !usersPath && !auditsPath) {
    return { ok: false, error: `Pass --from-users, --from-audits, or both.\n${BACKFILL_USAGE}` };
  }
  return { ok: true, args: { mode: selected, project, understandProd, usersPath, auditsPath, erasedPath, reconcilePath } };
}

export function rowsFromExport(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    if (parsed.some((row) => isRecord(row) && 'results' in row)) {
      return parsed.flatMap((row) => (isRecord(row) && Array.isArray(row.results) ? row.results.filter(isRecord) : []));
    }
    return parsed.filter(isRecord);
  }
  if (isRecord(parsed) && Array.isArray(parsed.results)) return parsed.results.filter(isRecord);
  throw new Error('Expected a JSON array of rows, or a wrangler d1 execute --json payload.');
}

export function planBackfill(input: {
  users?: Record<string, unknown>[];
  audits?: Record<string, unknown>[];
  erasedUserIds?: readonly string[];
  erasedAccountIds?: readonly string[];
}): { writes: PlannedWrite[]; skipped: number } {
  const erasedUsers = new Set(input.erasedUserIds ?? []);
  const erasedAccounts = new Set(input.erasedAccountIds ?? []);
  const writes: PlannedWrite[] = [];
  let skipped = 0;
  for (const row of input.users ?? []) {
    const fields = userExportToFields(row);
    if (!fields || typeof fields.id !== 'string') {
      skipped += 1;
      continue;
    }
    const accountId = typeof fields.accountId === 'string' ? fields.accountId : '';
    if (erasedUsers.has(fields.id) || (accountId && erasedAccounts.has(accountId))) {
      skipped += 1;
      continue;
    }
    try {
      writes.push({ collection: USER_COLLECTION, id: userDocId(fields.id), fields });
    } catch {
      skipped += 1;
    }
  }
  for (const row of input.audits ?? []) {
    if (typeof row.account_id === 'string' && erasedAccounts.has(row.account_id)) {
      skipped += 1;
      continue;
    }
    const planned = auditExportToWrite(row);
    if (!planned) {
      skipped += 1;
      continue;
    }
    writes.push({ collection: AUDIT_COLLECTION, id: planned.id, fields: planned.fields });
  }
  return { writes, skipped };
}

/** Upsert by collection and id. A second call with the same writes leaves the map unchanged. */
export function applyPlanned(store: Map<string, string>, writes: PlannedWrite[]): void {
  for (const write of writes) store.set(`${write.collection}/${write.id}`, stableStringify(write.fields));
}

export function sampleLines(writes: PlannedWrite[], limit = 3): string[] {
  return writes.slice(0, limit).map((write) => {
    const names = Object.keys(write.fields).sort().join(',');
    return `sample ${write.collection}/${write.id} upsert ${names}`;
  });
}

export function formatDryRun(users: PlannedWrite[], audits: PlannedWrite[], skipped: number): string {
  return [
    'data_plane_backfill dry_run',
    `users: ${users.length}`,
    `audits: ${audits.length}`,
    `skipped: ${skipped}`,
    ...sampleLines(users),
    ...sampleLines(audits),
    '',
  ].join('\n');
}

export type BackfillIo = {
  readText: (path: string) => string;
  write: (text: string) => void;
  writeErr?: (text: string) => void;
  env?: DataPlaneEnv;
  fetch?: typeof fetch;
  tokenProvider?: GcpTokenProvider;
};

export async function main(argv: readonly string[], io: BackfillIo): Promise<number> {
  const parsed = parseBackfillArgs(argv);
  const writeErr = io.writeErr ?? io.write;
  if (!parsed.ok) {
    writeErr(`${parsed.error}\n`);
    return parsed.help ? 0 : 1;
  }
  const args = parsed.args;
  if (args.reconcilePath) return reconcileFromFile(args.reconcilePath, args, io);
  let users: Record<string, unknown>[] = [];
  let audits: Record<string, unknown>[] = [];
  let erased = { userIds: [] as string[], accountIds: [] as string[] };
  try {
    if (args.usersPath) users = rowsFromExport(JSON.parse(io.readText(args.usersPath)));
    if (args.auditsPath) audits = rowsFromExport(JSON.parse(io.readText(args.auditsPath)));
    if (args.erasedPath) erased = readErasedLedger(JSON.parse(io.readText(args.erasedPath)));
  } catch (err) {
    writeErr(`${err instanceof Error ? err.message : 'Could not read the export.'}\n`);
    return 1;
  }
  const planned = planBackfill({
    users,
    audits,
    erasedUserIds: erased.userIds,
    erasedAccountIds: erased.accountIds,
  });
  const userWrites = planned.writes.filter((write) => write.collection === USER_COLLECTION);
  const auditWrites = planned.writes.filter((write) => write.collection === AUDIT_COLLECTION);
  if (args.mode === 'dry-run') {
    io.write(formatDryRun(userWrites, auditWrites, planned.skipped));
    return 0;
  }
  const project = args.project;
  if (!project) {
    writeErr('--apply requires --project.\n');
    return 1;
  }
  const fetchImpl = io.fetch ?? fetch;
  const tokenProvider = io.tokenProvider ?? (io.env ? tokenProviderFromEnv(io.env, fetchImpl) : null);
  if (!tokenProvider) {
    writeErr('Workload Identity config is incomplete. Set GCP_WIF_AUDIENCE, GCP_OIDC_ISSUER, GCP_OIDC_SUBJECT, GCP_OIDC_KEY_ID, GCP_OIDC_SIGNING_KEY, and GCP_IMPERSONATE_SERVICE_ACCOUNT.\n');
    return 1;
  }
  const client = createFirestoreClient({ project, tokenProvider, fetch: fetchImpl });
  try {
    for (const write of planned.writes) {
      await client.patch(write.collection, write.id, write.fields);
    }
  } catch (err) {
    writeErr(`${err instanceof Error ? err.message : 'Firestore write failed.'}\n`);
    return 1;
  }
  io.write(`data_plane_backfill apply\nusers: ${userWrites.length}\naudits: ${auditWrites.length}\nskipped: ${planned.skipped}\nproject: ${project}\n`);
  return 0;
}

async function reconcileFromFile(path: string, args: BackfillArgs, io: BackfillIo): Promise<number> {
  const writeErr = io.writeErr ?? io.write;
  let targets;
  try {
    targets = eraseTargetsFromExport(JSON.parse(io.readText(path)));
  } catch (err) {
    writeErr(`${err instanceof Error ? err.message : 'Could not read the export.'}\n`);
    return 1;
  }
  if (args.mode === 'dry-run') {
    io.write(`data_plane_reconcile dry_run\naccounts: ${targets.length}\n`);
    return 0;
  }
  const project = args.project;
  if (!project) {
    writeErr('--apply requires --project.\n');
    return 1;
  }
  const fetchImpl = io.fetch ?? fetch;
  const tokenProvider = io.tokenProvider ?? (io.env ? tokenProviderFromEnv(io.env, fetchImpl) : null);
  if (!tokenProvider) {
    writeErr('Workload Identity config is incomplete. Set GCP_WIF_AUDIENCE, GCP_OIDC_ISSUER, GCP_OIDC_SUBJECT, GCP_OIDC_KEY_ID, GCP_OIDC_SIGNING_KEY, and GCP_IMPERSONATE_SERVICE_ACCOUNT.\n');
    return 1;
  }
  const client = createFirestoreClient({ project, tokenProvider, fetch: fetchImpl });
  try {
    for (const target of targets) await purgeFirestoreAccount(client, target, ERASE_PAGE_SIZE);
  } catch (err) {
    writeErr(`${err instanceof Error ? err.message : 'Firestore delete failed.'}\n`);
    return 1;
  }
  io.write(`data_plane_reconcile apply\naccounts: ${targets.length}\nproject: ${project}\n`);
  return 0;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
