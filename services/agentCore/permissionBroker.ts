/**
 * Action Permission Broker
 * Adapted from OpenMausBot (server/contracts.ts, server/auto-approve.ts, Apache 2.0).
 *
 * Enforces Luminara's APS Product Invariant:
 * - Free tools: local context, whoami, existing report inspection, Business DNA analysis.
 * - Paid/Risky tools: live SERP sweeps (DataForSEO), deep site crawls (Firecrawl), bulk AI prompt probes.
 * Manages approval state transitions: 'allowed-once', 'rejected', 'answered', 'unavailable'.
 * Integrates directly with TurnWatchdog so human review deliberation never trips stall timeouts.
 * No em dashes in copy.
 */

import type { TurnWatchdog } from './turnWatchdog';

export type RequestOutcome = 'allowed-once' | 'rejected' | 'answered' | 'unavailable';

export type ActionRiskTier = 'free' | 'low_risk' | 'paid_research' | 'destructive';

export interface PendingActionRequest {
  id: string;
  threadId: string;
  agentId: string;
  tool: string;
  argsSummary: string;
  riskTier: ActionRiskTier;
  costEstimateUsd?: number;
  createdAt: number;
  status: 'pending' | 'resolved';
  outcome?: RequestOutcome;
}

export interface ToolApprovalPolicy {
  /** Honor static free/low_risk classifications (default true). */
  autoApproveInherentlySafe: boolean;
  /** Session-level allow-listed tools unlocked via `remember: true` human approval. */
  autoApproveTools: Set<string>;
}

export interface PermissionBrokerOptions {
  watchdog?: TurnWatchdog;
  now?: () => number;
  initialAutoApproveTools?: Iterable<string>;
}

export interface ResolveRequestOptions {
  /**
   * When true on an `allowed-once` approval, adds the tool to `autoApproveTools`
   * and auto-approves any other pending requests for that tool on the same thread
   * (Temporal Harness `ToolApprovalPolicy` remember cascade).
   */
  remember?: boolean;
  reason?: string | null;
}

export class PermissionBroker {
  private readonly pending = new Map<string, PendingActionRequest>();
  private readonly watchdog?: TurnWatchdog;
  private readonly now: () => number;
  private readonly policy: ToolApprovalPolicy;
  private seqCounter = 0;

  constructor(opts: PermissionBrokerOptions = {}) {
    this.watchdog = opts.watchdog;
    this.now = opts.now ?? Date.now;
    this.policy = {
      autoApproveInherentlySafe: true,
      autoApproveTools: new Set(opts.initialAutoApproveTools ?? []),
    };
  }

  /**
   * Determine the risk tier of an action based on tool name and parameters.
   */
  classifyAction(tool: string): ActionRiskTier {
    const paidTools = [
      'dataforseo_research',
      'paid_keyword_probe',
      'deep_firecrawl_crawl',
      'research_keywords',
      'get_domain_overview',
      'get_serp_results',
      'get_backlinks_overview',
      'get_visibility_snapshot',
      'get_pagespeed_summary',
    ];
    const freeTools = [
      'whoami',
      'get_project_context',
      'read_brand_dna',
      'list_findings',
      'read_report',
      'list_projects',
      'list_reports',
      'get_report',
    ];

    if (freeTools.includes(tool)) return 'free';
    if (paidTools.includes(tool)) return 'paid_research';
    if (
      tool.startsWith('delete_') ||
      tool.startsWith('purge_') ||
      tool === 'browse_goal' ||
      tool === 'browse_close'
    ) {
      return 'destructive';
    }
    return 'low_risk';
  }

  /**
   * True when `tool` was previously approved with `remember: true` in this broker policy.
   */
  isToolRemembered(tool: string): boolean {
    return this.policy.autoApproveTools.has(tool);
  }

  getAutoApproveTools(): string[] {
    return [...this.policy.autoApproveTools];
  }

  /**
   * Request permission before executing a tool.
   * Free/low_risk tools or tools allow-listed via `remember: true` are automatically granted.
   * Paid or destructive actions enter 'pending' state and notify the watchdog.
   */
  requestPermission(
    threadId: string,
    agentId: string,
    tool: string,
    argsSummary: string,
    costEstimateUsd?: number
  ): { granted: boolean; requestId?: string; outcome?: RequestOutcome; remembered?: boolean } {
    const tier = this.classifyAction(tool);

    if (this.policy.autoApproveInherentlySafe && (tier === 'free' || tier === 'low_risk')) {
      return { granted: true, outcome: 'allowed-once', remembered: false };
    }

    if (this.policy.autoApproveTools.has(tool)) {
      return { granted: true, outcome: 'allowed-once', remembered: true };
    }

    this.seqCounter++;
    const requestId = `req_${this.now()}_${this.seqCounter}`;
    const request: PendingActionRequest = {
      id: requestId,
      threadId,
      agentId,
      tool,
      argsSummary,
      riskTier: tier,
      costEstimateUsd,
      createdAt: this.now(),
      status: 'pending',
    };

    this.pending.set(requestId, request);

    // Deliberation is human-gated: pause stall watchdog for this thread.
    this.watchdog?.setWaitingOnHuman(threadId, true);

    return {
      granted: false,
      requestId,
    };
  }

  /**
   * Human user or policy engine resolves the pending approval card.
   * When `opts.remember` is true and `outcome === 'allowed-once'`, adds the tool to
   * `autoApproveTools` and cascades approval to other pending calls of that tool on the thread.
   */
  resolveRequest(
    requestId: string,
    outcome: RequestOutcome,
    opts: ResolveRequestOptions = {}
  ): boolean {
    const req = this.pending.get(requestId);
    if (!req || req.status !== 'pending') return false;

    req.status = 'resolved';
    req.outcome = outcome;

    if (opts.remember && outcome === 'allowed-once') {
      this.policy.autoApproveTools.add(req.tool);
      for (const sibling of this.pending.values()) {
        if (
          sibling.threadId === req.threadId &&
          sibling.tool === req.tool &&
          sibling.status === 'pending'
        ) {
          sibling.status = 'resolved';
          sibling.outcome = 'allowed-once';
        }
      }
    }

    // Check if there are other pending requests on this thread.
    const threadStillPending = [...this.pending.values()].some(
      (r) => r.threadId === req.threadId && r.status === 'pending'
    );

    if (!threadStillPending) {
      // Resume active watchdog tracking.
      this.watchdog?.setWaitingOnHuman(req.threadId, false);
    }

    return true;
  }

  getPending(requestId: string): PendingActionRequest | undefined {
    return this.pending.get(requestId);
  }

  listPendingForThread(threadId: string): PendingActionRequest[] {
    return [...this.pending.values()].filter(
      (r) => r.threadId === threadId && r.status === 'pending'
    );
  }

  clearThread(threadId: string): void {
    for (const [id, req] of this.pending.entries()) {
      if (req.threadId === threadId) {
        this.pending.delete(id);
      }
    }
    this.watchdog?.setWaitingOnHuman(threadId, false);
  }
}
