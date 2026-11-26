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

const DAY_MS = 86_400_000;

/** Hard cap on subscription expiry: 2 years from now so stacking never overflows or builds multi-decade entitlements. */
export const MAX_SUBSCRIPTION_DAYS = 730;
export const MAX_SUBSCRIPTION_MS = MAX_SUBSCRIPTION_DAYS * DAY_MS;

/**
 * Canonical 30-day plan values in AUD cents, aligned with STRIPE_PLAN_CONFIG (7900 / 22900 / 54900)
 * and scaled proportionally for 24-hour passes (PLANS.*.stars: 25/2500*30 = 0.30x, 75/2500*30 = 0.90x of Starter).
 */
export const PLAN_MONTHLY_PRICE_CENTS: Record<string, number> = {
  single_audit: 2370,
  multi_agent_crawl: 7110,
  starter: 7900,
  growth: 22900,
  agency: 54900,
};

function canonicalPlanKey(planId: unknown): string {
  const id = String(planId ?? '').toLowerCase().trim();
  return id === 'pro' ? 'agency' : id;
}

/** 0 for no plan, the free tier, or a plan id nobody knows. "pro" is the old name for agency. */
export function planRank(planId: unknown): number {
  const known = canonicalPlanKey(planId);
  return Object.hasOwn(RANK, known) ? RANK[known] : 0;
}

/** Canonical 30-day plan price in AUD cents (0 for free or unknown plans). */
export function planMonthlyPriceCents(planId: unknown): number {
  const known = canonicalPlanKey(planId);
  return Object.hasOwn(PLAN_MONTHLY_PRICE_CENTS, known) ? PLAN_MONTHLY_PRICE_CENTS[known] : 0;
}

export type SubscriptionLike = { plan?: unknown; expiresAt?: unknown } | null | undefined;

/**
 * Canonical subscription expiry calculation shared by all grant rails (Stripe, TON, Stars, License keys):
 * - Expired, free, or absent existing plan: start from `now`.
 * - Same-tier renewal: extend 1:1 from existing expiry.
 * - Cross-tier upgrade: prorate remaining time by canonical price ratio (`oldPrice / newPrice`)
 *   so cheap lower-tier days never convert 1:1 into higher-tier days.
 * - Always hard-capped at `now + MAX_SUBSCRIPTION_MS` (730 days / 2 years).
 */
export function computeSubscriptionExpiry(
  existing: SubscriptionLike,
  newPlanId: string,
  addedDays: number,
  now: number = Date.now(),
): number {
  const safeNow = Number.isFinite(now) && now >= 0 ? now : Date.now();
  const safeDays = Number.isFinite(addedDays) && addedDays > 0 ? addedDays : 0;
  const addedMs = Math.floor(safeDays * DAY_MS);
  const cap = safeNow + MAX_SUBSCRIPTION_MS;

  const existingExpires = Number(existing?.expiresAt);
  const isActive = Boolean(existing && Number.isFinite(existingExpires) && existingExpires > safeNow);
  const existingRank = isActive ? planRank(existing?.plan) : 0;
  const newRank = planRank(newPlanId);

  let base = safeNow;
  if (isActive && existingRank > 0) {
    const remainingMs = Math.min(existingExpires - safeNow, MAX_SUBSCRIPTION_MS);
    if (existingRank === newRank) {
      base = safeNow + remainingMs;
    } else if (newRank > existingRank) {
      const oldPrice = planMonthlyPriceCents(existing?.plan);
      const newPrice = planMonthlyPriceCents(newPlanId);
      const ratio = oldPrice > 0 && newPrice > 0 ? Math.min(1, oldPrice / newPrice) : 0;
      base = safeNow + Math.floor(remainingMs * ratio);
    }
  }

  return Math.min(base + addedMs, cap);
}

/**
 * When a lower-tier purchase is refunded after the account upgraded to a higher tier,
 * scale the subtracted duration by `oldPrice / newPrice` rounded up (Math.ceil) so the refund
 * reclaims at least every millisecond contributed by the lower-tier purchase without stealing higher-tier days.
 */
export function proratedRefundDurationMs(durationMs: number, refundedPlanId: unknown, currentPlanId: unknown): number {
  const safeMs = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  if (safeMs === 0) return 0;
  const refundedRank = planRank(refundedPlanId);
  const currentRank = planRank(currentPlanId);
  if (refundedRank <= 0 || currentRank <= refundedRank) return safeMs;
  const oldPrice = planMonthlyPriceCents(refundedPlanId);
  const newPrice = planMonthlyPriceCents(currentPlanId);
  if (oldPrice <= 0 || newPrice <= 0) return safeMs;
  return Math.ceil(safeMs * Math.min(1, oldPrice / newPrice));
}

/** True when `existing` is still running and outranks `newPlanId`. */
export function wouldDowngrade(existing: SubscriptionLike, newPlanId: unknown, now: number = Date.now()): boolean {
  if (!existing) return false;
  // The readers of a subscription coerce its expiry, so a record that stores it as text is
  // running for them. It has to be running here too, or it would not be protected.
  const expiresAt = Number(existing.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
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
