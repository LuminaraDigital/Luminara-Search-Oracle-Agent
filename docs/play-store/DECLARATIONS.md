# Google Play Console - App Content & Policy Declarations

App: **Luminara Suite** (`com.luminarasuite.app`) · Operator: **LUMINARA DIGITAL PTY LTD (ABN 90 693 125 281)**

---

## 1. Required App Content Declarations

| Play Console Section | Declaration Answer | Evidence & Codebase Basis |
| :--- | :--- | :--- |
| **Privacy policy** | `https://www.luminarasuite.com/privacy` | Live privacy policy naming Luminara Digital Pty Ltd, covering collection, AI processing, BYOK encryption, retention, and APP rights. |
| **Ads** | **No, my app does not contain ads** | Zero ad SDKs or ad networks in `apps/android/gradle/libs.versions.toml`. |
| **Advertising ID** | **No** | `com.google.android.gms.permission.AD_ID` and `ACCESS_ADSERVICES_AD_ID` are stripped via `tools:node="remove"` in `AndroidManifest.xml`. |
| **Government apps** | **No** | Commercial B2B search visibility software. |
| **Financial features** | **My app doesn't provide any financial features** | TON Connect, XDC, Stripe Checkout, and Telegram Stars are omitted from the Android binary. |
| **Health apps** | **My app does not provide any health features** | Search engine and AI visibility auditing tool only. |
| **App category** | **Business** (or **Productivity**) | B2B SEO, AEO, and GEO domain auditing workbench. |
| **Contact details** | Email: `support@luminarasuite.com` · Website: `https://www.luminarasuite.com` | Published operator contact channels. |
| **Content rating (IARC)** | Category: **Utility, Productivity, Communication, or Other** · Online content: **Yes** (AI-generated audit outputs) · UGC: **No** | Every AI output includes an in-app **Report AI Output** button (`AskScreen.kt`). |
| **Target audience** | **18 and over only** | Business and website operator tool (`services/legal/privacyCopy.ts`). Outside Google Play Families Policy. |

---

## 2. Data Safety Form Disclosures

- **Does your app collect or share any of the required user data types?** -> **Yes**
- **Is all of the user data collected by your app encrypted in transit?** -> **Yes** (`cleartextTrafficPermitted="false"` in `network_security_config.xml` and `android:usesCleartextTraffic="false"` in `AndroidManifest.xml`).
- **Do you provide a way for users to request that their data is deleted?** -> **Yes**
  - **In-app path**: `Settings -> Privacy, Data Export & Account Deletion -> Permanently Delete Account & Data` (`POST /api/privacy/account`).
  - **Web account deletion URL**: `https://www.luminarasuite.com/privacy` and `https://www.luminarasuite.com/contact`.

| Category | Data Type | Collected | Shared | Required or Optional | Purpose |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Personal info** | Email address | Yes | Yes | Optional (Guest mode works without sign-in; required only if signing in) | App functionality, Account management (Firebase Auth + Cloudflare D1) |
| **Personal info** | User IDs (`firebase_uid`, `accountId`) | Yes | Yes | Optional (Signed-in mode only) | App functionality, Account management, Fraud/abuse prevention |
| **Messages** | Other in-app messages (Oracle prompts & queries) | Yes | Yes | Optional | App functionality (sent to configured AI/search providers: Groq, Tavily, Gemini, NVIDIA NIM) |
| **App activity** | Other user-generated content (audited domains, audit history, findings) | Yes | Yes | Optional | App functionality (stored locally in Room 3 and synced to Cloudflare D1 when signed in) |
| **Device or other IDs** | Device or other IDs | **No** | **No** | N/A | Zero third-party analytics, crash, or advertising SDKs are bundled in `apps/android`. |
| **App info and performance** | Crash logs / Diagnostics | **No** | **No** | N/A | Zero third-party crash reporting SDKs bundled in v1. |
