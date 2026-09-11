# License keys (ops only)

Commercial and single-use license keys are **not** stored in this repository.

## How keys work

- Built-in campaign / trial codes live in `worker/licenseService.ts` (`BUILTIN_CAMPAIGN_KEYS`).
- All other serial keys (`LUM-…-….D-XXXX-YYYY`) must be **pre-minted into KV** via the admin mint path (`generateLicenseKeys` / `POST /api/license/generate`).
- Unknown serial-shaped strings are rejected. The Worker does not invent entitlements from the key pattern alone.

## Requesting keys

Ask ops / the account owner for a mint. Do not paste live keys into git, tickets, chat, or PRs.

## Rotation note

Any keys that previously appeared in git history should be treated as compromised. Mint replacements into KV and invalidate prior single-use records after deploy.
