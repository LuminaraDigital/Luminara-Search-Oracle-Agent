# Windows desktop app: production plan

Status: implementing in-repo (not a separate GitHub repository).

## Decision summary

| Choice | Decision | Why |
|--------|----------|-----|
| Separate GitHub repo? | **No** | Same product as web + Telegram. A second repo forks UI/auth/TON and drifts. |
| Stack | **Electron** (Hermes-style shell) | Matches Hermes Agent Desktop: secure main/preload, NSIS Windows installers, electron-updater. |
| What the window loads | **https://luminarasuite.com** by default | Cloudflare deploy updates content for every desktop user without rebuilding the `.exe`. |
| Shell updates | **GitHub Releases** + `electron-updater` | Installer/runtime updates separately from app content. |
| Domain / TON / auth | Unchanged | Desktop is a browser window on the real origin, so Firebase, Telegram Mini App bridges that need web, and TON Connect keep `luminarasuite.com`. |

## Architecture (Hermes-aligned seams)

```
Electron main     owns: window, menu, tray, navigation allowlist, auto-update
Preload bridge    owns: narrow typed IPC (version, openExternal, update events)
Renderer          owns: Luminara Suite UI (hosted on Cloudflare; same as web)
Cloudflare Worker owns: API, auth, metered keys, TON, static assets
```

The desktop client is **not** a second product. It is a native shell around the same Worker-hosted app.

## Modes

1. **Production (default, packaged):** load `WEBAPP_URL` (`https://luminarasuite.com/`).
2. **Dev:** load `http://localhost:3000` after Vite is up (`npm run desktop:dev`).
3. **Offline/local static (optional flag):** load packaged `dist/index.html` with API still hitting production Worker (advanced; not the default).

## One-click Windows deliverable

- `electron-builder` NSIS, `oneClick: true`, per-user install under `%LOCALAPPDATA%`.
- `npm run desktop:dist:win` builds the installer; CI publishes artifacts on `desktop-v*` tags.
- First-run SmartScreen warning is expected until a paid Authenticode certificate is added (`WIN_CSC_*`).

## Multi-user distribution (Cloudflare)

1. Keep serving the app from `luminarasuite.com` (already configured).
2. Publish Windows installers to GitHub Releases (CI).
3. Add `/desktop` on the site linking to the latest release asset.
4. Later optional: mirror installers to R2 + Worker download route for CDN speed and analytics.
5. Keep `tonconnect-manifest.json` and `ALLOWED_ORIGINS` on the suite domain so wallet + API work inside the Electron window.

## Security baseline

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Navigation and `window.open` restricted to allowlisted HTTPS hosts
- External links open in the system browser
- No secrets in the shell; BYOK stays in page storage as on web

## Out of scope for v1

- Code signing certificate purchase
- macOS / Linux installers (structure allows later)
- Separate Electron renderer rewrite of the suite UI
- Nested `apps/desktop` package (forbidden by repo structure rules; shell lives under `electron/` with root `package.json`)
