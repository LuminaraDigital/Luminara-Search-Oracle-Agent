# Security Policy

## Reporting a vulnerability

Email **security@luminarasuite.com** with a description, reproduction steps and impact. You will get an acknowledgement within 3 business days. Please give us a reasonable window to fix the issue before disclosing it publicly.

Do not open public GitHub issues for security problems.

## Scope

- The web app and Telegram Mini App at luminarasuite.com
- The Cloudflare Worker in `worker/` (provider proxy, Telegram webhook, init-data validation, Stars payments)
- This repository's build and release tooling

## Design notes for reviewers

- Provider API keys entered by users live in the browser (`localStorage`) by default. They are sent directly to the vendor, or relayed through the Worker with the `x-provider-key` header for vendors that block browser CORS. The Worker never stores *relayed* request keys.
- **Zero-Knowledge Envelope Encryption**: When workspace sync runs, BYOK API credentials are encrypted client-side using WebCrypto `AES-256-GCM` with PBKDF2 key derivation (`services/crypto/envelopeEncryptionService.ts`). The server and Cloudflare D1/KV only ever receive and store ciphertext, IV, and salt (`encryptedKeys`). Plaintext keys are never stored on or transmitted to the server.
- **Enterprise Multi-Tenancy & RBAC**: Multi-tenant organizations enforce strict role-based access control with least-privilege boundaries (`owner`, `admin`, `analyst`, `auditor`, `viewer`).
- **SIEM Audit Logging**: Security-critical actions (authentication, key synchronization, workspace mutations) are recorded to an append-only audit trail with SHA-256 cryptographic hash chaining (`worker/auditLog.ts`), allowing auditors to verify log integrity and detect tampering.
- Hosted keys are Worker secrets. They require a signed-in identity: Telegram Mini App `initData` (HMAC-SHA256, see `worker/telegramAuth.ts`) and/or a verified Firebase ID token (`worker/firebaseAuth.ts`). Hosted use is metered per user in KV.
- Every proxied vendor path is allow-listed (`worker/index.ts`, `PROVIDERS[].allow`). Gemini is further limited to `generateContent` / `streamGenerateContent` / `countTokens`.
- Hosted chat completions clamp `max_tokens` / `max_completion_tokens` (and Gemini `maxOutputTokens`) server-side. Hosted Firecrawl `/crawl` requires an active subscription.
- `/api/enrichment/entity` requires sign-in when `REQUIRE_TG_AUTH` is on.
- Model and scraped-web output is sanitised with DOMPurify before rendering (`utils/markdown.ts`). Scraped and search text is wrapped as untrusted data before it enters model prompts (`utils/untrustedContent.ts`).
- The Telegram webhook requires the `X-Telegram-Bot-Api-Secret-Token` header.

## Supported versions

Only the `main` branch and the latest deployed release receive fixes.
