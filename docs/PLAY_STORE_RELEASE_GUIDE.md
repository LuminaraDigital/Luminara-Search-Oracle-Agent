# Luminara Suite - Google Play Store Release & Deployment Guide

This guide documents the end-to-end process for building, verifying, signing, and deploying the **Luminara Suite** Android application (`com.luminarasuite.app`) to the Google Play Console.

---

## 1. App Identity & Architecture

- **Application ID / Package**: `com.luminarasuite.app`
- **Legal Operator**: `LUMINARA DIGITAL PTY LTD (ABN 90 693 125 281)`
- **Min SDK**: `26` (Android 8.0)
- **Target SDK**: `36` (Android 16 - mandatory Play Console target)
- **Compile SDK**: `37` (JVM Toolchain `17`)
- **Toolchain**: Official Google Android CLI (`android-cli.exe` `v1.0.16261425`), Gradle `9.5.0`, AGP `9.3.2`, Kotlin `2.3.20`, Jetpack Compose (`2026.08.00`), Room `3.0.2`, Retrofit `3.0.0`, OkHttp `5.5.0`, `kotlinx-serialization` `1.11.0`, Detekt `2.0.0-alpha.6`, Ktlint `14.2.0`.
- **Architecture**: Single-activity Night Foundry workbench (`Instant Audit`, `Ask`, `Dashboard`, `Settings`) backed by `https://www.luminarasuite.com/` (Cloudflare Workers + D1), local Room 3 offline cache, and Android Keystore AES-256-GCM credential vault.

---

## 2. Release Signing Configuration

Google Play uses **Play App Signing**. Upload bundles (`.aab`) are signed with the upload keystore (`release.jks`), and Google Play signs delivered APKs with the master app signing key.

### Generating or Verifying the Local Upload Keystore

Run the automated PowerShell helper script:

```powershell
.\apps\android\scripts\generate-release-keystore.ps1
```

This creates:
1. `apps/android/release.jks` (4096-bit RSA key, 10,000-day validity).
2. `apps/android/keystore.properties` (gitignored, auto-discovered by `apps/android/app/build.gradle.kts`).

> [!WARNING]
> Never commit `release.jks` or `keystore.properties` to Git. Both `.gitignore` files (`/.gitignore` and `apps/android/.gitignore`) block `*.jks`, `*.keystore`, and `keystore.properties`.

### Configuring Signing Secrets for GitHub Actions (`.github/workflows/android-release.yml`)

Create a **`release`** environment in GitHub (`Settings -> Environments`) and add four repository secrets:
- `LUMINARA_KEYSTORE_BASE64`: Base64-encoded `release.jks`
- `LUMINARA_KEYSTORE_PASSWORD`: Keystore password
- `LUMINARA_KEY_ALIAS`: `luminarasuite-release`
- `LUMINARA_KEY_PASSWORD`: Key password

---

## 3. Building & Verifying Production Artifacts

Run the automated release readiness script before uploading to Play Console:

```powershell
.\apps\android\scripts\verify-release-readiness.ps1
```

Or run the Gradle tasks directly after sourcing `env.ps1`:

```powershell
. .\apps\android\scripts\env.ps1
cd apps\android
.\gradlew.bat ktlintCheck detekt lintRelease test assembleDebug assembleDebugAndroidTest assembleRelease bundleRelease --no-daemon
```

### Output Locations
- **Google Play App Bundle (`.aab`)**:
  `apps/android/app/build/outputs/bundle/release/app-release.aab`
- **Signed Universal Release APK (`.apk`)**:
  `apps/android/app/build/outputs/apk/release/app-release.apk`

### Android CLI Metadata Verification
Inspect the project build targets and artifact paths using Google's Android CLI:

```powershell
& "$env:USERPROFILE\.android\bin\android-cli.exe" describe --project_dir="apps/android"
```

---

## 4. Google Play Console Compliance Summary

1. **Ultra-Lean Permissions (`INTERNET` only)**:
   - `AndroidManifest.xml` requests only `android.permission.INTERNET`.
   - Transitive advertising and attribution permissions (`com.google.android.gms.permission.AD_ID`, `ACCESS_ADSERVICES_AD_ID`, `ACCESS_ADSERVICES_ATTRIBUTION`, `BIND_GET_INSTALL_REFERRER_SERVICE`) are explicitly stripped via `tools:node="remove"`.
2. **Zero Off-Play Payment or Crypto Rails**:
   - All Stripe Checkout links, Telegram Stars invoices, TON Connect wallets, XDC RPC calls, and Q402 flows are omitted from the Android binary.
   - Users can run Guest live crawl checks, sign in to an existing Luminara account (`3/day` hosted allowance), or configure their own BYOK API keys (`Groq`, `NVIDIA NIM`, `Gemini`, `Tavily`) in Settings.
3. **In-App & Web Account Deletion**:
   - In-app: **Settings -> Privacy, Data Export & Account Deletion -> Permanently Delete Account & Data** (calls `POST https://www.luminarasuite.com/api/privacy/account` with `{"confirm":"DELETE","idToken":"..."}` and wipes local Room 3 + Keystore DataStore).
   - Web URLs for Play Console Data Safety: `https://www.luminarasuite.com/privacy` and `https://www.luminarasuite.com/contact`.
4. **AI-Generated Content Policy**:
   - Every Instant Audit and Ask Oracle screen renders an explicit evidence-bound AI disclosure banner and a per-response **Report AI Output** action button.
5. **APS Honesty Gates**:
   - Unmeasured SEO/AEO/GEO scores remain `null` in DTOs and Room 3 entities and display explicit `NOT_MEASURED` badges in the UI.
