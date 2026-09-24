/**
 * Shared tool types for MCP, Oracle tool loop, and audit consumer.
 */
export type McpCreditClass = 'free' | 'paid';

export type MeasurementStatus = 'measured' | 'estimated' | 'not_measured';

export type ToolResult = {
  text: string;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type ToolDefinitionMeta = {
  name: string;
  description: string;
  creditClass: McpCreditClass;
  inputSchema: Record<string, unknown>;
};

/** Minimal project row needed by paid research tools. */
export type ToolProject = {
  id: string;
  domain: string;
  default_location_code?: string | null;
  default_language_code?: string | null;
};

export type ResearchLogEntry = {
  id: string;
  entry_date: string;
  summary: string;
  created_at: number;
};

export type PaidToolRuntime = {
  accountId: string;
  canUsePaid: boolean;
  /** BYOK login:password or null (hosted Agency secrets). */
  dataForSeoCredential: string | null;
  getProject: (projectId: string) => Promise<ToolProject | null>;
  getResearchLog: (projectId: string) => Promise<ResearchLogEntry[]>;
  appendResearchLog: (projectId: string, summary: string) => Promise<void>;
  dfsPost: (path: string, payload: unknown) => Promise<{
    ok: boolean;
    status: number;
    body: unknown;
    error?: string;
    code?: string;
  }>;
  /** Optional Google PageSpeed Insights API key (hosted or BYOK). */
  pagespeedApiKey?: string | null;
  /** Optional OpenRouter chat completion for visibility LLM probes. */
  llmGenerate?: (prompt: string, model?: string) => Promise<string>;
};
