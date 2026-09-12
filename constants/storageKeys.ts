/**
 * Single Source of Truth (SSOT) for all localStorage and sessionStorage keys across Luminara Suite.
 */
export const STORAGE_KEYS = {
  // AI Keys
  GEMINI_KEY: 'luminara_api_key',
  GROQ_KEY: 'luminara_groq_key',
  GROQ_FALLBACK_KEY: 'luminara_groq_fallback_key',
  NVIDIA_KEY: 'luminara_nvidia_key',
  NVIDIA_ORG_ID: 'luminara_nvidia_org_id',
  OPENROUTER_KEY: 'luminara_openrouter_key',
  OLLAMA_KEY: 'luminara_ollama_key',
  OLLAMA_ENDPOINT: 'luminara_ollama_endpoint',
  OLLAMA_MODEL: 'luminara_ollama_model',
  FREELLM_KEY: 'luminara_freellm_key',
  FREELLM_BASE_URL: 'luminara_freellm_base_url',
  FREELLM_PREFER: 'luminara_freellm_prefer',

  // Search & Scraping Keys
  TAVILY_KEY: 'luminara_tavily_key',
  EXA_KEY: 'luminara_exa_key',
  LOCAL_SERP_URL: 'luminara_local_serp_url',
  LOCAL_SERP_ENABLED: 'luminara_local_serp_enabled',
  FIRECRAWL_KEY: 'luminara_firecrawl_key',
  BROWSERBASE_KEY: 'luminara_browserbase_key',
  CRAWLER_PROVIDER: 'luminara_crawler_provider',
  SITEWIDE_EVIDENCE: 'luminara_sitewide_evidence',
  SITEWIDE_MAX_PAGES: 'luminara_sitewide_max_pages',
  PATCHRIGHT_URL: 'luminara_patchright_url',
  CRAWLER_PROXY: 'luminara_crawler_proxy',
  CRAWLER_TOKEN: 'luminara_crawler_token',

  // Media & Generative Keys
  FAL_KEY: 'luminara_fal_key',
  TINKER_KEY: 'luminara_tinker_key',

  // Sidecars & Analytics
  LANGUAGETOOL_URL: 'luminara_languagetool_url',
  UMAMI_URL: 'luminara_umami_url',
  UMAMI_API_KEY: 'luminara_umami_api_key',

  // App & UX State
  ADVANCED_UI: 'luminara_advanced_ui',
  BUSINESS_DNA: 'luminara_business_dna',
  CHAT_SESSION: 'luminara_chat_session',
  THEME: 'luminara_theme',

  // Studio & VFS
  STUDIO_DOSSIERS: 'luminara_studio_dossiers',
  STUDIO_ACTIVE_ID: 'luminara_studio_active_id',
  VFS_NODES: 'luminara_vfs_nodes_v2',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
