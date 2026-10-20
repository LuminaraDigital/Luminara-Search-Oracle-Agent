# Signed Audit Receipt

The Worker signs a canonical JSON payload with the Ed25519 key in `RECEIPT_SIGNING_KEY` (the same secret as Trust Receipts, `npm run keys:receipt`). Retired public keys stay in `RECEIPT_RETIRED_PUBLIC_KEYS`. The private key is not in the repo.

The signed bytes are `luminara:audit-receipt:v1\n` plus canonical JSON, so a Trust Receipt cannot verify as one of these under the shared key.

The payload holds SHA-256 hashes, not the crawl text or the engine bodies. `source` is `caller_submitted`. `accountHash` is HMAC-SHA256 of the account id under `AUDIT_RECEIPT_ACCOUNT_HMAC_KEY`, not the account id. That key is a Wrangler secret (`wrangler secret put AUDIT_RECEIPT_ACCOUNT_HMAC_KEY`). It is not a wrangler var. It must be at least 32 bytes and it must not equal `RECEIPT_SIGNING_KEY`. If it is unset, too short, or the same as the signing key, minting returns 503 and signs nothing. Rotating it changes account hashes on receipts signed after the rotation. Older receipts keep the hash they were signed with. The verify page says the receipt was submitted by the account holder and that Luminara did not run the audit.

- Crawl: raw UTF-8 of the text that was submitted. Null when that input was omitted.
- Engine responses, prompt set, and model list: canonical JSON. Null when omitted.
- `observedAt`: the caller-supplied audit time, or null.
- `issuedAt`: the Worker clock at signing. It is inside the content hash and the signature.
- `contentSha256`: SHA-256 of the canonical content fields, also covered by the signature.

A null hash is `not_measured`. The receipt does not invent a count or a score. A valid signature means the payload was not changed after signing. It does not re-run the audit.

Creating one (`POST /api/audit-receipts`) requires `AUDIT_RECEIPTS_ENABLED=true`, a signed-in paid plan (Starter or above), and a domain whose verification is on and fresh. `DOMAIN_VERIFY_ENABLED` must be on. `domain_verifications.status` must be `verified`, `consecutive_failures` must be 0, and `last_proved_at` must fall inside `AUDIT_RECEIPT_DOMAIN_FRESH_DAYS` (default 10). The re-check interval stays 7 days (daily cron, 25 domains per run). A 7-day freshness window would mark a real domain stale for up to about a day before the next run, so the default is 10. The daily cap is `AUDIT_RECEIPT_DAILY_QUOTA` (default 10). The day starts at 00:00 UTC, which is 11:00 in Sydney while AEDT (UTC+11) is in effect. The insert counts rows in the same statement, so parallel requests cannot pass the cap. The owner revokes with `POST /api/audit-receipts/:id/revoke` even when minting is off. An operator revokes any account's receipt with `POST /api/admin/audit-receipts/:id/revoke` and `ADMIN_SECRET`. Revocation marks the row. The signature still matches. Public pages: `/verify/audit` and `/verify/audit/:id`. Public API: `GET /api/audit-receipts/keys`, `GET /api/audit-receipts/:id`, `POST /api/audit-receipts/verify`. Those stay available when the flag is off. Rows live in D1 table `signed_audit_receipts` (migrations 0034 and 0035). Domain proof time is migration 0036. No chain client and no new datastore.
