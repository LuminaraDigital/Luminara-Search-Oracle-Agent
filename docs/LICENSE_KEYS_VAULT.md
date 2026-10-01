# License keys (ops only)

Commercial and single-use license keys are **not** stored in this repository.

## How keys work

- Built-in campaign / trial codes live in `worker/licenseService.ts` (`BUILTIN_CAMPAIGN_KEYS`).
- All other serial keys (`LUM-…-….D-XXXX-YYYY`) must be **pre-minted into KV** via:
  - `npm run keys:seed-vault:apply` (reads `.secrets/license-vault.json`, never commit that file), or
  - `generateLicenseKeys` / `POST /api/admin/license/generate`, or
  - `importLicenseKeys` / `POST /api/admin/license/seed`
- Unknown serial-shaped strings are rejected. The Worker does not invent entitlements from the key pattern alone.

## Campaign codes (always live in Worker code)

| Key | Plan | Days |
| --- | --- | --- |
| `LUM-GROWTH-3DAY` | growth | 3 |
| `LUM-TRIAL-3D` | growth | 3 |
| `LUM-LAUNCH-3D` | growth | 3 |
| `LUM-PROMO-3DAY` | starter | 3 |
| `LUM-VIP-7DAY` | growth | 7 |
| `LUM-AGENCY-7DAY` | agency | 7 |

Each account may redeem at most one promotional trial.

## Rotation note

Any keys that previously appeared in git history should be treated as compromised if they were public. Prefer minting replacements into KV for new customers after a leak.

## Ops checklist: historical leak response

Do **not** paste commercial serials into chat, tickets, or PRs.

1. Inventory any serials that appeared in git history offline (operator machine only).
2. Mint replacement keys into KV only (`.secrets/license-vault.json` locally, never commit; or `POST /api/admin/license/generate`).
3. Operator decision (standing): previously published keys stay live and keep redeeming. Do not mark them redeemed or delete their KV records.
4. Confirm HEAD of this doc lists no commercial serials beyond the public campaign table above.
5. History purge (`git filter-repo` or BFG) and force-push only with explicit operator approval.
6. Verify `raw.githubusercontent.com/.../docs/LICENSE_KEYS_VAULT.md` (and tagged releases you care about) no longer expose old vault material.
7. Re-issue keys to customers out-of-band.
8. Rotate related operator secrets if the leak window included other credentials.

See also: `docs/plans/security-remediation-p0-p3.md`.
