# Signed Audit Receipt

The Worker signs a canonical JSON payload with the Ed25519 key in `RECEIPT_SIGNING_KEY` (the same secret as Trust Receipts, `npm run keys:receipt`). Retired public keys stay in `RECEIPT_RETIRED_PUBLIC_KEYS`. The private key is not in the repo.

The signed bytes are `luminara:audit-receipt:v1\n` plus canonical JSON, so a Trust Receipt cannot verify as one of these under the shared key.

The payload holds SHA-256 hashes, not the crawl text or the engine bodies. `source` is `caller_submitted`. `accountHash` is a SHA-256 of the account id with a fixed prefix, not the account id. The verify page says the receipt was submitted by the account holder and that Luminara did not run the audit.

- Crawl: raw UTF-8 of the text that was submitted. Null when that input was omitted.
- Engine responses, prompt set, and model list: canonical JSON. Null when omitted.
- `observedAt`: the caller-supplied audit time, or null.
- `issuedAt`: the Worker clock at signing. It is inside the content hash and the signature.
- `contentSha256`: SHA-256 of the canonical content fields, also covered by the signature.

A null hash is `not_measured`. The receipt does not invent a count or a score. A valid signature means the payload was not changed after signing. It does not re-run the audit.

Creating one (`POST /api/audit-receipts`) requires a signed-in paid plan (Starter or above), a Trust-verified domain for that account (`domain_verifications.status = verified`), and stays under the daily cap (`AUDIT_RECEIPT_DAILY_QUOTA`, default 10). There is no second minting flag: with domain verification off, an account cannot newly verify a domain, so it cannot mint. The owner revokes with `POST /api/audit-receipts/:id/revoke`. Revocation marks the row. The signature still matches. Public pages: `/verify/audit` and `/verify/audit/:id`. Public API: `GET /api/audit-receipts/keys`, `GET /api/audit-receipts/:id`, `POST /api/audit-receipts/verify`. Rows live in D1 table `signed_audit_receipts` (migration 0034). No chain client and no new datastore.
