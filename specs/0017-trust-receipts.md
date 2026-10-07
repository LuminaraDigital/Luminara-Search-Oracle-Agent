# Spec 0017: Trust Receipts and domain verification (Track TN)

Plan: `docs/plans/trust-network-additive-plan.md`. Brand: Luminara only.

## What

1. **Trust Receipts.** A receipt is a server-signed statement that a Luminara verifier checked a claim: subject, claim, level, method, evidence (URL and SHA-256, never a copy), measurement status. Ed25519 over canonical JSON. Anyone can verify a receipt offline with the public key at `/api/trust/keys`; the `/verify/r/<id>` page verifies in the browser.
2. **Levels are mandatory.** `worker_verified` (a Worker verifier checked it), `registry_verified` (matched an official register), `self_reported` (recorded, not verified). The UI never presents `self_reported` as verified.
3. **Domain control.** The owner publishes a per-account token by DNS TXT, a `/.well-known` file, or a home page meta tag. The Worker finds it and issues a `domain_control` receipt. A weekly re-check lapses the verification and revokes the receipt after two consecutive misses. Network failures are `not_measured`, never held against the owner.
4. **Audit chain hardening.** The hash-chained audit log append is fork-proof and has an owner verification route.

## Why

Every Trust Network feature (verified profile, Proof Feed, agent action logs, agent job deliverables, milestone proofs for Launchpad escrow) needs the same two things the product lacked: proof that a user controls a domain, and a portable, publicly verifiable record of what Luminara checked. One primitive serves all of them, so later features are views, not new proof systems. Domain control also closes a gap: before this, anyone could publish audits or proofs about any domain.

The audit log could fork under concurrent writes (read head, then insert, with no transaction), and nothing exposed verification. Receipts for agent action logs (spec 0016 K4) depend on a chain that verifies.

## Decisions

- **Signature scheme: Ed25519 via WebCrypto.** Available in Workers, browsers, and Node without dependencies. Key id is derived from the public key so it cannot drift. Rotation publishes retired public keys so old receipts keep verifying.
- **Signed bytes are stored.** `payload_json` is the exact canonical JSON that was signed; verifiers check those bytes, never a re-serialisation.
- **No mint route.** Only server-side verifiers issue receipts. A client cannot submit a receipt or a claim to be signed.
- **Revocation is a column.** A receipt that was ever public stays resolvable as revoked, so stale links show "revoked" instead of disappearing.
- **Token stored hashed; checks compare hashes of candidates found on the domain.** The plaintext is shown once. A token verifies only the account it was issued to.
- **HTTP proof must be served by the domain or its www twin** after SSRF-guarded redirects.
- **Audit append is a conditional insert** (`INSERT ... SELECT ... WHERE head = prev_hash`) with retry and jittered backoff, because D1 has no interactive transactions. The head is the last row by insertion order, not timestamp.

## Alternatives considered

- **On-chain anchoring as the proof.** Rejected as the primary mechanism: a chain timestamp proves when a digest existed, not who checked what. Anchoring of receipt digests remains possible later through the Zoro plan's Phase 4, testnet first.
- **W3C Verifiable Credentials format now.** Deferred. The receipt payload maps onto a VC later; adopting the full data model now adds JSON-LD processing with no current consumer.
- **HMAC signatures.** Rejected: verification would require the secret, so third parties could not verify.
- **Rewriting forked legacy audit rows.** Rejected: it breaks the chain property. Forks are reported, not repaired.
- **Allowing silent token reissue on a verified domain.** Rejected: the weekly re-check would look for an unpublished token and lapse a valid verification. The owner removes the domain to start over.

## Open questions

- Whether `/verify/r/<id>` pages should be indexable for public receipts (SEO value versus spam risk). Default: `noindex` until the verified profile ships.
- Retention of revoked receipts after account deletion is currently "delete with the account".
