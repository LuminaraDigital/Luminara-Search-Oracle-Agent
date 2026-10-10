/**
 * Worker-side types for Luminara Dreaming memory consolidation layer.
 */
import type {
  DreamMemoryType,
  DreamMemoryStatus,
  DreamEventType,
  DreamProposalAction,
  DreamProposalStatus,
  DreamTriggerReason,
  DreamEvent,
  BusinessMemoryItem,
  DreamProposal,
  DreamRun,
  DreamWakeGateResult,
} from '../types';

export type {
  DreamMemoryType,
  DreamMemoryStatus,
  DreamEventType,
  DreamProposalAction,
  DreamProposalStatus,
  DreamTriggerReason,
  DreamEvent,
  BusinessMemoryItem,
  DreamProposal,
  DreamRun,
  DreamWakeGateResult,
};

export interface DreamEventRow {
  id: string;
  account_id: string;
  project_id: string | null;
  domain: string;
  event_type: DreamEventType;
  source_id: string | null;
  payload_json: string;
  content_hash: string;
  signal_weight: number;
  dream_run_id: string | null;
  created_at: number;
}

export interface BusinessMemoryRow {
  id: string;
  account_id: string;
  project_id: string | null;
  domain: string;
  memory_type: DreamMemoryType;
  title: string;
  content: string;
  structured_data_json: string;
  confidence: number;
  status: DreamMemoryStatus;
  source_refs_json: string;
  created_at: number;
  updated_at: number;
  last_verified_at: number;
  expires_at: number | null;
}

export interface DreamRunRow {
  id: string;
  account_id: string;
  project_id: string | null;
  domain: string;
  trigger_reason: DreamTriggerReason;
  events_evaluated_count: number;
  proposals_count: number;
  auto_applied_count: number;
  pending_review_count: number;
  rejected_count: number;
  summary: string;
  model_id: string;
  duration_ms: number;
  created_at: number;
  rolled_back_at: number | null;
}

export interface DreamProposalRow {
  id: string;
  dream_run_id: string;
  account_id: string;
  domain: string;
  action: DreamProposalAction;
  memory_id: string | null;
  memory_type: DreamMemoryType;
  title: string;
  proposed_content: string;
  structured_data_json: string;
  confidence: number;
  requires_approval: number;
  status: DreamProposalStatus;
  rationale: string;
  source_refs_json: string;
  previous_snapshot_json: string | null;
  reviewed_by: string | null;
  reviewed_at: number | null;
  created_at: number;
}

export interface DreamAgentOutput {
  runId?: string;
  summary: string;
  proposals: Array<{
    action: DreamProposalAction;
    memoryId?: string;
    memoryType: DreamMemoryType;
    title: string;
    content: string;
    structuredData?: Record<string, unknown>;
    confidence: number;
    sourceRefs: string[];
    requiresApproval?: boolean;
    rationale: string;
  }>;
}
