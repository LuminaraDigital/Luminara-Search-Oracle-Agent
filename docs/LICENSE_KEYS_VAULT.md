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
