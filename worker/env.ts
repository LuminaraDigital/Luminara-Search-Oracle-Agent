/**
 * Cloudflare Worker environment bindings for Luminara Suite.
 */
import type {
  D1Database,
  DurableObjectNamespace,
  Fetcher,
  KVNamespace,
  Queue,
  R2Bucket,
} from '@cloudflare/workers-types';

export interface Env {
  ASSETS: Fetcher;
  LUMINARA_KV?: KVNamespace;
  /** Optional D1 users DB. When unset, profiles fall back to KV `user:{id}`. */
  DB?: D1Database;
  /**
   * Optional R2 bucket for Windows installer mirrors (`windows/latest.exe`, `windows/manifest.json`).
   * When unset or empty, `/desktop/windows` redirects to GitHub Releases.
   */
  DESKTOP_RELEASES?: R2Bucket;
  /** Override GitHub repo slug for desktop download fallback (owner/name). */
  DESKTOP_GITHUB_REPO?: string;
  BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  /**
   * Dedicated secret for admin API routes (/admin/users, /admin/license/generate,
   * /admin/license/seed, /telegram/refund), sent as the x-admin-secret header.
   * Deliberately separate from TELEGRAM_WEBHOOK_SECRET, which must never authorize
   * admin actions. Unset means the admin API fails closed with 503.
   */
  ADMIN_SECRET?: string;
  AUTH_WEBHOOK_SECRET?: string;
  TELEGRAM_ADMIN_ID?: string;
  WEBAPP_URL: string;
  /** "production" | "staging" | unset (local dev). */
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
  /** "true": app use needs a signed-in Telegram or Firebase user (hosted keys and BYOK relays). */
  REQUIRE_TG_AUTH?: string;
  /** "true": hosted provider keys additionally need an active paid plan. */
  REQUIRE_SUBSCRIPTION?: string;
  /** Requests per user per UTC day on hosted keys without a paid plan (0 = unlimited). */
  FREE_DAILY_LIMIT?: string;
  /** Firebase / GCP project id used to verify Auth ID tokens (public; not a secret). */
  FIREBASE_PROJECT_ID?: string;
  /**
   * Numeric Firebase project number (public). Required to verify App Check JWTs
   * (issuer/audience are `projects/{number}`). Same digits as Messaging Sender ID.
   */
  FIREBASE_PROJECT_NUMBER?: string;
  /**
   * When "true", Worker-mediated sign-up / sign-in require a valid App Check JWT
   * (header X-Firebase-AppCheck or body.appCheckToken). Enable only after the
   * client has VITE_FIREBASE_APPCHECK_SITE_KEY and console registration is live.
   */
  REQUIRE_APP_CHECK?: string;
  /**
   * Firebase web API key (same public value as VITE_FIREBASE_API_KEY).
   * Used by the Worker to call Identity Toolkit for password-reset OOB codes
   * behind IP rate limits. Not a secret; still keep it out of commit diffs when rotated.
   */
  FIREBASE_WEB_API_KEY?: string;
  /** Soft daily cap on outbound password-reset / OTP emails (default 200). */
  OUTBOUND_EMAIL_DAILY_LIMIT?: string;
  /**
   * When "true" and Twilio secrets are set, POST /api/auth/request-otp sends SMS.
   * Default off: route stays a rate-limited stub (501 OTP_NOT_ENABLED).
   */
  OTP_SMS_ENABLED?: string;
  /** Twilio Account SID (secret). Required with AUTH token + from-number when OTP SMS is on. */
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  /** E.164 Twilio sender, e.g. +15551234567 */
  TWILIO_FROM_NUMBER?: string;
  GROQ_API_KEY?: string;
  GROQ_API_KEY_FALLBACK?: string;
  NVIDIA_API_KEY?: string;
  NVIDIA_ORG_ID?: string;
  OPENROUTER_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OLLAMA_API_KEY?: string;
  /** Sovereign Ollama endpoint override (e.g. https://my-ollama.internal:11434). Defaults to https://ollama.com */
  OLLAMA_BASE_URL?: string;
  TAVILY_API_KEY?: string;
  FIRECRAWL_API_KEY?: string;
  EXA_API_KEY?: string;
  /** Self-hosted LanguageTool server, e.g. https://writing.example.com (no trailing path). */
  LANGUAGETOOL_URL?: string;
  /** Self-hosted Umami (https://stats.example.com) or Umami Cloud (https://api.umami.is). */
  UMAMI_URL?: string;
  /** Umami API key (secret). Preferred over username/password. */
  UMAMI_API_KEY?: string;
  /** Self-hosted Umami login used to mint a bearer token when no API key is set (secrets). */
  UMAMI_USERNAME?: string;
  UMAMI_PASSWORD?: string;
  TON_RECEIVING_ADDRESS?: string;
  TON_API_KEY?: string;
  /** DataForSEO API login (hosted LLM Mentions / SERP). Pair with DATAFORSEO_PASSWORD. */
  DATAFORSEO_LOGIN?: string;
  DATAFORSEO_PASSWORD?: string;
  /** Feature flags (string "true" / "false"). */
  ORACLE_SERVER_ENABLED?: string;
  /**
   * When "true", Oracle SSE may auto-invoke research_keywords via message regex.
   * Default off: require invokeTool + confirmTool for paid tool side effects.
   */
  ORACLE_AUTO_TOOLS?: string;
  AUDIT_QUEUE_ENABLED?: string;
  /** Google PageSpeed Insights API key (optional hosted). */
  PAGESPEED_API_KEY?: string;
  /** Patchright / local crawler base URL for browse_* MCP tools (optional). */
  PATCHRIGHT_URL?: string;
  /** Shared secret for the crawler sidecar (optional; maps to x-crawler-token). */
  CRAWLER_TOKEN?: string;
  /** Google OAuth for GSC (optional). */
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** MCP OAuth signing secret. Required in production; staging/local may fall back to AUTH_WEBHOOK_SECRET / BOT_TOKEN. */
  MCP_OAUTH_SECRET?: string;
  /**
   * Optional Cloudflare Workers Rate Limiting bindings (edge-local within a colo).
   * Configured via wrangler `ratelimits`. Absent in unit tests / older deploys.
   */
  API_RATE_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
  HIGH_COST_RATE_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
  /** Atomic per-colo backstop for public auth messaging (password reset / OTP). */
  AUTH_MESSAGING_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
  /** Durable Object namespace for Oracle chat sessions. */
  ORACLE_SESSION?: DurableObjectNamespace;
  /** Queue producer for long-running audits. */
  AUDIT_JOBS?: Queue;
}
