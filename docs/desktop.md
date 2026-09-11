# Luminara Suite Desktop (Windows)

Native Electron shell for personal and multi-user Windows installs. Same product as [luminarasuite.com](https://luminarasuite.com): the window loads the live Cloudflare deployment by default, so content updates when you deploy the Worker. The installer/runtime updates separately via GitHub Releases.

## Quick start (developers)

```bash
npm ci
npm run desktop:dev
```

This starts Vite on port 3000 and opens Electron against `http://localhost:3000`.

To point the shell at production while developing:

```bash
set LUMINARA_WEBAPP_URL=https://luminarasuite.com/
npx electron .
```

## One-click Windows installer

```bash
npm run desktop:dist:win
```

Output lands in `release/` (NSIS one-click setup). CI builds the same artifact on tags matching `desktop-v*` (example: `desktop-v1.0.0`).

## Architecture

| Layer | Responsibility |
|-------|----------------|
| `electron/main.cjs` | Window, tray, menu, single-instance lock |
| `electron/preload.cjs` | Narrow `window.luminaraDesktop` bridge |
| `electron/security.cjs` | Navigation allowlist |
| Cloudflare Worker | API, auth, TON, static web app |
| GitHub Releases | Shell installer + `electron-updater` feed |

## Why not a separate repo?

A second repository would duplicate auth, TON Connect domain binding, and UI. Keep the shell here so web, Telegram, and desktop stay one codebase.

## Code signing

Unsigned builds trigger Windows SmartScreen ("Windows protected your PC"). Full steps (PFX → `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`) are in [`docs/desktop-distribution.md`](desktop-distribution.md).

## Domain, TON, and multi-user access

Desktop users hit `https://luminarasuite.com`, so:

- Firebase Auth and hosted keys use the existing Worker gates
- `public/tonconnect-manifest.json` remains valid (same origin)
- `ALLOWED_ORIGINS` already includes the suite domain

Download page: `/desktop`. Installer: `/desktop/windows` (R2 when enabled, else GitHub). Status JSON: `/api/desktop/latest`.

R2 enable + mirror checklist: [`docs/desktop-distribution.md`](desktop-distribution.md).
