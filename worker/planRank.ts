/**
 * Which plan outranks which (Track SW, SW0a-4).
 *
 * A subscription record holds one plan and one expiry, and every purchase replaces the plan and
 * adds to the expiry. So a one-day pass bought by a Growth subscriber used to turn the rest of
 * their Growth time into pass time. The rule here: a purchase may never replace a plan that is
 * still running with a lower one. The same plan again extends it; a higher plan replaces it.
 *
 * The rule is enforced in writeSubscriptionRecord (worker/userStore.ts), which every rail calls,
 * and each rail also refuses before payment where it can, so nobody pays for something that will
 * be refused.
 */

/** The two one-day passes are the lowest rank and equal to each other. */
const RANK: Record<string, number> = {
  single_audit: 1,
  multi_agent_crawl: 1,
  starter: 2,
  growth: 3,
  agency: 4,
};

/** 0 for no plan, the free tier, or a plan id nobody knows. "pro" is the old name for agency. */
export function planRank(planId: unknown): number {
  const id = String(planId ?? '').toLowerCase().trim();
  const known = id === 'pro' ? 'agency' : id;
  return Object.hasOwn(RANK, known) ? RANK[known] : 0;
}

export type SubscriptionLike = { plan?: unknown; expiresAt?: unknown } | null | undefined;

/** True when `existing` is still running and outranks `newPlanId`. */
export function wouldDowngrade(existing: SubscriptionLike, newPlanId: unknown, now: number = Date.now()): boolean {
  if (!existing || typeof existing.expiresAt !== 'number' || existing.expiresAt <= now) return false;
  return planRank(existing.plan) > planRank(newPlanId);
}

/** Thrown by writeSubscriptionRecord instead of writing a lower plan over a running higher one. */
export class PlanDowngradeRefusedError extends Error {
  readonly code = 'PLAN_DOWNGRADE';
  readonly currentPlan: string;
  readonly currentExpiresAt: number;
  readonly requestedPlan: string;

  constructor(currentPlan: string, currentExpiresAt: number, requestedPlan: string) {
    super(`Refused to replace the running plan "${currentPlan}" with the lower plan "${requestedPlan}".`);
    this.name = 'PlanDowngradeRefusedError';
    this.currentPlan = currentPlan;
    this.currentExpiresAt = currentExpiresAt;
    this.requestedPlan = requestedPlan;
  }
}

/** The sentence a buyer reads. `outcome` says what happened to their money or their key. */
export function downgradeRefusalText(input: { currentTitle: string; currentExpiresAt: number; requestedTitle: string; outcome: string }): string {
  return (
    `You already have ${input.currentTitle} until ${new Date(input.currentExpiresAt).toUTCString()}. ` +
    `${input.requestedTitle} is a lower plan and would replace it, ${input.outcome}`
  );
}
