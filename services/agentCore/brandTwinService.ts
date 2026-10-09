/**
 * Luminara AEO Brand Twin & Steering Wheel Service
 *
 * Transforms static Business DNA into an active Brand Twin with a Preference Matrix,
 * Delegation Controller, and Human-in-the-Loop (HITL) Distilled Human Judgment.
 */

import type { ContextGraphDecision } from '../contextGraph/contextGraphTypes';

export type BrandTone = 'authoritative' | 'conversational' | 'technical' | 'institutional';
export type RiskTolerance = 'conservative' | 'balanced' | 'progressive';
export type AiSearchEngine = 'chatgpt' | 'perplexity' | 'claude' | 'gemini' | 'google_ai_overview';

export interface PreferenceMatrix {
  brandTone: BrandTone;
  riskTolerance: RiskTolerance;
  priorityEngines: AiSearchEngine[];
  targetCompetitors: string[];
}

export interface DelegationController {
  monitoringCadence: 'daily' | 'weekly' | 'manual';
  autoDraftFixes: boolean;
  requireHumanSignOff: boolean;
  alertThresholdSovDrop: number; // e.g. 10 = trigger alert if SOV drops >= 10%
}

export type SteeringDecision = 'accept' | 'customize' | 'dismiss';

export interface SteeringAction {
  id: string;
  projectId: string;
  findingId: string;
  title: string;
  category: string;
  proposedAction: string;
  evidenceSummary: string;
  status: 'pending' | 'accepted' | 'customized' | 'dismissed';
  humanFeedback?: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface BrandTwinProfile {
  projectId: string;
  domain: string;
  preferences: PreferenceMatrix;
  delegation: DelegationController;
  inbox: SteeringAction[];
  updatedAt: number;
}

const DEFAULT_PREFERENCES: PreferenceMatrix = {
  brandTone: 'authoritative',
  riskTolerance: 'balanced',
  priorityEngines: ['chatgpt', 'perplexity', 'google_ai_overview'],
  targetCompetitors: [],
};

const DEFAULT_DELEGATION: DelegationController = {
  monitoringCadence: 'weekly',
  autoDraftFixes: true,
  requireHumanSignOff: true,
  alertThresholdSovDrop: 10,
};

// In-memory / storage adapter for Brand Twins
const TWIN_STORE = new Map<string, BrandTwinProfile>();

export function getBrandTwin(projectId: string, domain = ''): BrandTwinProfile {
  const existing = TWIN_STORE.get(projectId);
  if (existing) return existing;

  const initial: BrandTwinProfile = {
    projectId,
    domain,
    preferences: { ...DEFAULT_PREFERENCES },
    delegation: { ...DEFAULT_DELEGATION },
    inbox: [],
    updatedAt: Date.now(),
  };
  TWIN_STORE.set(projectId, initial);
  return initial;
}

export function saveBrandTwin(
  projectId: string,
  patch: {
    domain?: string;
    preferences?: Partial<PreferenceMatrix>;
    delegation?: Partial<DelegationController>;
  },
): BrandTwinProfile {
  const twin = getBrandTwin(projectId, patch.domain);
  if (patch.domain) twin.domain = patch.domain;
  if (patch.preferences) {
    twin.preferences = { ...twin.preferences, ...patch.preferences };
  }
  if (patch.delegation) {
    twin.delegation = { ...twin.delegation, ...patch.delegation };
  }
  twin.updatedAt = Date.now();
  TWIN_STORE.set(projectId, twin);
  return twin;
}

export function stageSteeringAction(
  projectId: string,
  action: Omit<SteeringAction, 'id' | 'createdAt' | 'status'>,
): SteeringAction {
  const twin = getBrandTwin(projectId);
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const staged: SteeringAction = {
    ...action,
    id,
    status: 'pending',
    createdAt: Date.now(),
  };
  twin.inbox.push(staged);
  twin.updatedAt = Date.now();
  return staged;
}

export function resolveSteeringAction(
  projectId: string,
  actionId: string,
  decision: SteeringDecision,
  feedback?: string,
): { action: SteeringAction; contextDecision: ContextGraphDecision } {
  const twin = getBrandTwin(projectId);
  const action = twin.inbox.find((a) => a.id === actionId);
  if (!action) {
    throw new Error(`Steering action "${actionId}" not found for project "${projectId}"`);
  }

  action.status = decision === 'accept' ? 'accepted' : decision === 'customize' ? 'customized' : 'dismissed';
  action.humanFeedback = feedback;
  action.resolvedAt = Date.now();
  twin.updatedAt = Date.now();

  const contextDecision: ContextGraphDecision = {
    id: `dhj_${actionId}`,
    category: `brand_twin:${action.category}`,
    scenario: action.title,
    reasoning: feedback || `Human operator chose ${decision} on proposed action: ${action.proposedAction}`,
    outcome: decision,
    confidence: 1.0,
    metadata: {
      projectId,
      findingId: action.findingId,
      brandTone: twin.preferences.brandTone,
      riskTolerance: twin.preferences.riskTolerance,
    },
    createdAt: Date.now(),
  };

  return { action, contextDecision };
}

/**
 * Builds an explicit steering context block for injection into Oracle chat or audit prompts.
 */
export function buildBrandTwinPromptContext(projectId: string): string {
  const twin = getBrandTwin(projectId);
  const resolved = twin.inbox.filter((a) => a.status !== 'pending');
  const accepted = resolved.filter((a) => a.status === 'accepted').map((a) => a.title);
  const dismissed = resolved.filter((a) => a.status === 'dismissed').map((a) => a.title);

  const lines = [
    `[Luminara Brand Twin Profile]`,
    `- Tone: ${twin.preferences.brandTone}`,
    `- Risk Tolerance: ${twin.preferences.riskTolerance}`,
    `- Monitored Search Engines: ${twin.preferences.priorityEngines.join(', ')}`,
  ];

  if (twin.preferences.targetCompetitors.length > 0) {
    lines.push(`- Key Competitors: ${twin.preferences.targetCompetitors.join(', ')}`);
  }

  if (accepted.length > 0) {
    lines.push(`- Operator-Approved Recommendations: ${accepted.slice(-3).join('; ')}`);
  }

  if (dismissed.length > 0) {
    lines.push(`- Operator-Dismissed Patterns (Do Not Propose): ${dismissed.slice(-3).join('; ')}`);
  }

  return lines.join('\n');
}

export function clearBrandTwinStoreForTesting(): void {
  TWIN_STORE.clear();
}
