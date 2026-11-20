# Search Console connect (owner setup)

The Worker route is off in every checked-in environment (`GSC_OAUTH_ENABLED` is `false`). Leave it off until Google has verified the app for the read-only scope. The route requests and stores only `https://www.googleapis.com/auth/webmasters.readonly`. It does not request a write scope, and it does not call the Search Console API yet.

Redirect URIs, from `WEBAPP_URL` in `wrangler.jsonc`:

- Production: `https://www.luminarasuite.com/api/gsc/callback`
- Staging: `https://staging.luminarasuite.com/api/gsc/callback`

## Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) and choose the project that should own this OAuth client.
2. APIs and Services, Library: enable **Google Search Console API**.
3. APIs and Services, OAuth consent screen: External. Set the app name, support email, and developer contact. Add the privacy policy and homepage on the domain you verify with Google.
4. Add one scope: `https://www.googleapis.com/auth/webmasters.readonly`. Do not add `https://www.googleapis.com/auth/webmasters` or any other scope.
5. That scope is sensitive. While the app is in testing, add the Google accounts that should connect. Before anyone outside that list can connect, submit the consent screen for verification. Google asks for a justification of the read-only use and a way to see the feature. This repository cannot submit that for you.
6. APIs and Services, Credentials: Create OAuth client ID, Web application. Add the redirect URI for the environment you are configuring. Create a separate client for staging and production if they use different URIs.

## Worker secrets

Set these with `wrangler secret put`. Do not commit the values. This repo does not contain them.

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GSC_TOKEN_KEY` (a long random string, for example the output of `openssl rand -base64 32`). It encrypts the refresh token in D1. Changing it makes stored connections unreadable, and the account has to connect again.

`LUMINARA_KV` is already a Worker binding. The sign-in state lives there for ten minutes.

Turn the flag on only after the secrets exist and you accept the verification state of the consent screen. Set `GSC_OAUTH_ENABLED` to `true` in the environment you are testing, not in the production block of `wrangler.jsonc`, until Google has approved the scope. The preprod flag test fails if the production block turns it on.

## Weekly email

The weekly visibility email uses the same Resend secret as welcome mail: `RESEND_API_KEY`. The from address is `Luminara Suite <hello@luminarasuite.com>`. If welcome mail already arrives, no new DNS is required. If it does not, verify the domain in Resend and publish the SPF and DKIM records Resend shows for `luminarasuite.com`. Those record values are not stored in this repo.

The Google Business Profile API is not called. Connecting it needs a separate Google approval and is not part of this setup.
