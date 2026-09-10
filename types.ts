
export enum OracleMode {
  FLASH = 'FLASH',
  DEEP_THINK = 'DEEP_THINK'
}

export type ReportFocus = 'SEO' | 'AEO' | 'GEO';

export enum AppView {
  LANDING = 'LANDING',
  ORACLE_AGENT = 'ORACLE_AGENT',
  INSTANT_AUDIT = 'INSTANT_AUDIT',
  DASHBOARD = 'DASHBOARD',
  BUSINESS_DNA = 'BUSINESS_DNA',
  BRAND_MEMORY = 'BRAND_MEMORY',
  STRESS_TEST = 'STRESS_TEST',
  DATA_ANALYST = 'DATA_ANALYST',
  ORGANIZER = 'ORGANIZER',
  RESEARCH = 'RESEARCH',
  VISION = 'VISION',
  INFRASTRUCTURE = 'INFRASTRUCTURE',
  INTELLIGENCE = 'INTELLIGENCE',
  WHY_US = 'WHY_US',
  PRICING = 'PRICING',
  TIMESFM_FORECAST = 'TIMESFM_FORECAST',
  ORACLE_MIND = 'ORACLE_MIND',
  HARNESS = 'HARNESS',
  NOTEBOOK = 'NOTEBOOK',
  PRIVACY = 'PRIVACY',
  TERMS = 'TERMS'
}

/**
 * Views whose numbers are produced by local simulations rather than external models or data.
 * They are shipped as "Labs" and labelled as such in the UI so nobody mistakes them for measurements.
 */
export const LAB_VIEWS: ReadonlySet<AppView> = new Set([AppView.ORACLE_MIND, AppView.TIMESFM_FORECAST, AppView.HARNESS]);

export type TimesFmFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface TimesFmPoint {
  timestamp: number;
  dateStr: string;
  value: number;
  isHoldout?: boolean;
}

export interface TimesFmQuantileForecast {
  timestamp: number;
  dateStr: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface TimesFmCovariate {
  id: string;
  name: string;
  type: 'multiplier' | 'additive' | 'shock';
  value: number;
  active: boolean;
  description: string;
}

export interface TimesFmAnomaly {
  timestamp: number;
  dateStr: string;
  actual: number;
  expected: number;
  lowerBound: number;
  upperBound: number;
  severity: 'high' | 'medium' | 'low';
  type: 'spike' | 'drop';
}

export interface TimesFmMetrics {
  mape: number; // Mean Absolute Percentage Error (%)
  rmse: number; // Root Mean Squared Error
  mae: number;  // Mean Absolute Error
  wql: number;  // Weighted Quantile Loss
  directionalAccuracy: number; // % of direction changes correctly predicted
  volatilityIndex: number;     // Standard deviation of percentage changes
}

export interface TimesFmConfig {
  horizon: number;
  patchLength: number;
  frequency: TimesFmFrequency;
  quantiles: number[];
  decomposition: 'additive' | 'multiplicative';
  revin: boolean;
}

export interface TimesFmForecastResult {
  id: string;
  name: string;
  frequency: TimesFmFrequency;
  config: TimesFmConfig;
  history: TimesFmPoint[];
  forecast: TimesFmQuantileForecast[];
  anomalies: TimesFmAnomaly[];
  metrics: TimesFmMetrics;
  executiveSummary?: string;
  generatedAt: number;
  executionMode: 'edge' | 'neural';
}

export interface BusinessDNA {
  name: string;
  mission: string;
  usp: string; // Unique Selling Proposition
  targetAudience: string;
  competitors: string[];
  perceivedGaps: string[];
  rawContext: string; // Condensed summary for LLM context
  industry?: string;
}

export interface ToolExecution {
  tool?: string;
  args?: any;
  code?: string;
  output: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model' | 'assistant' | 'system';
  content: string;
  /** Optional short label shown instead of `content` (e.g. for "Simplify" follow-ups). */
  displayContent?: string;
  timestamp: number;
  mode?: OracleMode;
  isStreaming?: boolean;
  /** True when this model turn is a failure notice rather than an answer. */
  isError?: boolean;
  groundingUrls?: Array<{ uri: string; title: string }>;
  toolExecutions?: ToolExecution[];
  sources?: any[];
}

export interface SearchGroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
  maps?: {
    uri: string;
    title: string;
  };
}

export interface GroundingMetadata {
  groundingChunks?: SearchGroundingChunk[];
}

export enum OrganizerFormat {
  BUSINESS_PLAN = 'BUSINESS_PLAN',
  MARKETING_BRIEF = 'MARKETING_BRIEF',
  PROJECT_TIMELINE = 'PROJECT_TIMELINE'
}

export interface OrganizerSchema {
  sections: {
    title: string;
    content: string;
  }[];
}

// ---------------------------------------------------------------------------
// OracleMind / Luminara-SLM Foundation Architecture & Training Harness Types
// ---------------------------------------------------------------------------

export type OracleMindPreset = 'nano-26m' | 'pro-64m' | 'moe-100m';

export interface OracleMindConfig {
  id: string;
  name: string;
  hiddenSize: number;
  numLayers: number;
  numHeads: number;
  numKvHeads: number;
  headDim: number;
  intermediateSize: number;
  vocabSize: number;
  maxPositionEmbeddings: number;
  rmsNormEps: number;
  ropeTheta: number;
  useMoe: boolean;
  numExperts: number;
  numExpertsPerTok: number;
  totalParams: string;
  description: string;
}

export interface LoRAAdapter {
  id: string;
  name: string;
  domain: string;
  rank: number;
  alpha: number;
  targetModules: string[];
  description: string;
  active: boolean;
  trainTokens: string;
  specialty: string;
  basePreset: string;
}

export type TrainingStage = 'pretrain' | 'sft' | 'lora' | 'dpo' | 'grpo' | 'distill';

export interface TrainingConfig {
  stage: TrainingStage;
  modelPreset: OracleMindPreset;
  batchSize: number;
  learningRate: number;
  warmupRatio: number;
  epochs: number;
  maxSeqLen: number;
  gradientAccumulationSteps: number;
  weightDecay: number;
  loraRank: number;
  loraAlpha: number;
  dpoBeta: number;
  grpoGroupSize: number;
  grpoBeta: number;
  distillTemperature: number;
}

export interface TrainingTelemetryPoint {
  step: number;
  epoch: number;
  loss: number;
  evalLoss: number;
  learningRate: number;
  tokensPerSec: number;
  gradNorm: number;
  rewardMean?: number;
  accuracy?: number;
}

export interface GenerationParams {
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  repetitionPenalty: number;
  enableReasoning: boolean;
  selectedLoraId: string;
}

export interface ExpertActivation {
  expertId: number;
  expertName: string;
  tokenCount: number;
  percentage: number;
}

export interface GenerationResult {
  text: string;
  thought?: string;
  totalTokens: number;
  timeToFirstTokenMs: number;
  tokensPerSecond: number;
  kvCacheSizeMb: number;
  promptTokens: number;
  completionTokens: number;
  expertActivations: ExpertActivation[];
  adapterUsed: string;
  modelPreset: string;
}

export interface GRPORolloutCandidate {
  id: string;
  reasoning: string;
  response: string;
  schemaReward: number;
  citationReward: number;
  formatReward: number;
  totalReward: number;
  advantage: number;
}

export interface GRPORolloutItem {
  id: string;
  prompt: string;
  candidates: GRPORolloutCandidate[];
  referenceLoss: number;
  policyLoss: number;
  meanReward: number;
}

export interface BenchmarkTestCase {
  id: string;
  category: 'schema_jsonld' | 'aeo_citation' | 'tool_call' | 'plain_english';
  title: string;
  input: string;
  expectedCriteria: string;
  score: number;
  status: 'passed' | 'failed' | 'idle' | 'running';
  actualOutput?: string;
}

export interface DatasetSample {
  id: string;
  type: 'pretrain' | 'sft' | 'dpo' | 'grpo';
  instruction: string;
  input?: string;
  output?: string;
  chosen?: string;
  rejected?: string;
  rewardTarget?: string;
}

// ---------------------------------------------------------------------------
// Luminara Archy: Agentic OS, Developer Harness, & Theming Types
// ---------------------------------------------------------------------------

export type AgentId = 
  | 'oracle' 
  | 'claude' 
  | 'codex' 
  | 'antigravity' 
  | 'hermes' 
  | 'pi' 
  | 'local_slm' 
  | 'openrouter'
  | 'groq'
  | 'nim'
  | 'ollama';

export interface AgentSessionQuota {
  agentId: AgentId;
  planName: string;
  fiveHourLimitTokens: number;
  fiveHourUsedTokens: number;
  fiveHourPct: number;
  weeklyLimitTokens: number;
  weeklyUsedTokens: number;
  weeklyPct: number;
  tokensToday: number;
  tokensPerMin: number;
  prepaidBalance: number; // in USD
  currency: string;
  lastUpdated: number;
}

export interface AgentRunnerConfig {
  id: AgentId;
  name: string;
  vendor: string;
  defaultModel: string;
  supportedModels: string[];
  description: string;
  isDefault: boolean;
  status: 'connected' | 'idle' | 'rate_limited' | 'offline';
  supportsStreaming: boolean;
  supportsTools: boolean;
  cliCommand: string;
  quota: AgentSessionQuota;
}

export interface AgentDispatchTask {
  id: string;
  agentId: AgentId;
  prompt: string;
  mode: 'auto-approve' | 'plan-first' | 'interactive';
  status: 'idle' | 'running' | 'completed' | 'error';
  result?: string;
  thoughtLog?: string[];
  tokensBurned?: number;
  durationMs?: number;
  timestamp: number;
}

export interface HarnessCommandMetadata {
  group: string;
  name: string;
  summary: string;
  args?: string;
  examples?: string[];
  aliases?: string[];
  hidden?: boolean;
  requiresKey?: boolean;
}

export interface HarnessCommand extends HarnessCommandMetadata {
  execute: (args: string[], flags: Record<string, string | boolean>) => Promise<CommandExecutionResult>;
}

export interface HarnessCommandGroup {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface CommandExecutionResult {
  command: string;
  rawInput: string;
  status: 'success' | 'error' | 'info';
  output: string;
  structuredData?: any;
  format: 'text' | 'json' | 'table' | 'diff';
  executionTimeMs: number;
  timestamp: number;
}

export type SkillPlatform = 'antigravity' | 'claude' | 'codex' | 'hermes' | 'pi' | 'generic';

export interface LuminaraSkill {
  id: string;
  name: string;
  title: string;
  description: string;
  category: 'audit' | 'neural' | 'forecast' | 'strategy' | 'triage' | 'graph';
  author: string;
  version: string;
  systemPrompt: string;
  tools: string[];
  examples: Array<{ prompt: string; intent: string }>;
  markdownTemplate: string;
}

export interface TriageReport {
  id: string;
  timestamp: number;
  errorTitle: string;
  source: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  rawTrace: string;
  rootCausePlain: string;
  rootCauseTechnical: string;
  affectedComponents: string[];
  recommendedFix: string;
  codeDiff?: string;
  rollbackAvailable: boolean;
  status: 'open' | 'investigating' | 'resolved';
}

export interface HarnessTestCase {
  id: string;
  suiteId: string;
  name: string;
  description: string;
  status: 'idle' | 'running' | 'passed' | 'failed';
  durationMs: number;
  error?: string;
  logs?: string[];
}

export interface HarnessTestSuite {
  id: string;
  name: string;
  category: 'cli' | 'agents' | 'slm' | 'forecast' | 'aeo' | 'vfs' | 'kg';
  description: string;
  status: 'idle' | 'running' | 'passed' | 'failed';
  testCases: HarnessTestCase[];
  durationMs: number;
}

export interface HarnessTestReport {
  id: string;
  timestamp: number;
  totalSuites: number;
  totalTests: number;
  passed: number;
  failed: number;
  durationMs: number;
  suites: HarnessTestSuite[];
}

export type ThemeId = 'liquid-gold' | 'vantablack' | 'tokyo-night' | 'rose-pine' | 'cyber-emerald';

export interface ThemeColorPalette {
  primaryGold: string;
  goldLight: string;
  goldDark: string;
  goldGradient: string;
  bgDark: string;
  bgObsidian: string;
  bgSurface: string;
  borderGold: string;
  borderMuted: string;
  textPrimary: string;
  textSecondary: string;
  accentGlow: string;
  badgeBg: string;
}

export interface LuminaraTheme {
  id: ThemeId;
  name: string;
  tagline: string;
  previewColors: string[];
  palette: ThemeColorPalette;
}

export interface HarnessReminder {
  id: string;
  label: string;
  minutes: number;
  createdAt: number;
  dueAt: number;
  completed: boolean;
  notified: boolean;
}

// ---------------------------------------------------------------------------
// Luminara Viking: Context Database & Virtual Filesystem (VFS) Types
// Clean-Room Architectural Adaptation of volcengine/OpenViking
// ---------------------------------------------------------------------------

export type VfsNodeType = 'directory' | 'file' | 'memory' | 'resource' | 'skill' | 'session';

export type VfsLayerType = 'L0' | 'L1' | 'L2';

export interface VfsLayerData {
  l0: {
    content: string;
    tokenCount: number;
    keywords: string[];
  };
  l1: {
    content: string;
    tokenCount: number;
    sections: string[];
  };
  l2: {
    content: string;
    tokenCount: number;
    rawFormat: 'markdown' | 'json' | 'text' | 'yaml';
  };
}

export interface VfsNodeMetadata {
  description?: string;
  tags?: string[];
  author?: string;
  sourceUri?: string;
  createdAt: number;
  updatedAt: number;
  sizeBytes: number;
  tokenSavingsPct?: number;
  domainFocus?: 'SEO' | 'AEO' | 'GEO' | 'STRATEGY' | 'MEMORY';
}

export interface VfsNode {
  uri: string;               // e.g. viking://resources/audits/stripe_aeo.json
  name: string;              // e.g. stripe_aeo.json
  type: VfsNodeType;
  parentUri: string | null;
  childrenUris?: string[];
  layers?: VfsLayerData;
  metadata: VfsNodeMetadata;
}

export interface VfsTreeSummary {
  totalNodes: number;
  totalDirectories: number;
  totalFiles: number;
  totalL0Tokens: number;
  totalL1Tokens: number;
  totalL2Tokens: number;
  overallTokenSavingsPct: number;
  namespaces: {
    memories: number;
    resources: number;
    skills: number;
    sessions: number;
  };
}

export type TrajectoryAction = 
  | 'intent_analysis'
  | 'directory_position'
  | 'branch_scoring'
  | 'descend'
  | 'prune'
  | 'layer_resolution'
  | 'context_assembly';

export interface RetrievalTrajectoryStep {
  stepIndex: number;
  action: TrajectoryAction;
  targetUri: string;
  score?: number;
  layerSelected?: VfsLayerType;
  tokensCost?: number;
  rationale: string;
  timestamp: number;
}

export interface VfsMatchedItem {
  node: VfsNode;
  layer: VfsLayerType;
  content: string;
  score: number;
  tokenCount: number;
}

export interface VfsRetrievalResult {
  query: string;
  rootUri: string;
  tokenBudget: number;
  tokensUsed: number;
  tokenSavingsPct: number;
  matchedItems: VfsMatchedItem[];
  assembledContext: string;
  trajectory: RetrievalTrajectoryStep[];
  executionTimeMs: number;
}

export interface VfsRetrievalOptions {
  rootUri?: string;
  tokenBudget?: number;
  minScore?: number;
  preferredLayer?: VfsLayerType;
  includeTrajectory?: boolean;
}

export type VfsMemoryCategory = 
  | 'profiles'
  | 'preferences'
  | 'entities'
  | 'events'
  | 'cases'
  | 'patterns';

export interface VfsMemoryItem {
  id: string;
  category: VfsMemoryCategory;
  uri: string;
  title: string;
  summaryL0: string;
  detailL1: string;
  fullDataL2: string;
  tags: string[];
  relevanceScore: number;
  updatedAt: number;
}

export interface VfsMemorySyncResult {
  syncedCategories: VfsMemoryCategory[];
  itemsCount: number;
  nodesCreated: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Luminara AI Agent Infrastructure Types (Clean-Room Implementation)
// Multi-LLM Provider System, Subagent Delegation, MCP, Workspace Agents
// ---------------------------------------------------------------------------

export type AIProviderType =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'ollama'
  | 'nim'
  | 'openrouter'
  | 'freellm'
  | 'custom';

export type SubAgentRole =
  | 'seo-research'
  | 'aeo-strategy'
  | 'technical-audit'
  | 'content-optimizer'
  | 'link-building';

export type MCPTransport = 'stdio' | 'http' | 'websocket';

export type WorkspaceTemplate =
  | 'python-seo'
  | 'js-rendering'
  | 'ml-training'
  | 'nlp-analysis'
  | 'custom';

export type WorkspaceStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export type GenerateFinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'error';

export type NativeEngineId = 'groq' | 'nim' | 'ollama' | 'openrouter' | 'freellm';

export interface NativeEngineStatus {
  id: NativeEngineId;
  name: string;
  provider: string;
  model: string;
  isAvailable: boolean;
  isLocal: boolean;
  endpoint: string;
  latencyMs: number;
  tokenSpeed: string;
  lastChecked: number;
  error?: string;
  detectedModels?: string[];
}

export interface NativeFailoverEvent {
  failedProvider: string;
  failedModel?: string;
  reason: string;
  activatedProvider: string;
  activatedModel: string;
  latencyMs: number;
  timestamp: number;
}

/**
 * AI Provider configuration and capabilities
 * Supports multiple LLM providers with unified interface
 */
export interface AIProvider {
  id: string;
  name: string;
  type: AIProviderType;
  config: {
    apiKey?: string;
    endpoint?: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  capabilities: {
    streaming: boolean;
    functionCalling: boolean;
    vision: boolean;
    audio: boolean;
    maxContextLength: number;
  };
  isAvailable(): Promise<boolean>;
  generateText(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
  streamText(prompt: string, options?: GenerateOptions): AsyncIterable<StreamChunk>;
  estimateTokens(text: string): number;
}

/**
 * Configuration for specialized subagents that Oracle Agent can delegate to
 */
export interface SubAgentConfig {
  id: string;
  name: string;
  role: SubAgentRole;
  providerId: string;
  tools: string[];
  maxIterations: number;
  temperature: number;
  systemPrompt: string;
  exampleInputsOutputs?: Array<{ input: string; output: string }>;
}

/**
 * Model Context Protocol server configuration for external tool integration
 */
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransport;
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  capabilities: {
    resources: boolean;
    tools: boolean;
    prompts: boolean;
  };
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<MCPTool[]>;
  callTool(toolName: string, args: Record<string, any>): Promise<any>;
}

/**
 * Isolated execution environment for specialized AI tasks
 */
export interface WorkspaceAgent {
  id: string;
  name: string;
  template: WorkspaceTemplate;
  resources: {
    cpuLimit: number;
    memoryLimit: string;
    diskLimit: string;
    timeout: number;
  };
  status: WorkspaceStatus;
  createdAt: number;
  startedAt?: number;
}

/**
 * Options for text generation requests
 */
export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  jsonMode?: boolean;
  /** Prior turns, oldest first. Providers prepend these so the model has conversation memory. */
  history?: ChatTurn[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Result from a text generation request
 */
export interface GenerateResult {
  text: string;
  tokenUsage: { prompt: number; completion: number; total: number };
  finishReason: GenerateFinishReason;
  toolCalls?: ToolCall[];
  latencyMs?: number;
}

/**
 * Streaming chunk from a text generation request
 */
export interface StreamChunk {
  text?: string;
  toolCalls?: ToolCall[];
  finishReason?: GenerateFinishReason;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

/**
 * Tool definition for function calling
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

/**
 * Tool call made by the model
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

/**
 * MCP Resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP Resource content
 */
export interface MCPResourceContent {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

/**
 * SubAgent task execution tracking
 */
export interface SubAgentTask {
  id: string;
  agentId: string;
  prompt: string;
  context: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: any;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

// ---------------------------------------------------------------------------
// Luminara Context Graph (clean-room, browser-first)
// ---------------------------------------------------------------------------

export type ContextGraphNodeType =
  | 'Organization'
  | 'Person'
  | 'Competitor'
  | 'Offering'
  | 'Audience'
  | 'Finding'
  | 'Evidence'
  | 'Decision'
  | 'Keyword'
  | 'Gap'
  | 'Generic';

export type ContextGraphEdgeType =
  | 'offers'
  | 'competes_with'
  | 'targets'
  | 'mentions'
  | 'evidences'
  | 'related_to'
  | 'CAUSED'
  | 'INFLUENCED'
  | 'PRECEDENT_FOR';

export type ContextGraphCausalType = 'CAUSED' | 'INFLUENCED' | 'PRECEDENT_FOR';

export interface ContextGraphProvenance {
  source: string;
  extractor: string;
  confidence: number;
  recordedAt: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ContextGraphNode {
  id: string;
  type: ContextGraphNodeType;
  label: string;
  properties: Record<string, string | number | boolean | string[]>;
  provenance?: ContextGraphProvenance;
  createdAt: number;
  updatedAt: number;
}

export interface ContextGraphEdge {
  id: string;
  fromId: string;
  toId: string;
  edgeType: ContextGraphEdgeType;
  weight?: number;
  properties?: Record<string, string | number | boolean>;
  provenance?: ContextGraphProvenance;
  createdAt: number;
}

export interface ContextGraphDecision {
  id: string;
  category: string;
  scenario: string;
  reasoning: string;
  outcome: string;
  confidence: number;
  metadata?: Record<string, string | number | boolean>;
  createdAt: number;
}

export interface ContextGraphConflict {
  id: string;
  entityId: string;
  field: string;
  values: Array<string | number | boolean>;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  sources: string[];
  message: string;
}

export interface ContextGraphRuleFinding {
  ruleId: string;
  name: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  recommendation: string;
  relatedNodeIds: string[];
}

export interface ContextGraphStats {
  nodeCount: number;
  edgeCount: number;
  decisionCount: number;
  conflictCount: number;
  nodesByType: Record<string, number>;
}

export interface HybridRetrieveHit {
  kind: 'graph' | 'vfs';
  id: string;
  title: string;
  snippet: string;
  score: number;
  meta?: Record<string, string | number>;
}

export interface HybridRetrieveResult {
  query: string;
  hits: HybridRetrieveHit[];
  assembledContext: string;
  executionTimeMs: number;
}

export interface ContextGraphSnapshot {
  version: number;
  nodes: ContextGraphNode[];
  edges: ContextGraphEdge[];
  decisions: ContextGraphDecision[];
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Luminara Switchyard: Dynamic Agentic Workload & Model Routing Types
// Clean-Room Architectural Adaptation of NVIDIA-NeMo/Switchyard
// ---------------------------------------------------------------------------

export type SwitchyardRouteType = 
  | 'stage_router'
  | 'escalation_router'
  | 'llm_classifier'
  | 'advisor_gate'
  | 'subagent_router'
  | 'passthrough';

export type SwitchyardTargetRole = 'efficient' | 'capable' | 'classifier' | 'advisor';

export interface SwitchyardTarget {
  id: string;
  name: string;
  provider: 'groq' | 'nim' | 'gemini' | 'ollama' | 'freellm';
  model: string;
  role: SwitchyardTargetRole;
  tokensPerSec: number;
  costPerMillionTokens: number; // in USD
  latencyBaselineMs: number;
}

export interface SwitchyardRouteConfig {
  id: string;
  name: string;
  type: SwitchyardRouteType;
  description: string;
  efficientTarget: string; // target ID
  capableTarget: string;   // target ID
  advisorTarget?: string;  // target ID
  picker: 'efficient_first' | 'classifier_guided' | 'capable_first';
  confidenceThreshold: number; // 0.0 - 1.0
  maxEscalationRounds: number;
}

export interface SwitchyardDecisionStep {
  stage: string;
  chosenTarget: string;
  reason: string;
  confidence: number;
  timestamp: number;
}

export interface SwitchyardDecisionLog {
  id: string;
  query: string;
  routeType: SwitchyardRouteType;
  initialTarget: string;
  finalTarget: string;
  escalated: boolean;
  steps: SwitchyardDecisionStep[];
  tokensProcessed: number;
  costSavedUsd: number;
  latencySavedMs: number;
  timestamp: number;
  resultSummary?: string;
}

export interface SwitchyardMetrics {
  totalRoutedRequests: number;
  totalTokensRouted: number;
  totalCostSavedUsd: number;
  avgLatencyMs: number;
  escalationRatePct: number;
  targetDistribution: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Luminara Intelligence Studio (Source-Grounded Research & Synthesis Workspace)
// ---------------------------------------------------------------------------

export type NotebookSourceType = 'url' | 'text' | 'file' | 'audit' | 'serp' | 'dna';

export interface NotebookSource {
  id: string;
  title: string;
  type: NotebookSourceType;
  content: string;
  summary?: string;
  url?: string;
  wordCount: number;
  addedAt: number;
  selected: boolean;
  keyEntities?: string[];
}

export interface NotebookCitation {
  sourceId: string;
  sourceTitle: string;
  citationNumber: number;
  quote: string;
  relevanceScore?: number;
}

export interface NotebookMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  citations?: NotebookCitation[];
  pinned?: boolean;
}

export interface AudioOverviewTurn {
  speaker: 'Alex' | 'Sam';
  text: string;
  durationEstimateMs?: number;
}

export interface AudioOverview {
  id: string;
  title: string;
  createdAt: number;
  script: AudioOverviewTurn[];
  summary: string;
  audioDurationSec?: number;
}

export type StudioArtifactType =
  | 'briefing_doc'
  | 'study_guide'
  | 'faq'
  | 'timeline'
  | 'comparison_matrix';

export interface StudioArtifact {
  id: string;
  type: StudioArtifactType;
  title: string;
  content: string;
  createdAt: number;
}

export interface NotebookNote {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  pinned?: boolean;
}

export interface Notebook {
  id: string;
  title: string;
  description?: string;
  sources: NotebookSource[];
  messages: NotebookMessage[];
  audioOverview?: AudioOverview;
  artifacts: StudioArtifact[];
  notes: NotebookNote[];
  createdAt: number;
  updatedAt: number;
}
