/**
 * Luminara Agent Core: Types
 * 
 * Clean-room, edge-native agent architecture synthesizing:
 * - LangGraph: Cyclic StateGraph and checkpointing
 * - CrewAI: Specialized role-playing agents and autonomous pipelines
 * - AutoGen: Society-of-Mind reflection and adversarial critic gates
 * - Mem0: 4-tier memory hierarchy and semantic delta extraction
 * - Blockchain / TON: Cryptographic Proof-of-Audit attestation & micropayments
 */

import { ReportFocus, BusinessDNA } from '../../types';

// ============================================================================
// 1. Multi-Agent Crew & Roles (CrewAI-inspired)
// ============================================================================

export type AgentRole =
  | 'scout'
  | 'serp_radar'
  | 'playbook_auditor'
  | 'competitor_strategist'
  | 'remediation_architect'
  | 'executive_translator'
  | 'adversarial_critic';

export type AgentStatus = 'idle' | 'running' | 'reflecting' | 'completed' | 'failed';

export interface AgentProfile {
  role: AgentRole;
  name: string;
  avatar: string;
  tagline: string;
  goal: string;
  backstory: string;
  preferredModelRole: 'efficient' | 'capable' | 'advisor';
}

export interface AgentActivityEvent {
  id: string;
  timestamp: number;
  agentRole: AgentRole;
  agentName: string;
  phase: string;
  message: string;
  status: AgentStatus;
  evidenceSnippet?: string;
  confidenceScore?: number;
}

// ============================================================================
// 2. Cyclic StateGraph (LangGraph-inspired)
// ============================================================================

export type StateGraphNodeHandler<TContext> = (
  context: TContext,
  emit: (event: AgentActivityEvent) => void
) => Promise<Partial<TContext>>;

export type StateGraphCondition<TContext> = (
  context: TContext
) => string | Promise<string>;

export interface StateGraphNode<TContext> {
  id: string;
  name: string;
  handler: StateGraphNodeHandler<TContext>;
}

export interface StateGraphCheckpoint<TContext> {
  nodeId: string;
  iteration: number;
  timestamp: number;
  context: TContext;
}

// ============================================================================
// 3. Unified Audit Context & Evidence
// ============================================================================

export interface ScrapedPageEvidence {
  url: string;
  title: string;
  description?: string;
  h1s: string[];
  schemasFound: Array<{ type: string; rawJson: string; isValid: boolean }>;
  wordCount: number;
  loadTimeMs?: number;
  rawTextSnippet: string;
}

export interface SerpEvidenceItem {
  query: string;
  engine: 'google' | 'perplexity' | 'tavily' | 'local_serp';
  title: string;
  url: string;
  snippet: string;
  score?: number;
  aiOverviewText?: string;
  brandMentioned: boolean;
}

export interface AuditFinding {
  id: string;
  category: 'schema' | 'technical' | 'content_quality' | 'eeat' | 'citations' | 'competitor_gap';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  evidenceSource: string;
  howWeKnowItFailed: string;
  leadingIndicator: string;
  /** Critic verification flag */
  criticVerified: boolean;
  criticConfidence: number;
  criticCorrection?: string;
}

export interface CodeRemediationPatch {
  id: string;
  targetType: 'json_ld' | 'meta_tags' | 'robots_txt' | 'llms_txt';
  filename: string;
  originalSnippet?: string;
  proposedSnippet: string;
  explanation: string;
  criticSyntaxValid: boolean;
}

export interface AuditStateGraphContext {
  targetUrl: string;
  focus: ReportFocus;
  dna?: BusinessDNA | null;
  /** Scraped evidence gathered by Scout */
  scrapedPages: ScrapedPageEvidence[];
  /** Search evidence gathered by SERP Radar */
  serpEvidence: SerpEvidenceItem[];
  /** Empirical metrics */
  citationRatePercent: number;
  shareOfVoiceScore: number;
  healthScore: number;
  /** Audit findings evaluated by Playbook Auditor */
  findings: AuditFinding[];
  /** Competitor intelligence */
  topCompetitors: string[];
  competitorGaps: string[];
  /** Remediation patches formulated by Remediation Architect */
  patches: CodeRemediationPatch[];
  /** Executive plain English brief by Executive Translator */
  plainEnglishBrief: string;
  /** Critic validation records */
  criticRejections: number;
  criticPass: boolean;
  /** On-chain Proof-of-Audit attestation (TON) */
  attestation?: AuditAttestation;
  /** Errors encountered */
  errors: string[];
}

// ============================================================================
// 4. Autonomous 4-Tier Memory & Delta Engine (Mem0-inspired)
// ============================================================================

export type MemoryTier =
  | 'user'              // User tone, role, technical literacy level
  | 'session'           // Active session threads, immediate queries
  | 'agent_working'     // Ephemeral scratchpad between crew agents
  | 'domain_entity';    // Brand entity graph, competitor relations, historic scores

export type MemoryAction = 'ADD' | 'UPDATE' | 'DELETE' | 'NOOP';

export interface MemoryFact {
  id: string;
  tier: MemoryTier;
  entityId: string;     // e.g. domain or userId
  key: string;          // e.g. 'competitor:adyen', 'gap:missing_organization_schema'
  value: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  sourceEventId?: string;
}

export interface MemoryDelta {
  action: MemoryAction;
  tier: MemoryTier;
  entityId: string;
  key: string;
  value: string;
  rationale: string;
  confidence: number;
}

// ============================================================================
// 5. Blockchain Proof-of-Audit Attestation (TON Web3)
// ============================================================================

export interface AuditAttestation {
  digestHex: string;          // SHA-256 hex digest of verified audit payload
  domain: string;
  healthScore: number;
  citationRatePercent: number;
  timestamp: number;
  tonMemo: string;            // Standard TON memo payload for on-chain anchoring
  tonTxHash?: string;         // Filled when anchored on TON blockchain
  explorerUrl?: string;       // TonScan or TonViewer URL
  verifiedAt?: number;
}

export interface TonMicroInvoice {
  orderId: string;
  amountNano: string;
  tonAmount: number;
  memo: string;
  recipientAddress: string;
  status: 'pending' | 'confirmed' | 'expired';
}
