# Beginner ops: Firebase App Check + Azure (complement)

Luminara’s primary backend stays **Cloudflare Workers**. Azure is optional add-on security/identity. App Check closes Firebase Auth abuse.

Official docs used for App Check steps:
- https://firebase.google.com/docs/app-check/web/recaptcha-provider
- https://firebase.google.com/docs/app-check/enable-enforcement
- https://firebase.google.com/docs/app-check/custom-resource-backend

---

## Part A: Firebase App Check (do this first)

### A0. What you are doing (plain English)

1. Your web app proves “I am the real Luminara site” with reCAPTCHA.
2. Firebase gives the browser an **App Check token**.
3. Firebase Auth (and optionally your Worker) reject callers that lack a valid token.
4. Attackers with only your public web API key can no longer hammer Identity Toolkit freely.

### A1. Create a reCAPTCHA v3 site key

1. Open [Google reCAPTCHA admin](https://www.google.com/recaptcha/admin).
2. Click **+** to create a key.
3. Choose **reCAPTCHA v3**.
4. Add domains:
   - `luminarasuite.com`
   - `www.luminarasuite.com`
   - (optional for staging) `staging.luminarasuite.com`
5. Do **not** add `localhost` as a production domain. Use debug tokens for local (A4).
6. Copy the **site key** (public). You will paste it into Vite env.

### A2. Register App Check in Firebase Console

1. Open [Firebase Console](https://console.firebase.google.com/) → project **luminara-suite**.
2. Go to **Build** or **Security** → **App Check** (sidebar).
3. Open the **Apps** tab.
4. Find your **Web** app → **Register** (or manage provider).
5. Choose **reCAPTCHA v3**.
6. Paste the same site key from A1.
7. Save.

### A3. Put the site key in the client build

Local (`.env`, never commit secrets that are not public; site key is public but keep the file gitignored patterns you already use):

```bash
VITE_FIREBASE_APPCHECK_SITE_KEY=your_recaptcha_v3_site_key
```

Rebuild / redeploy the Worker so the SPA assets include the key (`npm run deploy` or your usual ship path).

The client already calls `ensureAppCheck()` before Auth (`services/auth/firebaseAppCheck.ts`).

### A4. Localhost debug token (required after enforcement)

1. In `.env` for local only:
   ```bash
   VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=true
   ```
2. Run the app locally, open DevTools → Console.
3. Copy the line like `App Check debug token: "xxxxxxxx-...."`.
4. Firebase Console → **App Check** → **Apps** → your web app → **⋮** → **Manage debug tokens**.
5. Register that UUID.
6. Never ship `VITE_FIREBASE_APPCHECK_DEBUG_TOKEN=true` in production builds.

### A5. Monitor before you enforce

1. Firebase Console → **App Check** → **APIs** (or metrics for Authentication).
2. Use the app normally for a day or two (sign-in, Google popup if you use it).
3. Expand **Authentication** metrics.
4. You want mostly **Verified** traffic from the new build.
5. If many **Outdated client** requests remain, wait until users are on the new build.

### A6. Enforce App Check for Authentication (the important click)

1. Firebase Console → **App Check** → product metrics for **Authentication**.
2. Click **Enforce** (or **Set up** → **Enforced** for baseline protection).
3. Confirm.
4. Wait up to **15 minutes** for enforcement to apply.
5. For **Replay protection**: leave **Unenforced (monitoring only)** at first unless you have enabled limited-use tokens in code.

After this, Identity Toolkit calls without a valid App Check token are rejected by Google. That closes the residual bypass around Worker IP limits.

### A7. Optional: require App Check on the Worker too

Code already supports this (off by default):

1. Confirm production client has `VITE_FIREBASE_APPCHECK_SITE_KEY` and users are verified in metrics.
2. Deploy Worker with vars already present:
   - `FIREBASE_PROJECT_NUMBER=274315225068`
   - `REQUIRE_APP_CHECK=false` initially
3. Flip to `"REQUIRE_APP_CHECK": "true"` in `wrangler.jsonc` production vars (or set via dashboard), then `npm run deploy`.
4. Sign-up / sign-in via `/api/auth/*` will then require a valid App Check JWT.

### A8. Smoke test checklist

- [ ] Production sign-in works in a normal browser
- [ ] Local works with registered debug token
- [ ] A raw curl to Identity Toolkit without App Check fails (after A6)
- [ ] Worker `/api/auth/sign-in` without token returns 401 when `REQUIRE_APP_CHECK=true`

---

## Part B: Azure as a complement (beginner plan)

Do **not** rewrite the Cloudflare Worker into Azure Functions. Use Azure for identity and secrets you want under Microsoft tenancy.

### B1. Create an Azure account and subscription

1. Sign up at https://azure.microsoft.com/
2. Create a subscription (Pay-As-You-Go is fine to start).
3. Install Azure CLI: https://learn.microsoft.com/cli/azure/install-azure-cli
4. Login:
   ```bash
   az login
   az account list -o table
   az account set --subscription "<your-subscription-id>"
   ```

### B2. Pick one starter goal (choose only one for week 1)

| Goal | Azure product | Why |
|------|---------------|-----|
| A. Enterprise SSO later | Microsoft Entra ID | Companies sign in with work accounts |
| B. Operator secrets vault | Azure Key Vault | Store ops secrets; rotate without git |
| C. Extra LLM rail | Azure OpenAI / Foundry | Another model provider behind your relay |
| D. SIEM | Microsoft Sentinel | Central security logs |

**Recommended first:** **B (Key Vault)** or **A (Entra)** if you already have enterprise customers asking for SSO. Skip C until BYOK/OpenRouter is boring.

### B3. Week-1 path: Key Vault only (safest beginner)

1. Create a resource group:
   ```bash
   az group create --name luminara-ops --location eastus
   ```
2. Create a Key Vault (purge protection on for production):
   ```bash
   az keyvault create --name luminara-ops-kv --resource-group luminara-ops --location eastus --enable-purge-protection true
   ```
3. Store a secret (example: copy of MCP OAuth signing secret reference, not the live Worker secret itself unless you have a sync process):
   ```bash
   az keyvault secret set --vault-name luminara-ops-kv --name mcp-oauth-secret --value "<generate-with-openssl-rand-hex-32>"
   ```
4. Grant yourself access via RBAC (Key Vault Secrets Officer) in the portal: Key Vault → Access control (IAM).
5. **Still put the live runtime secret into Cloudflare** with:
   ```bash
   npx wrangler secret put MCP_OAUTH_SECRET
   npx wrangler secret put PAGESPEED_API_KEY
   ```
   Key Vault is the **source of truth for operators**; Wrangler secrets are what the Worker reads at runtime.

### B4. Later: Entra ID SSO (only when a customer needs it)

1. Register an app in Entra ID (App registrations).
2. Add redirect URI for your auth callback (design before coding).
3. Prefer OIDC + PKCE; never put client secrets in the Vite bundle.
4. Map Entra users to Firebase custom tokens **or** a dedicated Worker session path (needs a design pass; do not bolt it on casually).

### B5. What not to do

- Do not put a second public API on Azure that duplicates `/api/*` without a single auth story.
- Do not hardcode Azure keys in the React app.
- Do not disable Cloudflare WAF/auth because “Azure is secure now.”

---

## Part C: Operator secrets still needed for full prod surface

Run when you are ready (needs your Google PSI key and a strong random):

```bash
# Generate locally
openssl rand -hex 32

# Cloudflare Worker (production)
npx wrangler secret put MCP_OAUTH_SECRET --env production
npx wrangler secret put PAGESPEED_API_KEY --env production
```

Without `MCP_OAUTH_SECRET`, MCP OAuth minting stays misconfigured (API keys `lm_live_*` still work).
Without `PAGESPEED_API_KEY`, hosted PSI needs BYOK in Settings.

---

## Suggested order for you

1. App Check A1-A6 (console + site key + enforce Authentication).
2. Deploy client with `VITE_FIREBASE_APPCHECK_SITE_KEY`.
3. Put `MCP_OAUTH_SECRET` + optional `PAGESPEED_API_KEY`.
4. After metrics look healthy, set `REQUIRE_APP_CHECK=true` and redeploy Worker.
5. Only then start Azure Key Vault (B3) if you want an ops vault.
