# Desktop distribution: R2 mirror + Authenticode signing

## What works today (no R2 yet)

- `/desktop` download page
- `/desktop/windows` Worker route: redirects to the latest GitHub Release `.exe`
- `/api/desktop/latest` JSON status (reports whether an R2 mirror is active)
- GitHub Actions builds the NSIS installer on `desktop-v*` tags

R2 is **not enabled** on account `2373013c66331e9660e47ffa3ae40f5c` yet (API error 10042). You must finish Cloudflare's R2 checkout once before the CDN mirror can go live.

## Enable R2 (one-time, you must click this)

1. Open [Cloudflare R2 Overview](https://dash.cloudflare.com/2373013c66331e9660e47ffa3ae40f5c/r2/overview) for Info@luminara.digital's Account.
2. Complete **Enable R2** / checkout. A payment method is required even though the free tier covers small installer traffic.
3. Create the bucket:

```bash
npx wrangler r2 bucket create luminara-desktop-releases
```

4. In `wrangler.jsonc`, uncomment the `r2_buckets` block that binds `DESKTOP_RELEASES` to `luminara-desktop-releases`.
5. Deploy:

```bash
npm run deploy
```

6. Re-run the Desktop Windows workflow (or push a new `desktop-v*` tag). The "Mirror installer to Cloudflare R2" step uploads:
   - `windows/latest.exe`
   - `windows/latest.yml`
   - `windows/manifest.json`

After that, `https://luminarasuite.com/desktop/windows` streams from R2 at the edge. GitHub remains the fallback and the feed for `electron-updater`.

## Authenticode (SmartScreen)

Unsigned installers show "Windows protected your PC". For public distribution:

1. Buy an Authenticode code-signing certificate (OV or EV) from a Windows-trusted CA (DigiCert, Sectigo, SSL.com, etc.). EV with hardware token gives reputation faster.
2. Export a `.pfx` (certificate + private key). Keep the export password.
3. Base64-encode the PFX (PowerShell):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\luminara-codesign.pfx")) | Set-Clipboard
```

4. Add GitHub Actions secrets on this repo:
   - `WIN_CSC_LINK` = the base64 PFX string (electron-builder convention)
   - `WIN_CSC_KEY_PASSWORD` = the PFX password
5. Re-run the Desktop Windows workflow. When `WIN_CSC_LINK` is present, the build signs with Authenticode.

Do **not** commit the `.pfx`, password, or base64 blob. Rotate if exposed.

## Domain, TON, multi-user

Desktop still loads `https://luminarasuite.com`, so Firebase, hosted keys, and TON Connect stay on the suite domain. No extra CORS origin is required for the default shell mode.
