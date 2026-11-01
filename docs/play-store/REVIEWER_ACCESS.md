# Google Play Console - Sign-In Details (App Access)

Play Console -> **App content -> Sign-in details (App access)**.

---

## 1. Access Model

The Luminara Suite Android app supports three access lanes:
1. **Guest Mode (Zero Sign-In Required)**:
   - The **Instant Audit** tab works out of the box without an account. Reviewers can tap any preset chip (`luminarasuite.com`, `cloudflare.com`, `developer.android.com`) or enter any domain, and they can repeat that. Each run reads live `/robots.txt`, `/llms.txt`, and `/ai.txt` and fills the local **Dashboard**.
   - One **Explain in plain English** read of a finished check is included on the device. It uses the crawl result already on screen. It does not call a hosted model. After that read, Ask, Studio, idea cards, and further explanations ask for sign-in. Uninstalling the app resets the one read. Crawl checks stay available.
2. **Signed-In Workspace Account**:
   - In **Settings -> Workspace**, reviewers sign in with the same Firebase account as luminarasuite.com (email and password, or Google). That unlocks cloud workspace sync, hosted **Ask Oracle** (`3/day` on the free plan), the full audit, GDPR JSON export, and account controls. The plan line says to manage the plan on luminarasuite.com. The app does not open checkout.
3. **BYOK (Bring Your Own Key)**:
   - In **Settings -> BYOK API Key Vault**, users can enter their own `Groq`, `Tavily`, `Gemini`, or `NVIDIA NIM` API keys (encrypted on-device with Android Keystore AES-256-GCM).

---

## 2. Play Console Form Answers

**Is any part of your app restricted?** -> **Yes, some or all functionality is restricted**

| Field | Value |
| :--- | :--- |
| **Instruction name** | `Play Reviewer Account (Full Workspace & Hosted AI Access)` |
| **Username / Email** | `play-reviewer@luminarasuite.com` |
| **Password** | *(Configured in production Firebase Auth & Play Console Reviewer Vault - never committed in plaintext)* |

### "Any other information required to access your app" (392 / 500 chars)

```text
1. Instant Audit and Dashboard work without an account. Tap the luminarasuite.com or cloudflare.com chip and press Run Instant Audit. Repeat that as needed. One plain-English read of a finished check is included, then hosted AI asks you to sign in.
2. For hosted Ask Oracle, the full audit, and cloud sync, open Settings and sign in with the account above. No 2FA, OTP, location gate, or payment. Plans are managed on luminarasuite.com, not in the app.
```
