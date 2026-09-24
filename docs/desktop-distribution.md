# Desktop distribution: R2 mirror + Authenticode signing

## What works today

- `/desktop` download page (shows live version + whether R2 is mirroring)
- `/desktop/windows` Worker route: streams from R2 when `DESKTOP_RELEASES` is bound and `windows/latest.exe` exists; otherwise redirects to GitHub Releases
- `/api/desktop/latest` JSON status (`mirroredOnR2`, version, file name)
- GitHub Actions builds the NSIS installer on `desktop-v*` tags and mirrors to R2
- Bucket: `luminara-desktop-releases` on account `2373013c66331e9660e47ffa3ae40f5c`

## R2 mirror (ops)

Create or refresh the mirror from the latest GitHub desktop release:

```bash
npm run desktop:mirror-r2
# or a specific tag / local build:
node scripts/mirror-desktop-r2.mjs --tag desktop-v1.0.2
node scripts/mirror-desktop-r2.mjs --exe release/Luminara-Suite-Setup-1.0.2.exe
```

Worker binding (already in `wrangler.jsonc` for default + `production`):

```jsonc
"r2_buckets": [
  { "binding": "DESKTOP_RELEASES", "bucket_name": "luminara-desktop-releases" }
]
```

After binding changes: `npm run deploy` (or push `main` for CI). Confirm:

```bash
curl -s https://luminarasuite.com/api/desktop/latest
# expect mirroredOnR2: true
```

## Authenticode (SmartScreen)

Unsigned installers show "Windows protected your PC". This cannot be removed without a purchased certificate. CI already wires electron-builder to secrets when present.

1. Buy an Authenticode code-signing certificate (OV or EV) from a Windows-trusted CA (DigiCert, Sectigo, SSL.com, etc.). EV with hardware token builds reputation faster.
2. Export a `.pfx` (certificate + private key). Keep the export password.
3. Base64-encode the PFX (PowerShell):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\luminara-codesign.pfx")) | Set-Clipboard
```

4. Add GitHub Actions secrets on this repo:
   - `WIN_CSC_LINK` = the base64 PFX string (electron-builder convention)
   - `WIN_CSC_KEY_PASSWORD` = the PFX password
5. Check locally (never prints secret values):

```bash
# In CI these are injected; locally export them first if testing
npm run desktop:check-signing
```

6. Re-run the Desktop Windows workflow (or push a new `desktop-v*` tag). When `WIN_CSC_LINK` is present, the build signs with Authenticode.

### Enforcement gate

The Desktop Windows workflow runs `scripts/check-desktop-signing.mjs` right after the build:

- No `WIN_CSC_LINK` secret: the step prints a warning and the workflow keeps going (today's state).
- `WIN_CSC_LINK` present but the built installer is unsigned: the step runs with `--require`, exits 1, and the release is blocked. No operator action needed: enforcement turns on by itself the moment the certificate secrets are added.

Locally you can preview the gate against a fresh build (`npm run desktop:pack` first, or any `release/Luminara-Suite-Setup-*.exe`):

```bash
node scripts/check-desktop-signing.mjs          # informative, exit 0
node scripts/check-desktop-signing.mjs --require # exit 1 unless the .exe is Authenticode-signed
```

Signature inspection shells out to PowerShell `Get-AuthenticodeSignature`, so `--require` can only verify on Windows (CI runs on `windows-latest`; off-Windows it reports unverifiable and fails the require check).

Do **not** commit the `.pfx`, password, or base64 blob. Rotate if exposed.

## Discoverability (download counts)

GitHub release download counts rise only when people download. Prefer linking users to `https://luminarasuite.com/desktop` (and `/desktop/windows`) rather than raw GitHub asset URLs so traffic stays on the official domain and R2 mirror. Landing already links "Windows app" to `/desktop`.

## Domain, TON, multi-user

Desktop still loads `https://luminarasuite.com`, so Firebase, hosted keys, and TON Connect stay on the suite domain. No extra CORS origin is required for the default shell mode.
