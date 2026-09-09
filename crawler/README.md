# Luminara Stealth Crawler (Powered by Patchright)

The **Luminara Stealth Crawler** is a dedicated, zero-cost web scraping sidecar microservice designed for Luminara Suite. It leverages **Patchright** (an AST-patched Chromium driver over CDP) to evade modern anti-bot systems such as Cloudflare Turnstile, DataDome, and Akamai.

---

## Why Patchright?

Standard automation frameworks (vanilla Puppeteer, standard Playwright, Selenium) leak automation flags over the Chrome DevTools Protocol (`Runtime.enable`, `navigator.webdriver`, timing discrepancies, and CDP object prototypes). Modern anti-bot services detect these instantly.

Patchright performs compile-time AST patching of the driver, stripping these flags at the protocol boundary. This allows Luminara to:
- Audit sites protected by Cloudflare Turnstile or DataDome.
- Extract clean HTML and Markdown without third-party SaaS fees.
- Pass structured evidence directly to Luminara's AI/ML Content Distiller.

---

## Quick Start

### Option A: Docker (Recommended)

Run with Docker Compose from the root directory:
```bash
docker compose -f docker-compose.crawler.yml up -d
```
To start the crawler together with the other self-hosted helpers (Writing check and Results tracking), use the root `docker-compose.yml` instead: `docker compose up -d` (see the main README).

### Option B: Local Node.js

1. Navigate to the crawler directory:
   ```bash
   cd crawler
   npm install
   npx patchright install chromium
   ```
2. Start the runner:
   ```bash
   npm start
   ```
The crawler will listen on `http://localhost:3001`.

---

## API Endpoints

### `GET /health`
Returns service status and engine version:
```json
{
  "ok": true,
  "engine": "patchright",
  "version": "1.50.0",
  "message": "Luminara Patchright Stealth Runner is active",
  "uptimeSec": 42
}
```

### `POST /scrape`
Submits a URL to be scraped:
```json
{
  "url": "https://example.com",
  "waitFor": 1500,
  "timeout": 25000,
  "proxy": "http://user:pass@proxy.example.com:8080"
}
```

Response:
```json
{
  "success": true,
  "url": "https://example.com",
  "statusCode": 200,
  "title": "Example Domain",
  "description": "...",
  "html": "<!DOCTYPE html>...",
  "markdown": "# Example Domain...",
  "latencyMs": 850,
  "antiBotBypassed": true
}
```

---

## Integration with Luminara Suite

In the Luminara web interface:
1. Open **Settings** (gear icon) -> **Web Crawling**.
2. Select **Auto-Resolve** or **Patchright Stealth Runner**.
3. Point the endpoint URL to `http://localhost:3001`.
4. Click **Test Runner** to verify connectivity.
