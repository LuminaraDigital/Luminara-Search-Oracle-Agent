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
  /** Optional Telegram bot token alias used for alert dispatches. */
  TELEGRAM_BOT_TOKEN?: string;
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
  /** Stripe API secret key for card checkouts (sk_live_... / sk_test_...). */
  STRIPE_SECRET_KEY?: string;
  /** Stripe webhook endpoint secret (whsec_...). */
  STRIPE_WEBHOOK_SECRET?: string;
  TON_RECEIVING_ADDRESS?: string;
  TON_API_KEY?: string;
  /**
   * Hard network gate for chain payments and proof anchors: `testnet` | `mainnet`.
   * Must match TON merchant address testnet flag and CHAIN_TON_* / CHAIN_XDC_* hosts.
   */
  CHAIN_NETWORK?: string;
  /** Toncenter Index API base (v3), e.g. https://toncenter.com/api/v3 or testnet equivalent. */
  CHAIN_TON_API_BASE?: string;
  /** TonAPI base for the same network, e.g. https://tonapi.io or https://testnet.tonapi.io. */
  CHAIN_TON_API_FALLBACK_BASE?: string;
  /** XDC JSON-RPC URL (Apothem or mainnet). */
  CHAIN_XDC_RPC_URL?: string;
  /** Merchant XDC receiving address for micro-settlement. */
  XDC_RECEIVING_ADDRESS?: string;
  /** Feature flag: enable live Q402 micro-settlement (`true` / `false`). */
  Q402_LIVE?: string;
  /** Feature flag: enable audit citation anchoring writers (`true` / `false`). */
  PROOF_ANCHOR_ENABLED?: string;
  /** Optional TON CitationRegistry contract address override. */
  TON_CITATION_CONTRACT_ADDRESS?: string;
  /** Secret. TON operations hot wallet private key for on-chain anchoring. */
  TON_MINTER_PRIVATE_KEY?: string;
  /** Feature flag: enable XDC weekly re-check path (`true` / `false`). */
  PROOF_XDC_ENABLED?: string;
  /**
   * Feature flag: SMB Launchpad routes (`true` / `false`). Required in staging and production;
   * routes return 404 without it. Unset in local dev (ENVIRONMENT unset) is on; explicit `false` always disables.
   */
  LAUNCHPAD_ENABLED?: string;
  /** Feature flag: allow mainnet contract registration (`true` / `false`). Off until contract audit + legal sign-off. */
  LAUNCHPAD_MAINNET_ENABLED?: string;
  /** Launchpad RPC endpoints (https). Fall back to public RPCs; set a provider with an SLA in production. */
  LAUNCHPAD_RPC_XDC_TESTNET?: string;
  LAUNCHPAD_RPC_XDC_MAINNET?: string;
  LAUNCHPAD_RPC_POLYGON_TESTNET?: string;
  LAUNCHPAD_RPC_POLYGON_MAINNET?: string;
  /** Testnet-only factory address overrides (mainnet addresses must be committed in services/launchpad/contracts.ts). */
  LAUNCHPAD_FACTORY_XDC_TESTNET?: string;
  LAUNCHPAD_FACTORY_POLYGON_TESTNET?: string;
  /** Testnet-only dev escape hatch: skip the on-chain deployment check at registration (`true`). Ignored on mainnet. */
  LAUNCHPAD_SKIP_CHAIN_VERIFY?: string;
  /**
   * Trust Network (docs/plans/trust-network-additive-plan.md). Flags follow the
   * Launchpad rule: `true` / `false`; unset is on in local dev only.
   */
  TRUST_RECEIPTS_ENABLED?: string;
  DOMAIN_VERIFY_ENABLED?: string;
  /** Secret. Ed25519 private JWK (JSON) that signs Trust Receipts. Generate with `npm run keys:receipt`. */
  RECEIPT_SIGNING_KEY?: string;
  /** JSON array of retired Ed25519 public JWKs still published so old receipts verify. */
  RECEIPT_RETIRED_PUBLIC_KEYS?: string;
  /** DNS-over-HTTPS JSON endpoint for domain verification. Default https://cloudflare-dns.com/dns-query. */
  DOMAIN_VERIFY_DOH_URL?: string;
  /** DataForSEO API login (hosted LLM Mentions / SERP). Pair with DATAFORSEO_PASSWORD. */
  DATAFORSEO_LOGIN?: string;
  DATAFORSEO_PASSWORD?: string;
  /**
   * Budget hard-stop kill-switch: `off` (never halt), `soft` (alerts only),
   * `hard` (policy-driven). Unset defaults to hard. Soft-alert era should set
   * `soft` or leave policies with hard_stop_enabled=0 until invoice validation.
   */
  BUDGET_ENFORCEMENT?: string;
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
  /** Optional Sentry DSN (Worker exceptions). */
  SENTRY_DSN?: string;
  /**
   * Optional Cloudflare Vectorize index for account memory RAG.
   * Provision index then bind in wrangler; code falls back to D1 keyword search.
   */
  MEMORY_VECTORS?: VectorizeIndex;
  /** Optional Workers AI binding for embeddings. */
  AI?: Ai;
  /** Azure AI Search (vector memory). */
  AZURE_AI_SEARCH_ENDPOINT?: string;
  AZURE_AI_SEARCH_KEY?: string;
  AZURE_AI_SEARCH_INDEX?: string;
  /** Google Vertex Vector Search REST endpoint + bearer token. */
  GCP_VERTEX_VECTOR_ENDPOINT?: string;
  GCP_VERTEX_ACCESS_TOKEN?: string;
}

/** Minimal Vectorize binding shape (Cloudflare runtime). */
export interface VectorizeIndex {
  upsert(
    vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>,
  ): Promise<unknown>;
  query(
    vector: number[],
    options: { topK: number; returnMetadata?: string; filter?: Record<string, unknown> },
  ): Promise<{ matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>;
  deleteByIds?(ids: string[]): Promise<unknown>;
}

/** Minimal Workers AI binding. */
export interface Ai {
  run(
    model: string,
    input: {
      messages?: Array<{ role: string; content: string }>;
      prompt?: string;
      stream?: boolean;
      max_tokens?: number;
      temperature?: number;
    } | { text: string[] },
  ): Promise<any>;
}
