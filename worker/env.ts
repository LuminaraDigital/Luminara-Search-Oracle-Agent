/**
 * Cloudflare Worker environment bindings for Luminara Suite.
 */
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
  TELEGRAM_ADMIN_ID?: string;
  WEBAPP_URL: string;
  ALLOWED_ORIGINS?: string;
  /** "true": app use needs a signed-in Telegram or Firebase user (hosted keys and BYOK relays). */
  REQUIRE_TG_AUTH?: string;
  /** "true": hosted provider keys additionally need an active paid plan. */
  REQUIRE_SUBSCRIPTION?: string;
  /** Requests per user per UTC day on hosted keys without a paid plan (0 = unlimited). */
  FREE_DAILY_LIMIT?: string;
  /** Firebase / GCP project id used to verify Auth ID tokens (public; not a secret). */
  FIREBASE_PROJECT_ID?: string;
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
}
