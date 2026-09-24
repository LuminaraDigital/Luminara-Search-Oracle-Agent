# Spec 0009: Worker Log Redaction Service

Source pattern: paperclip `server/src/log-redaction.ts` (adapted for Cloudflare Worker runtime). Brand: Luminara only.

## Objective
Add a single `worker/logRedaction.ts` service that recursively redacts sensitive values from log payloads before they are written, plus a `safeLog` helper, and wire it into existing worker logging paths where secrets/keys could leak (audit log, error paths).

## Requirements
1. `redactSensitive(value: unknown, opts?: { extraKeys?: string[]; maxDepth?: number }): unknown` - recursive walker over plain objects and arrays (max depth default 8, depth-exceeded nodes replaced with `"[truncated]"`).
2. Key-based redaction: any object key (case-insensitive) matching a built-in list (password, secret, token, api_key, apikey, authorization, auth, private_key, license_key, license, card, cvc, otp, session, cookie, jwt, bearer) plus `opts.extraKeys` is replaced with `"[redacted]"`. Substring match forbidden: match whole key or common delimiter suffixes (e.g. `x_api_key`, `apiKey` normalized to lowercase).
3. Value-pattern redaction inside strings: redact
   - `Authorization: Bearer <token>` style tokens (keep the `Bearer ` prefix, mask token)
   - JWTs (3 base64url dotted segments, each >= 10 chars)
   - Luminara license key shape if defined in licenseService (read the regex/format there first; if none, use generic hex token >= 32 chars preceded by `key`/`license` label)
   - env-secret values: read secret values from the Env binding names at call time is NOT possible in tests; instead accept `secretValues?: string[]` in opts and replace occurrences of any listed value (length >= 8) with `[redacted]`.
4. Username/home-dir masking: keys named `username`, `user`, `home`, `userHome` and strings containing a Windows/posix home path (`C:\Users\<name>` or `/home/<name>` or `/Users/<name>`) mask the name to first char + `***`.
5. Non-plain objects (class instances, functions, D1 rows are plain) are passed through by reference, never enumerated.
6. Circular references replaced with `"[circular]"`.
7. `safeLog(event: string, data?: unknown, opts?): void` wrapper using console.log with JSON.stringify of the redacted payload; also export `redactForAudit(payload)` used by auditLog insertions for the `metadata`/`detail` fields.
8. Wire-in: `worker/auditLog.ts` and `worker/sentinel.ts` pass their detail/metadata objects through `redactSensitive` before persistence. Do NOT change their public function signatures.

## Edge cases
- Empty/null/undefined inputs returned as-is.
- Strings shorter than 8 chars are never pattern-redacted as bare secrets.
- Redaction must be non-destructive: input objects never mutated (return copies).

## Definition of done
- New `worker/logRedaction.ts` compiles under `npm run typecheck`.
- New tests `tests/logRedaction.test.ts` (>= 15 cases covering all requirements + edge cases) pass under `npm run test`.
- auditLog and sentinel integration verified by a test asserting persisted row contains `[redacted]` for a seeded secret.
- No em dashes, no external vendor names, all strings user-safe.

## Iteration budget: 3 build-review loops. Verification: `npm run typecheck && npx vitest run tests/logRedaction.test.ts tests/securityHardening.test.ts`.
