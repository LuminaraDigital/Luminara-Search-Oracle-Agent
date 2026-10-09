/**
 * Universal Resource Tank (ZetaChain Track ZP Pattern 3).
 *
 * Implements gas/resource abstraction for AI search operations.
 * Rather than forcing users to juggle credentials and tokens across 5+ providers
 * (Groq, NVIDIA NIM, Ollama, Tavily, Firecrawl, Gemini), the Resource Tank
 * dynamically evaluates available credentials (BYOK vs hosted vs plans),
 * calculates gas/credit costs, and establishes a seamless execution plan with
 * automatic fallbacks.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { getActiveSubscription } from './quotaMiddleware';
import { planCapsFor } from './telegramBot';

export type SearchProviderKind = 'tavily' | 'local_serp' | 'free_web';
export type ScrapingProviderKind = 'firecrawl' | 'jina' | 'direct';
export type ModelProviderKind = 'groq' | 'nim' | 'ollama' | 'gemini' | 'clef_flash' | 'qwen_edge';

export interface ExecutionResources {
  search: {
    primary: SearchProviderKind;
    fallback: SearchProviderKind;
    isByok: boolean;
  };
  scraping: {
    primary: ScrapingProviderKind;
    fallback: ScrapingProviderKind;
    isByok: boolean;
  };
  model: {
    primary: ModelProviderKind;
    fallback: ModelProviderKind;
    isByok: boolean;
  };
  planId: string;
  hasUnlimitedQuota: boolean;
  estimatedCostCents: number;
}

export interface ResourceResolutionResult {
  ok: boolean;
  resources: ExecutionResources;
  warnings: string[];
  diagnostics: string[];
}

/**
 * Resolves the optimal resource bundle for an incoming task execution.
 */
export async function resolveExecutionResources(
  env: Env,
  user: HostedIdentity | null,
  headers?: Headers,
): Promise<ResourceResolutionResult> {
  const warnings: string[] = [];
  const diagnostics: string[] = [];

  const sub = await getActiveSubscription(env, user);
  const planId = sub?.plan || 'free';
  const caps = planCapsFor(planId);
  const hasUnlimitedQuota = planId !== 'free';

  // 1. Resolve BYOK credentials from headers if provided
  const byokKey = headers?.get('x-provider-key')?.trim() || '';
  const byokProvider = headers?.get('x-byok-provider')?.trim().toLowerCase() || '';

  // 2. Resolve Model Provider
  let modelPrimary: ModelProviderKind = 'groq';
  let modelFallback: ModelProviderKind = 'gemini';
  let modelIsByok = false;

  if (byokKey && byokProvider === 'groq') {
    modelPrimary = 'groq';
    modelIsByok = true;
    diagnostics.push('Model: using caller BYOK Groq credential');
  } else if (env.GROQ_API_KEY || env.GROQ_API_KEY_FALLBACK) {
    modelPrimary = 'groq';
    modelFallback = env.NVIDIA_API_KEY ? 'nim' : 'gemini';
    diagnostics.push('Model: using hosted Groq with fallback to ' + modelFallback);
  } else if (env.NVIDIA_API_KEY) {
    modelPrimary = 'nim';
    modelFallback = 'gemini';
    diagnostics.push('Model: using hosted NVIDIA NIM');
  } else {
    modelPrimary = 'gemini';
    modelFallback = 'gemini';
    warnings.push('Model: using default Gemini fallback');
  }

  // 3. Resolve Search Provider
  let searchPrimary: SearchProviderKind = 'tavily';
  let searchFallback: SearchProviderKind = 'free_web';
  let searchIsByok = false;

  if (byokKey && byokProvider === 'tavily') {
    searchPrimary = 'tavily';
    searchIsByok = true;
    diagnostics.push('Search: using caller BYOK Tavily credential');
  } else if (env.TAVILY_API_KEY) {
    searchPrimary = 'tavily';
    searchFallback = 'free_web';
    diagnostics.push('Search: using hosted Tavily with free_web fallback');
  } else {
    searchPrimary = 'free_web';
    searchFallback = 'free_web';
    warnings.push('Search: hosted Tavily not configured, falling back to free web search');
  }

  // 4. Resolve Scraping Provider
  let scrapingPrimary: ScrapingProviderKind = 'firecrawl';
  let scrapingFallback: ScrapingProviderKind = 'jina';
  let scrapingIsByok = false;

  if (byokKey && byokProvider === 'firecrawl') {
    scrapingPrimary = 'firecrawl';
    scrapingIsByok = true;
    diagnostics.push('Scraping: using caller BYOK Firecrawl credential');
  } else if (env.FIRECRAWL_API_KEY) {
    scrapingPrimary = 'firecrawl';
    scrapingFallback = 'jina';
    diagnostics.push('Scraping: using hosted Firecrawl with Jina fallback');
  } else {
    scrapingPrimary = 'jina';
    scrapingFallback = 'direct';
    diagnostics.push('Scraping: hosted Firecrawl not configured, using Jina reader fallback');
  }

  // Estimated per-task compute cost (in cents, 0 for BYOK or free tiers)
  const estimatedCostCents = hasUnlimitedQuota ? 0 : caps.domainLimit > 2 ? 2 : 1;

  const resources: ExecutionResources = {
    search: {
      primary: searchPrimary,
      fallback: searchFallback,
      isByok: searchIsByok,
    },
    scraping: {
      primary: scrapingPrimary,
      fallback: scrapingFallback,
      isByok: scrapingIsByok,
    },
    model: {
      primary: modelPrimary,
      fallback: modelFallback,
      isByok: modelIsByok,
    },
    planId,
    hasUnlimitedQuota,
    estimatedCostCents,
  };

  return {
    ok: true,
    resources,
    warnings,
    diagnostics,
  };
}
