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

From a fresh terminal, in the repository. These two commands are the same in bash and in PowerShell, and each one asks for the value at a prompt, so the value never appears on a command line:

```bash
npx wrangler secret put BOT_TOKEN --env staging
```

```bash
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging
```

Paste the staging bot's token for the first. For the second, use a long random value you generate for staging only.

Then set two values in `wrangler.jsonc`, staging `vars`. That is one pull request to `staging`, one line each:

| Variable | Value |
|---|---|
| `TELEGRAM_MINI_APP_URL` | the Worker's own link to the staging bot: the same link as the GitHub variable |
| `FIREBASE_WEB_API_KEY` | the staging Firebase web API key from step 1: the same value as `VITE_FIREBASE_API_KEY`. It is a public value, not a secret. It must not be the production key; a test fails if it is |

Email sign-in and sign-up go through the Worker, and the Worker answers 503 to both while `FIREBASE_WEB_API_KEY` is empty.

## 5. Point the staging bot at the staging Worker

From the same fresh terminal, with the staging values only. `EXPECT_BOT_USERNAME` is the staging bot's username, with or without the `@`. The script makes two checks before it changes anything:

- It asks Telegram which bot the token belongs to, and stops if that is not the bot you named.
- It stops unless the bot and the site belong together. The production bot goes only with `https://luminarasuite.com`. Any other bot goes only with another site. A `WEBAPP_URL` left over from the other environment stops the run.

The token and the webhook secret are read at a prompt, never typed on a command line. The shell saves command lines to a history file, and closing the window does not clear that file.

bash. Each `read` waits without showing what you paste; paste the value and press Enter:

```bash
read -rs BOT_TOKEN && export BOT_TOKEN
```

```bash
read -rs TELEGRAM_WEBHOOK_SECRET && export TELEGRAM_WEBHOOK_SECRET
```

```bash
EXPECT_BOT_USERNAME=<staging bot username> WEBAPP_URL=https://staging.luminarasuite.com/ node scripts/telegram-setup.mjs
```

PowerShell (Windows). An inline `VAR=value command` does not work there; set each value on its own line. `Read-Host` asks for the value, so it is not part of a command line:

```powershell
$env:BOT_TOKEN = Read-Host "Paste the STAGING bot token"
$env:TELEGRAM_WEBHOOK_SECRET = Read-Host "Paste the STAGING webhook secret"
$env:EXPECT_BOT_USERNAME = '<staging bot username>'
$env:WEBAPP_URL = 'https://staging.luminarasuite.com/'
node scripts/telegram-setup.mjs
```

In both shells the values stay set in that window until it is closed. Close the window when you are done.

The script prints `Matched bot: @<username>`, then `About to point @<username> at <site>`, and only then sets the webhook. If either check fails it prints the bot and the site, changes nothing, and exits with an error. It keeps pending updates unless `DROP_PENDING_UPDATES=true` is set.

## 6. Check

- Web: open `https://staging.luminarasuite.com/`, sign in, and confirm the account loads.
- Telegram: open the staging bot, open the Mini App, and confirm it signs you in.
- The three payment drills of SW0a-3 (one real Stars payment, one with the grant forced to fail and refunded, one update delivered twice) can run once both work.

## What not to do

- Do not reuse the production bot token or webhook secret on staging.
- Do not run `scripts/telegram-setup.mjs` with production values in the shell. The script refuses a token that is not the bot you named, and refuses to point the production bot at any site but production, or any other bot at production. It changes the production bot only when `ALLOW_PRODUCTION_WEBHOOK=yes` is also set; the staging steps never need that variable, so do not set it in this terminal.
- Do not put any of these values in a file that is committed.
