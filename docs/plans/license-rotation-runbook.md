# License rotation runbook (leaked-keys incident closure)

Scope: 55 license keys were published in git history (commit cc3739d, `docs/LICENSE_KEYS_VAULT.md` as it existed then; the raw URL still serves HTTP 200). They are seeded live in production KV via `scripts/seed-license-vault.mjs`. This runbook closes the incident: mint replacements, revoke the published keys, re-issue to holders. The operator executes all steps; this document and the helper script contain no key material.

Prereq: Cloudflare account owner, `wrangler` logged in, ADMIN_SECRET configured (`npx wrangler secret put ADMIN_SECRET`).

## 1. Obtain the leaked key list out-of-band

Reconstruct the 55 published keys from the historical commit (e.g. `git show cc3739d:docs/LICENSE_KEYS_VAULT.md`) or pull them from the ops vault. Save as a JSON array of key strings somewhere outside the repo:

```bash
git show cc3739d:docs/LICENSE_KEYS_VAULT.md > /tmp/vault.md   # then extract keys
# Expected shape in /tmp/leaked-keys.json: ["LUM-<TIER>-<N>D-XXXX-YYYY", ...]
node -e "const m=require('fs').readFileSync('/tmp/vault.md','utf8').match(/LUM-[A-Z0-9-]+/g);require('fs').writeFileSync('/tmp/leaked-keys.json',JSON.stringify(m))"
```

Never commit the extracted list. `.secrets/` is gitignored if you prefer to keep it there.

## 2. Mint replacement keys

```bash
npm run keys:generate -- --plan=growth --days=30 --count=55 --export=.secrets/replacement-keys.json
```

Mint per tier as needed to match what was leaked (starter/growth/agency/annual). The export file is the new vault; treat it as a secret.

## 3. Seed the replacements into production KV

Convert the export to the vault seed shape if needed, then:

```bash
# Inspect first (dry-run prints counts and a sample prefix only):
npm run keys:seed-vault
# Write production KV:
npm run keys:seed-vault:apply
```

`importLicenseKeys` and the seed script are idempotent and never overwrite existing keys, so re-running is safe.

## 4. Revoke the 55 published keys

```bash
# Dry-run (default): prints each record that would change, makes zero network calls:
node scripts/revoke-license-keys.mjs /tmp/leaked-keys.json
# Apply to production KV (reads each record, merges revoked=true, bulk-puts back):
node scripts/revoke-license-keys.mjs /tmp/leaked-keys.json --apply
```

The script reads each current `license:key:<KEY>` record, merges `revoked: true` + `revokedAt`, and writes it back preserving plan and redemption history. Absent keys get a tombstone so they are explicitly revoked, not merely unknown.

## 5. Verify revocation took effect

```bash
# 5a. Spot-check one revoked record in KV (pick any key from the list):
npx wrangler kv key get "license:key:<A-REVOKED-KEY>" --namespace-id=00d331adea604a70945fb1651b7968b3 --remote
# Expect: "revoked":true and "revokedAt":<ms epoch> in the JSON.

# 5b. Behavioral check: /api/license/activate must reject a revoked key.
#     Sign in to the app (or call with a valid session), POST a revoked key:
curl -s -X POST https://luminarasuite.com/api/license/activate \
  -H 'content-type: application/json' \
  -H "authorization: Bearer <session-or-idtoken>" \
  -d '{"key":"<A-REVOKED-KEY>"}'
# Expect HTTP 400 with: "This license key has been revoked and can no longer be redeemed."
```

`worker/licenseService.ts` checks `keyRecord.revoked === true` before the D1 claim, so a revoked key fails even if it had redemptions left.

## 6. Re-issue replacements to holders

1. From the production KV / admin records, find accounts that redeemed any leaked key (audit trail action `license.activate` with a matching key fingerprint, plus `license:key:*` records' `redeemedBy`).
2. Contact each holder, invalidate the old entitlement if the redeemed key was theirs, and deliver a replacement from `.secrets/replacement-keys.json` over a secure channel (Telegram DM from the bot, or email).
3. Record re-issue in the ops log; the audit trail gains a fresh `license.activate` entry when each replacement is redeemed.

## 7. Close out

- Purge the raw historical URL from caches / GitHub support if the repo is public (file a takedown or rewrite history; the raw file returning HTTP 200 keeps the leak live).
- Rotate ADMIN_SECRET and TELEGRAM_WEBHOOK_SECRET if either appears anywhere in the leaked material.
- Delete `/tmp/leaked-keys.json` and any scratch copies; keep `.secrets/replacement-keys.json` only in the ops vault.

## Verification summary (all steps)

| Step | Command | Expected |
| --- | --- | --- |
| 3 | `npm run keys:seed-vault` | dry-run prints counts, no key bodies |
| 4 | `node scripts/revoke-license-keys.mjs <list>` | per-key revoke plan, no writes, no network calls |
| 4 | `node scripts/revoke-license-keys.mjs <list> --apply` | "Revoked N license keys in production LUMINARA_KV." |
| 5a | `wrangler kv key get ...` | record shows `revoked:true` |
| 5b | `POST /api/license/activate` with revoked key | 400 revoked error |