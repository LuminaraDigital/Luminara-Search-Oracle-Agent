# Spec 0007: Auth toll-fraud and anti-enumeration

## What

Harden public authentication messaging (password reset, OTP, email verification),
Worker-mediated email/password auth, and sensitive account mutations against
SMS/email pumping, brute-force flooding, and account enumeration.

## Why

Browser-side Firebase Auth calls bypassed Worker rate limits and could leak
account presence via differential errors. Attackers can burn Firebase Auth /
Twilio quota and probe registered addresses.

## Stack (actual)

Cloudflare Workers + KV + Firebase Auth (client SDK + Identity Toolkit REST + JWKS).
Optional Twilio SMS when `OTP_SMS_ENABLED=true`. Optional App Check (reCAPTCHA v3)
when `VITE_FIREBASE_APPCHECK_SITE_KEY` is set.

| Mandate concept | Implementation |
|-----------------|----------------|
| IP-scoped public limits | KV sliding windows for reset / OTP / sign-up / sign-in |
| Burst fail-closed | Isolate burst gate 5 / sec / IP → HTTP 429 |
| Dual-key uid + IP | API key create/revoke, email verification |
| Anti-enumeration | Neutral reset body; collapsed sign-in / sign-up errors; latency floor |
| Outbound killswitch | KV `system_metrics:outbound_daily:{UTC-day}` |
| Credential stuffing | `POST /api/auth/sign-up` and `/sign-in` before client SDK hydrate |
| App Check | Client init when site key present; enforce in Firebase console |

## Routes

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/reset-password` | Public | 3 / 15 min IP + burst + outbound budget |
| POST | `/api/auth/sign-up` | Public | 5 / hour IP; never returns EMAIL_EXISTS |
| POST | `/api/auth/sign-in` | Public | 20 / 15 min IP; collapses not-found / bad password |
| POST | `/api/auth/request-otp` | Public | 5 / hour IP; Twilio when enabled else 501 |
| POST | `/api/auth/verify-otp` | Public | Same IP gate; constant failure on bad code |
| POST | `/api/auth/send-verification` | Session | Dual-key 5 / hour + OTP IP gate |

## What you must configure

1. Worker: `FIREBASE_WEB_API_KEY`, `FIREBASE_PROJECT_ID`, `LUMINARA_KV`
2. Deploy Worker with these routes
3. Optional App Check: create reCAPTCHA v3 in Firebase App Check, set
   `VITE_FIREBASE_APPCHECK_SITE_KEY`, enable enforcement for Authentication
4. Optional SMS: `OTP_SMS_ENABLED=true` + Twilio secrets

## Residual risk

Google popup sign-in still uses the client SDK (App Check attaches when configured).
Without App Check enforcement, attackers can still call Identity Toolkit with the
public web API key and bypass Worker IP limits. Enable enforcement to close that.

## Non-goals

- Cloud Functions v2 / Firestore (not in this stack)
- Changing Firebase console quotas automatically
