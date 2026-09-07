<div align="center">
  <h1>Luminara Suite</h1>
  <p><strong>Open-source AI search visibility: see how your brand shows up in Google, AI Overviews, ChatGPT and Perplexity, then get a plain-English action plan.</strong></p>
  <p>
    <a href="https://luminarasuite.com">luminarasuite.com</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#bring-your-own-keys">Bring your own keys</a> ·
    <a href="#deploy-cloudflare--telegram-mini-app">Deploy</a> ·
    <a href="CONTRIBUTING.md">Contribute</a>
  </p>
  <p>
    <img alt="License AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-B38728">
    <img alt="Runs on Cloudflare" src="https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-F38020">
    <img alt="Telegram Mini App" src="https://img.shields.io/badge/Telegram-Mini%20App-26A5E4">
  </p>
</div>

---

## What it does

Luminara Suite is a web app and Telegram Mini App for **Answer Engine Optimization (AEO)**: the practice of getting your brand cited by AI answers, not just ranked by Google.

- **Instant Audit**: enter a domain, get an SEO / AEO / GEO brief grounded in a live scrape of the site and live search results, with a visibility radar, competitor map, schema gaps and prioritised recommendations.
- **Oracle Agent**: a chat analyst with conversation memory that pulls fresh search evidence when a question needs it and cites its sources.
- **Business DNA**: extract your mission, USP, audience and competitors once; every audit and answer is personalised to it.
- **Plain English mode**: one click rewrites any report at an 8th-grade reading level for non-technical stakeholders.
- **Strategy tools**: red-team stress test, data analyst, thought organiser, grounded market research.
- **Telegram Mini App**: the same product inside Telegram, with Stars payments and TON wallet connect.

It runs on **your own AI account**: Groq, NVIDIA NIM or Ollama (local or cloud), with Gemini as an optional fallback. No Luminara account is needed to self-host.

> **Labs.** OracleMind SLM Studio, the TimesFM forecaster and the Archy harness are demonstrations. Their numbers are simulated and the UI says so. They are kept for exploration, not measurement.

## Quick start

```bash
git clone https://github.com/LuminaraDigital/Luminara-Suite.git
cd Luminara-Suite
npm ci
npm run dev
```

Open http://localhost:3000, click the gear icon, and paste a key from one of:

| Provider | Where to get a key | Notes |
|---|---|---|
| Groq | https://console.groq.com/keys | Fastest. Default model `openai/gpt-oss-120b`. |
| NVIDIA NIM | https://build.nvidia.com/settings/api-keys | NVIDIA's API blocks browsers, so calls are relayed through the Worker with your key (never stored). Needs `npm run cf:dev` or the hosted site. |
| Ollama | Local daemon at `http://127.0.0.1:11434` needs no key. Cloud keys: https://ollama.com/settings/keys | Local runs fully offline. |
| Google Gemini (optional) | https://aistudio.google.com/apikey | Fallback model, Google Search grounding, and Live Voice. |
| Tavily (optional) | https://tavily.com | Live SERP evidence for audits and chat. |
| Firecrawl (optional) | https://firecrawl.dev | Scrapes the audited site for real on-page evidence. |

Keys are stored in your browser only.

## Bring your own keys

Luminara never needs your keys on its servers. In the browser build every provider is called directly from your device. Two exceptions are relayed through the Cloudflare Worker because the vendor blocks browser requests: NVIDIA NIM, and Gemini when you use the hosted key. Relayed requests carry your key in the `x-provider-key` header and the Worker forwards it without storing it.

On luminarasuite.com, hosted keys exist for convenience. They are only used when a request carries a valid Telegram sign-in, are metered per user (25 free requests per day by default), and are unlimited on a paid plan. Nobody can consume the hosted keys anonymously.

## Architecture

```
Browser / Telegram Mini App  (React 19, Vite, Tailwind)
   │  direct calls with your keys ──────────────► Groq · Ollama · Tavily · Firecrawl · Exa
   │
   └─ /api/* ─► Cloudflare Worker (worker/)
                 ├─ /api/providers/:id/*   allow-listed proxy: BYOK relay or metered hosted keys
                 ├─ /api/telegram/auth     validates Mini App initData (HMAC-SHA256)
                 ├─ /api/telegram/invoice  Telegram Stars checkout
                 ├─ /api/telegram/webhook  bot commands, payments → KV
                 └─ static assets          the built app, SPA fallback
```

Key files: [`App.tsx`](App.tsx) (shell and routing), [`services/geminiService.ts`](services/geminiService.ts) (audit and chat pipelines), [`services/aiProviderService.ts`](services/aiProviderService.ts) (Groq / NIM / Ollama with failover), [`services/apiClient.ts`](services/apiClient.ts) (proxy and BYOK relay), [`worker/`](worker/) (Cloudflare Worker), [`services/telegram/tma.ts`](services/telegram/tma.ts) (Telegram bridge).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on :3000 |
| `npm run cf:dev` | Build and run the full Worker on :8787 (copy `.dev.vars.example` to `.dev.vars`) |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | TypeScript, app and worker |
| `npm run build` | Typecheck + production build |
| `npm run deploy` | Build and `wrangler deploy` |
| `npm run tg:setup` | Register webhook, menu button and commands with Telegram |

## Deploy: Cloudflare + Telegram Mini App

One Worker serves everything. Provider keys and the bot token live in Worker secrets only.

```bash
npx wrangler login
npx wrangler kv namespace create LUMINARA_KV      # paste the id into wrangler.jsonc
npx wrangler secret put BOT_TOKEN                 # from @BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any long random string
npx wrangler secret put GROQ_API_KEY              # hosted keys are optional; add the ones you offer
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put FIRECRAWL_API_KEY
npm run deploy
```

Add your domain to Cloudflare first; `wrangler.jsonc` declares `luminarasuite.com` as a custom domain (change it for your own deployment). Then in `@BotFather` run `/newbot`, then `/newapp` with the Web App URL set to your domain, and wire the bot:

```bash
BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... WEBAPP_URL=https://your-domain/ npm run tg:setup
```

Gating is configured in `wrangler.jsonc` vars: `REQUIRE_TG_AUTH` (hosted keys need Telegram sign-in), `FREE_DAILY_LIMIT`, `REQUIRE_SUBSCRIPTION`. Plans and Stars prices are in [`worker/telegramBot.ts`](worker/telegramBot.ts). Telegram's Mini App policy allows TON assets only; the TON Connect manifest is in `public/`.

A static Docker image (no Worker) is also available: `docker build -t luminara-suite .`

## Business model and moat

The code is open. The business is the hosted service and what it accumulates:

- **Plans** (Telegram Stars or card): Starter for 2 sites with monthly AI-visibility re-checks; Growth for 10 sites with weekly tracking and alerts; Agency with white-label reports and client workspaces.
- **Done-for-you**: schema and content fixes shipped by Luminara Digital Agency, priced per finding.
- **The dataset**: weekly, per-vertical records of how AI engines answer commercial queries. Every audit improves with every other customer. That compounds; a prompt does not.

Commercial licensing and trademarks: [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

## Roadmap

1. Real AI-visibility measurement: query ChatGPT, Gemini, Perplexity and Google AI Overviews and record whether the brand is cited.
2. Findings as trackable cards with an evidence drawer, instead of one long report.
3. Weekly re-runs with diffs and alerts.
4. Real technical signals (PageSpeed, rank data) in the audit.
5. Agency workspaces, white-label PDF export, share links.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) (DCO sign-off and the contributor license grant) and [SECURITY.md](SECURITY.md).

## License

[GNU AGPL-3.0](LICENSE) © Luminara Digital Agency. "Luminara", "Luminara Suite", "Oracle Agent" and the logo are trademarks and are not covered by the code license.
