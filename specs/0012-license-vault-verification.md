# Spec 0012: License Vault Rotation Metadata and Verification

Source pattern: paperclip `server/src/secrets/` (value fingerprints, provider version refs, health checks) adapted to Luminara's existing KV license vault. Brand: Luminara only.

## Context
License serials live in KV `license:key:*` (worker/licenseService.ts), seeded by `scripts/seed-license-vault.mjs` from `.secrets/license-vault.json`, revoked by `scripts/revoke-license-keys.mjs`. Rotation runbook: `docs/plans/license-rotation-runbook.md`. Gap: no fingerprint or generation tracking, so after rotation there is no way to prove which keys are current vs stale, and the seed script gives no verification that remote state matches the vault.

## Objective
Add SHA-256 fingerprint + vault generation metadata to license records end-to-end (seed, service, revoke, verify) WITHOUT changing redemption semantics or the public LicenseKeyRecord interface (all new fields optional).

## Requirements
1. Fingerprint helper: add `licenseKeySha256(key: string): string` next to the existing fingerprint logic in worker (read `licenseKeyFingerprint` in auditLog.ts/licenseService.ts first; reuse the existing hashing style, sha256 hex, keyed on the uppercase trimmed key). Do NOT replace `licenseKeyFingerprint` (it is used for audit display, likely truncated); the new helper returns the FULL 64-char hex for verification manifests.
2. `worker/licenseService.ts`: `LicenseKeyRecord` gains optional `keySha256?: string` and `vaultGeneration?: string`. On redemption paths, never require them. Add `describeLicenseKey(key)` returning `{ exists, fingerprint (existing display fingerprint), keySha256?, vaultGeneration?, redeemed, revoked }` without returning the raw key.
3. `scripts/seed-license-vault.mjs`:
   - Generates `vaultGeneration` = `vg_<UTC date>_<8 hex from crypto>` at run start, logs it, and writes it plus `keySha256` into every KV record it seeds (record JSON gains the two fields).
   - After apply (`--apply`), writes `.secrets/license-vault.manifest.<vaultGeneration>.json` (NEVER committed; confirm `.secrets/` is gitignored, add to .gitignore if missing) containing `{ generation, count, entries: [{ sha256, plan, durationDays }] }` with NO raw keys.
   - Prints a verification summary: counts written, generation id.
4. New script `scripts/verify-license-vault.mjs`:
   - Reads the newest manifest in `.secrets/`, lists remote KV `license:key:*` keys (wrangler kv list pattern already used by revoke script, read it first), and for each manifest entry checks the remote record exists, matches `keySha256`, matches `vaultGeneration`, and is not `revoked`.
   - Report: `verified N/N`, plus lists of `missing`, `stale_generation`, `revoked`, `unknown_remote` (remote keys whose sha is not in the manifest) with counts only, never raw key values. Exit 0 when all manifest entries verified; exit 1 otherwise.
   - `--json` flag prints machine-readable report.
5. `scripts/revoke-license-keys.mjs`: when revoking, preserve existing fields and set `revokedAt`; if the record lacks the new fields, no backfill required (revocation only). Read the file first and make the smallest compatible change.
6. Runbook update: append a "Verification after rotation" section to `docs/plans/license-rotation-runbook.md` documenting manifest + verify script usage with exact commands.

## Edge cases
- KV list pagination handled (cursor).
- Records seeded before this change have no new fields: verify reports them as `legacy` under `unknown_remote` counts, not failures.
- Empty manifest: exit 1 with clear message.
- No raw key material in any log line anywhere in the new/changed scripts.

## Definition of done
- `npm run typecheck` green.
- New `tests/licenseVaultVerify.test.ts` (>= 12 cases: generation id format, manifest shape, verify report categories using a mocked KV list + local manifest written to a temp dir, legacy record handling, pagination, no-key-in-output assertion scanning captured stdout) green. Mocking style: follow how existing scripts are tested if precedents exist (search tests/ for scripts/*.mjs coverage; if none, test the exported functions by structuring seed/verify scripts with exported pure functions plus a thin main guard `if (process.argv[1] === fileURLToPath(import.meta.url))`, matching check-secrets.mjs patterns).
- `npx vitest run tests/licenseVaultVerify.test.ts tests/licenseKey.test.ts` green.
- Dry-run `node scripts/seed-license-vault.mjs` behavior unchanged when vault file is absent (still exits 1 with guidance).
- No em dashes; Luminara-only branding.

## Iteration budget: 2 build-review loops. Verification: commands above plus `npm run secrets:check` must stay green.
