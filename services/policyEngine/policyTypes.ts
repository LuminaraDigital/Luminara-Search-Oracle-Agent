/**
 * Luminara Policy Engine: Types & Interfaces
 *
 * Defines the declarative 5-stage compliance and guardrail lifecycle:
 * Binding -> Budget & Limits -> PII & Safety -> Search Engine Integrity -> Attestation.
 */

export type PolicyExecutionAction =
  | 'instant_audit'
  | 'oracle_chat'
  | 'schema_patch'
  | 'multi_agent_crawl'
  | 'mcp_tool_execution';

export type PolicyStage = 'binding' | 'budget' | 'safety' | 'search_integrity' | 'execution';

export interface PolicyBindingContext {
  accountId: string;
  sessionToken?: string;
  targetDomain?: string;
  action: PolicyExecutionAction;
  estimatedCostUnits?: number;
  untrustedInput?: string;
  rawSchemaJsonLd?: string;
  maxAuthorizedUnits?: number;
}

export interface PolicyGateDecision {
  allowed: boolean;
  stageFailed?: PolicyStage;
  reason?: string;
  sanitizedInput?: string;
  schemaSafetyScore?: number;
  schemaIssues?: string[];
  maxBoundUnits: number;
  timestamp: number;
}
