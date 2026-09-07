# Security Policy

## Reporting a vulnerability

Email **security@luminarasuite.com** with a description, reproduction steps and impact. You will get an acknowledgement within 3 business days. Please give us a reasonable window to fix the issue before disclosing it publicly.

Do not open public GitHub issues for security problems.

## Scope

- The web app and Telegram Mini App at luminarasuite.com
- The Cloudflare Worker in `worker/` (provider proxy, Telegram webhook, init-data validation, Stars payments)
- This repository's build and release tooling

## Design notes for reviewers

- Provider API keys entered by users live only in their browser (`localStorage`). They are sent directly to the vendor, or relayed through the Worker with the `x-provider-key` header for vendors that block browser CORS. The Worker never stores relayed keys.
- Hosted keys are Worker secrets. They are only used for requests carrying a valid Telegram `initData` signature (HMAC-SHA256, see `worker/telegramAuth.ts`) and are metered per user in KV.
- Every proxied vendor path is allow-listed (`worker/index.ts`, `PROVIDERS[].allow`).
- Model and scraped-web output is sanitised with DOMPurify before rendering (`utils/markdown.ts`).
- The Telegram webhook requires the `X-Telegram-Bot-Api-Secret-Token` header.

## Supported versions

Only the `main` branch and the latest deployed release receive fixes.
