/**
 * Shared plan entitlements for paywall, Sentinel caps, and agency features.
 * Keep Worker PLANS / TON_PRICING descriptions in sync with domainLimits here.
 */

export type PlanId = 'free' | 'starter' | 'growth' | 'agency';

export interface PlanEntitlements {
  id: PlanId;
  title: string;
  domainLimit: number;
  sentinelLimit: number;
  auditHistoryDepth: number; // 0 = unlimited
  agencyClientLimit: number;
  competitorWatchLimit: number;
  scheduledReaudit: 'none' | 'monthly' | 'weekly' | 'daily';
  apiAccess: boolean;
  whiteLabelPdf: boolean;
  teamSeats: number;
}

export const PLAN_ENTITLEMENTS: Record<PlanId, PlanEntitlements> = {
  free: {
    id: 'free',
    title: 'Free',
    domainLimit: 1,
    sentinelLimit: 0,
    auditHistoryDepth: 5,
    agencyClientLimit: 0,
    competitorWatchLimit: 3,
    scheduledReaudit: 'none',
    apiAccess: false,
    whiteLabelPdf: false,
    teamSeats: 1,
  },
  starter: {
    id: 'starter',
    title: 'Starter',
    domainLimit: 2,
    sentinelLimit: 2,
    auditHistoryDepth: 30,
    agencyClientLimit: 0,
    competitorWatchLimit: 10,
    scheduledReaudit: 'monthly',
    apiAccess: false,
    whiteLabelPdf: true,
    teamSeats: 1,
  },
  growth: {
    id: 'growth',
    title: 'Growth',
    domainLimit: 10,
    sentinelLimit: 10,
    auditHistoryDepth: 90,
    agencyClientLimit: 0,
    competitorWatchLimit: 25,
    scheduledReaudit: 'weekly',
    apiAccess: false,
    whiteLabelPdf: true,
    teamSeats: 3,
  },
  agency: {
    id: 'agency',
    title: 'Pro / Agency',
    domainLimit: 25,
    sentinelLimit: 25,
    auditHistoryDepth: 0,
    agencyClientLimit: 10,
    competitorWatchLimit: 100,
    scheduledReaudit: 'daily',
    apiAccess: true,
    whiteLabelPdf: true,
    teamSeats: 10,
  },
};

/** Paid plan ids accepted by Stars / TON checkout. */
export const PAID_PLAN_IDS: PlanId[] = ['starter', 'growth', 'agency'];

export function normalizePlanId(raw: string | null | undefined): PlanId {
  const id = String(raw || 'free').toLowerCase();
  if (id === 'starter' || id === 'growth' || id === 'agency') return id;
  if (id === 'pro') return 'agency';
  return 'free';
}

export function entitlementsFor(plan: string | null | undefined): PlanEntitlements {
  return PLAN_ENTITLEMENTS[normalizePlanId(plan)];
}

export function domainLimitFor(plan: string | null | undefined): number {
  return entitlementsFor(plan).domainLimit;
}

export function sentinelLimitFor(plan: string | null | undefined): number {
  return entitlementsFor(plan).sentinelLimit;
}
