# Staging sign-in and the staging bot

Staging (`staging.luminarasuite.com`) needs its own Firebase web app and its own Telegram bot. Until both exist, nobody can sign in on staging and no payment can be tested there. These are owner steps: each one creates an account-level thing or sets a secret, and an AI session must not do them for you.

Nothing here touches production. Do every step from a fresh terminal, so no production token is in the shell.

## 1. Firebase: a web app in the staging project

1. Open the Firebase console, project `luminara-suite-staging`. Create it if it does not exist.
2. Add a web app. Copy its config values.
3. Authentication, Settings, Authorized domains: add `staging.luminarasuite.com`.
4. Authentication, Sign-in method: enable the same providers production uses.

## 2. GitHub: variables on the `staging` environment

Repository Settings, Environments, `staging`, Environment variables (variables, not secrets: these values are public web config and ship in the browser bundle).

| Variable | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | from step 1 |
| `VITE_FIREBASE_AUTH_DOMAIN` | from step 1 |
| `VITE_FIREBASE_PROJECT_ID` | `luminara-suite-staging` |
| `VITE_FIREBASE_APP_ID` | from step 1 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | from step 1 (optional) |
| `VITE_FIREBASE_STORAGE_BUCKET` | from step 1 (optional) |
| `VITE_TELEGRAM_MINI_APP_URL` | the staging bot's Mini App link from step 3, for example `https://t.me/<staging bot>/app` |

With none of the four required values set, the staging build shows sign-in as not configured. It never falls back to the production Firebase project, because the staging Worker would refuse those tokens.

## 3. Telegram: a separate staging bot

1. In @BotFather: `/newbot`. Pick a name that says staging. Keep the token out of chat logs and out of this repository.
2. In @BotFather: `/newapp` for that bot, with the web app URL `https://staging.luminarasuite.com/`.
3. Stars need no payment provider to be connected. Stars paid to the staging bot go to the staging bot's balance, not the production bot's.

## 4. Cloudflare: the staging Worker's secrets

From a fresh terminal, in the repository:

```bash
npx wrangler secret put BOT_TOKEN --env staging
```

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging
```

Paste the staging bot's token for the first. For the second, use a long random value you generate for staging only.

Then set the Worker's own link to the staging bot: in `wrangler.jsonc`, staging `vars`, set `TELEGRAM_MINI_APP_URL` to the same link as the GitHub variable. That is a one-line pull request to `staging`.

## 5. Point the staging bot at the staging Worker

From the same fresh terminal, with the staging values only:

```bash
BOT_TOKEN=<staging bot token> TELEGRAM_WEBHOOK_SECRET=<the staging value> WEBAPP_URL=https://staging.luminarasuite.com/ node scripts/telegram-setup.mjs
```

The script prints the bot's username. Check that it is the staging bot before you trust anything else it printed. It keeps pending updates unless `DROP_PENDING_UPDATES=true` is set.

## 6. Check

- Web: open `https://staging.luminarasuite.com/`, sign in, and confirm the account loads.
- Telegram: open the staging bot, open the Mini App, and confirm it signs you in.
- The three payment drills of SW0a-3 (one real Stars payment, one with the grant forced to fail and refunded, one update delivered twice) can run once both work.

## What not to do

- Do not reuse the production bot token or webhook secret on staging.
- Do not run `scripts/telegram-setup.mjs` with a production token in the shell: it resets the production bot's webhook.
- Do not put any of these values in a file that is committed.
