# Google Play Console - Sign-In Details (App Access)

Play Console -> **App content -> Sign-in details (App access)**.

---

## 1. Access Model

The Luminara Suite Android app supports three access lanes:
1. **Guest Mode (Zero Sign-In Required)**:
   - The **Instant Audit** tab works out of the box without an account. Reviewers can tap any preset chip (`luminarasuite.com`, `cloudflare.com`, `developer.android.com`) or enter any domain to run a live `/robots.txt`, `/llms.txt`, and `/ai.txt` crawl check and populate the local **Dashboard** action board.
2. **Signed-In Workspace Account**:
   - In **Settings -> Workspace Account**, reviewers can sign in with the dedicated reviewer credentials below to test cloud workspace sync, hosted **Ask Oracle** queries (`3/day` allowance), GDPR JSON export, and account controls.
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
1. Instant Audit and Dashboard work immediately without signing in: tap the "luminarasuite.com" or "cloudflare.com" preset chip on the Instant Audit tab and press "Run Instant Audit".
2. To test signed-in cloud sync and hosted Ask Oracle queries, open the Settings tab and sign in with the credentials above. No 2FA, OTP, location gate, or payment is required.
```
