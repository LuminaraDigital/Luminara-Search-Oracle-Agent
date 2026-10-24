/**
 * D1 to Firestore backfill. Dry-run unless --apply is passed.
 * Staging:
 *   npx wrangler d1 execute luminara-users-staging --env staging --remote --json \
 *     --command "SELECT id, source, account_id, email, display_name, telegram_id, firebase_uid, created_at, last_seen_at, welcome_sent_at, email_opt_out_at FROM users;" \
 *     > users.json
 *   npx wrangler d1 execute luminara-users-staging --env staging --remote --json \
 *     --command "SELECT account_id, id, domain, measured_at, updated_at, entry_json FROM audit_history;" \
 *     > audits.json
 *   npm run db:backfill:firestore -- --from-users users.json --from-audits audits.json --project luminara-suite-staging
 *   npm run db:backfill:firestore -- --apply --from-users users.json --from-audits audits.json --project luminara-suite-staging
 * Do not select email_unsub_token. Delete the export files after the run. They contain email addresses.
 */
import { readFileSync } from 'node:fs';
import { main } from '../worker/backfillFirestore';

const code = await main(process.argv.slice(2), {
  readText: (path) => readFileSync(path, 'utf8'),
  write: (text) => {
    process.stdout.write(text);
  },
  writeErr: (text) => {
    process.stderr.write(text);
  },
  env: process.env,
  fetch: globalThis.fetch,
});
process.exit(code);
