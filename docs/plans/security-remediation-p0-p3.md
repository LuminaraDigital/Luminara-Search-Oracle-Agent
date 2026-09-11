# Security remediation plan (P0-P3)

**Date:** 2026-09-10  
**Verdict:** Not production-ready for paid onboarding until P0 is closed.  
**Method:** White-box verification of prior audit against current tree. No code changes in this pass. No production exploitation.

**Repo:** `LuminaraDigital/Luminara-Search-Oracle-Agent` (public)  
**Assumption:** Identity and payment primitives stay as-is; entitlement, write surfaces, crawler, and XSS are the focus.

---

## Verification summary

| Prior claim | Verdict | Notes |
|---|---|---|
| License fabricate-on-miss | **CONFIRMED** | `worker/licenseService.ts` lines 110-129; tests encode it as intended |
| Unauthenticated `/api/agent/attest` POST | **CONFIRMED** | No `identify()` on write path |
| License vault in public GitHub | **CONFIRMED** | `docs/LICENSE_KEYS_VAULT.md`; repo `isPrivate: false` |
| Crawler SSRF via redirects | **CONFIRMED** | Redirects use `parsePublicHttpUrl` only (no DNS) |
| Crawler open when `CRAWLER_TOKEN` empty | **CONFIRMED** | `tokenMatches` returns true if empty |
| White-label `document.write` XSS | **CONFIRMED** | Unescaped markdown into HTML |
| 8 Mediums | **7 CONFIRMED, 1 PARTIAL** | Compose crawler bind overstated; Umami/LT exposure real |
| Enterprise GOLD keys redeemable via fabricate | **PARTIAL** | Extra `-GOLD-` segment fails regex; still leaked inventory |

**Do not paste vault keys into tickets, chat, or PRs.** Rotate and treat as compromised.

---

## P0 (block paid onboarding)

### 1. License registry: remove fabricate-on-miss (Critical)

**Problem:** If a key is not in KV and not a built-in campaign key, any string matching `LUM-(STARTER|GROWTH|PRO|AGENCY)-(\d+)D-XXXX-YYYY` is accepted and grants that plan for up to 365 days. Keys with `durationDays > 7` skip the one-trial anti-abuse check.

**Fix:**
1. Delete the dynamic regex branch in `activateLicenseKey` (keep only KV records + explicit `BUILTIN_CAMPAIGN_KEYS`).
2. Ensure `generateLicenseKeys` / admin mint writes every commercial key to KV before distribution.
3. Rewrite `tests/licenseKey.test.ts`:
   - Remove / invert "activates dynamic serial keys" and "activates pre-minted vault keys" without KV seed.
   - Assert unknown serial-shaped keys fail.
   - Keep tests for built-ins, single-use after mint, trial anti-abuse, extension.
4. Deploy Worker immediately after merge.

**Acceptance:**
- Signed-in POST `/api/license/activate` with a never-minted `LUM-AGENCY-365D-XXXX-YYYY` returns 400.
- Minted key works once; second redeemer fails.
- Built-in campaign keys still work once per account (trial rule).

### 2. Attest route: auth + integrity + probe cleanup (High)

**Problem:** `POST /api/agent/attest` writes arbitrary JSON to `poa:{digestHex}` with no auth.

**Fix:**
1. Require `identify()` (Telegram or Firebase) on POST.
2. Verify attestation fields server-side (digest recomputed from canonical payload; domain ownership or audit session binding).
3. Optionally keep GET public for badge verify, or rate-limit heavily.
4. Delete KV key `poa:audit-test-probe-lso-2026-09-10` (and any other probe digests).
5. Add Worker tests for 401 without auth and reject of forged digest.

**Acceptance:**
- Unauthenticated POST returns 401 and does not write KV.
- Authenticated forged digest without matching audit proof is rejected.
- Probe key gone from KV.

### 3. Key rotation + vault purge + history rewrite (High)

**Depends on:** P0-1 (rotation alone is pointless while fabricate exists).

**Fix:**
1. Mint replacement keys into KV only; distribute out-of-band (not in git).
2. Invalidate all prior vault/campaign single-use keys in KV (mark redeemed or delete).
3. Remove `docs/LICENSE_KEYS_VAULT.md` from the tree; replace with a short "request keys from ops" doc that lists **no** secrets.
4. Rewrite git history (`git filter-repo` or BFG) to purge the vault file; force-push with operator approval.
5. Confirm `raw.githubusercontent.com/.../docs/LICENSE_KEYS_VAULT.md` returns 404 on default branch and tagged releases you care about.
6. Consider making the GitHub repo private until history purge is complete.

**Acceptance:**
- File absent from HEAD; raw URL 404.
- Old published keys fail activation after P0-1.
- New keys work only when present in KV.

### 4. Crawler SSRF: DNS-check every hop (High)

**Problem:** Initial URL uses `assertPublicTarget` (DNS). Redirects/subresources use `parsePublicHttpUrl` only, so hosts like `169.254.169.254.nip.io` pass syntax and resolve privately in Chromium.

**Fix:**
1. In `context.route`, await `assertPublicTarget(reqUrl)` (or shared DNS cache) before `continue`.
2. Cap redirect count; abort on any private resolution.
3. Add tests for nip.io / rebinding-style hostnames.
4. Prefer allowlisting public DNS only; block known rebinding TLDs if needed.

**Acceptance:**
- Unit/integration test: redirect to link-local via nip.io is aborted.
- Direct metadata IP still blocked.

### 5. Crawler auth, CORS, limits (High)

**Problem:** Empty `CRAWLER_TOKEN` allows all callers; permissive CORS; no rate limit; unbounded Chromium launches. Same compose network as Umami (default admin/umami) and LanguageTool.

**Fix:**
1. Fail startup if `CRAWLER_TOKEN` is empty when `HOST` is non-loopback; prefer fail-closed always in production compose.
2. Require token even on loopback in production profile (or document loopback-only as the sole exception).
3. Tighten CORS to known app origins.
4. Add per-IP rate limits and max concurrent browser sessions.
5. Compose: publish Umami/LanguageTool on `127.0.0.1` only; change default DB/admin passwords; add `mem_limit` / CPU limits.

**Acceptance:**
- Request without token returns 401 when token is configured.
- Compose does not publish helper UIs on `0.0.0.0`.
- Concurrent scrape storm is rejected or queued.

### 6. White-label print XSS (High)

**Problem:** `markdownText` and other fields are interpolated into HTML then passed to `document.write` in a same-origin popup.

**Fix:**
1. HTML-escape all interpolated values (`agencyName`, `clientName`, `executiveNotes`, `markdownText`, etc.).
2. Prefer `text/plain` / sanitized Markdown-to-HTML with a strict sanitizer; avoid `document.write`.
3. Add a regression test that a payload containing `<img onerror=...>` does not execute.

**Acceptance:**
- Crafted audit markdown cannot run script in the print window.
- BYOK keys in `localStorage` are not readable via this path.

---

## P1 (before broad paid traffic)

1. **CMS steering:** Do not prefill WordPress/Webflow endpoint from audit `domain`. User must type/select an allowlisted origin.
2. **JSON-LD `</script>` gate:** Reject breakout strings in `schemaSafetyGate` before Webflow custom code / GitHub PR content.
3. **BYOK privacy truth + encryption:** Fix `public/privacy.html` overclaim immediately. Then encrypt key bag at rest (or disable server sync of keys by default).
4. **KV races:** Atomic claim for license redemption, TON tx credit, and daily quota (Durable Object or conditional KV writes).
5. **Webhook throttle:** Keep secret auth; add soft limits per update type to reduce burn if secret leaks.
6. **Prompt fencing:** Apply `wrapUntrustedContent` to DNA scrape, market research, and Notebook corpus paths.
7. **VITE_ secrets:** Keep `.env` gitignored; stop placing vendor API secrets in `VITE_*` (browser-exposed in dev). Prefer Settings BYOK + Worker secrets.

---

## P2 / P3

- Low/Info items from the full prior report (headers already strong on production; continue secret scanning in CI).
- Dependency / SCA scanning (outside Shannon OSS scope): add Dependabot or equivalent.
- Post-fix: local-only Shannon or staging re-test after P0 (never production without explicit approval).

---

## Recommended execution order

```text
1. License registry fix + tests + Worker deploy
2. Attest auth + KV probe delete
3. Key rotation + vault purge + history rewrite
4. Crawler token mandate + SSRF redirect DNS checks + compose binds
5. White-label XSS escape
6. P1 mediums (privacy copy can ship same day as a docs hotfix)
7. Acceptance re-test, then paid onboarding
```

---

## Post-fix verification commands (operators)

```bash
# License: unknown serial must fail (use staging / wrangler dev, not production keys)
curl -sS -X POST "$API/api/license/activate" -H "Authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"key":"LUM-AGENCY-365D-TEST-FAIL"}'

# Attest: unauthenticated write must 401
curl -sS -o /dev/null -w "%{http_code}" -X POST "$API/api/agent/attest" \
  -H "content-type: application/json" \
  -d '{"digestHex":"should-not-write","domain":"example.com"}'

# Vault raw URL must 404 after history purge
curl -sS -o /dev/null -w "%{http_code}" \
  "https://raw.githubusercontent.com/LuminaraDigital/Luminara-Search-Oracle-Agent/main/docs/LICENSE_KEYS_VAULT.md"
```

---

## What to keep

- Telegram initData HMAC, webhook secret constant-time compare
- Firebase RS256 verification
- TON on-chain memo/amount match and Stars pre-checkout validation
- Provider path allowlists and hosted-key clamps
- CORS allowlist, parameterized D1, generic 500s
- DOMPurify + untrusted fencing on the main instant-audit path
- Production security headers (already confirmed live in prior check)

---

## Shannon note

A fresh Shannon run was **not** launched against production (per your non-production rule). White-box confirmation of the prior report is sufficient to drive this plan. After P0 lands on staging/local, an optional Shannon run with free providers (Ollama/Groq via LiteLLM) can re-validate injection/XSS/SSRF/authz classes. Shannon OSS does not cover secrets-in-git or privacy-copy issues.
