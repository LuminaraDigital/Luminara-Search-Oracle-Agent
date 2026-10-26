# Luminara Search Oracle Agent - Native Android Implementation Plan

**Date:** 2026-10-26
**Status:** APPROVED for Production & Google Play Console Submission
**Package:** `com.luminarasuite.app`
**Target / Compile / Min SDK:** `targetSdk = 36` · `compileSdk = 37` · `minSdk = 26`

---

## 0. Locked Product & Google Play Policy Decisions

| Decision | Choice | Consequence |
| :--- | :--- | :--- |
| Monetization on Android | **Free companion + BYOK (no in-app purchases)** | Strips Stripe web checkout, Telegram Stars, TON Connect, XDC, and Q402 from the Android binary. Satisfies Google Play Payments & Financial Features policies with zero external payment links. |
| Authentication | **Guest Mode + Firebase Email/Password + BYOK** | Visitors can run live crawl checks (`GET /api/visibility/probe-crawl`) and BYOK audits without signing in. Signed-in users receive hosted daily checks (`3/day`) and cloud workspace sync. |
| Permissions | **`INTERNET` only** | Ultra-lean manifest. Explicitly strips `com.google.android.gms.permission.AD_ID`, `ACCESS_ADSERVICES_AD_ID`, `ACCESS_ADSERVICES_ATTRIBUTION`, and `BIND_GET_INSTALL_REFERRER_SERVICE` via `tools:node="remove"`. |
| Telemetry / Ad SDKs | **Zero third-party ad or crash SDKs** | No Advertising ID, no Firebase Crashlytics/Analytics device IDs collected on Android v1. |
| Honesty Gates (APS) | **Never invent metrics (`not_measured` / `unknown`)** | Unmeasured SEO/AEO/GEO scores remain `null` in DTOs/Room and render explicit `not_measured` badges in UI. Zero em dashes (`U+2014`) in source or copy. |

---

## 1. Architecture & Toolchain

- **Android CLI**: `$env:USERPROFILE\.android\bin\android-cli.exe` (`v1.0.16261425`) for project initialization, SDK management, and artifact description (`android describe`).
- **Gradle & AGP**: Gradle `9.5.0`, AGP `9.3.2`, JDK 17 toolchain (`org.gradle.toolchains.foojay-resolver-convention`).
- **Kotlin & Static Analysis**: Kotlin `2.3.20`, KSP `2.3.11`, Detekt `2.0.0-alpha.6`, Ktlint `14.2.0`.
- **Jetpack Libraries & Dependency Graph**:
  - Compose BOM `2026.08.00` + Material 3 (`Night Foundry` dark theme) + `lifecycle-viewmodel-compose` `2.10.0`
  - Room `3.0.2` (`androidx.room3:room3-runtime`, exported schema in `app/schemas/`)
  - Explicit constructor injection via `LuminaraApplication` (zero reflection/codegen bloat)
  - Retrofit `3.0.0` + OkHttp `5.5.0` + `kotlinx-serialization-json` `1.11.0`
  - DataStore Preferences `1.2.1` + Android Keystore AES-GCM (`CredentialVault` with volatile snapshot cache)
  - Chrome Custom Tabs (`androidx.browser:browser:1.9.0`) for legal/privacy/support links

---

## 2. Package Structure (`apps/android`)

```text
apps/android/app/src/main/kotlin/com/luminarasuite/app/
  core/
    auth/          # CredentialVault (Android Keystore AES-GCM + DataStore for tokens & BYOK keys)
    database/      # Room 3 LuminaraDatabase, entities (AuditHistoryEntity, FindingEntity), LuminaraDao
    designsystem/  # LuminaraTheme, Night Foundry colors, typography (tabular-nums), HonestBadge components
    model/         # Shared domain & kotlinx.serialization API models + EvaluationEngine (llms.txt/bot matrix)
    network/       # LuminaraApi (Retrofit 3), DefaultLuminaraRepository
  feature/
    audit/         # Instant Audit screen + AuditViewModel (live crawl probe, 5 checks, 10-bot matrix, gateway verdict, live recheck)
    ask/           # Ask Oracle screen + AskViewModel (BYOK + hosted Groq/Tavily grounding, verdict + one action, AI report flag)
    dashboard/     # Dashboard screen + DashboardViewModel (offline-first Audit History + Findings Action Board)
    settings/      # Settings screen + SettingsViewModel (Email/Password auth, BYOK keys, GDPR export, Account Deletion)
  LuminaraApplication.kt # Application graph (Room 3 + KeystoreVault + OkHttp/Retrofit + Repository)
  MainActivity.kt        # Edge-to-edge activity + 4-tab NavigationBar workbench
```

---

## 3. Quality & Release Gates

Every phase runs the `/loop` verification pipeline:
1. `./gradlew ktlintCheck detekt lintRelease` (zero formatting, static analysis, or Android Lint errors)
2. `./gradlew test` (unit test suite covering crawler evaluation, honesty gates, repository, and ViewModels)
3. `./gradlew assembleDebug assembleDebugAndroidTest` (proves debug + instrumented test graphs compile)
4. `./gradlew assembleRelease bundleRelease` (R8 minification, resource shrinking, and 4096-bit RSA release signing)
5. `apksigner verify` + `jarsigner -verify -strict` on the produced APK and AAB
6. Root Cloudflare Worker & web gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
