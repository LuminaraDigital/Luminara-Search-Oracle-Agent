/**
 * Shared plan entitlements for paywall, Sentinel caps, and agency features.
 * Keep Worker PLANS / TON_PRICING descriptions in sync with domainLimits here.
 */

export type PlanId = 'free' | 'starter' | 'growth' | 'agency';

/** Daily caps that keep free sharing and MCP cheap to give away. */
export const FREE_SHARE_DAILY_LIMIT = 3;
export const FREE_MCP_DAILY_CALL_LIMIT = 100;

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
  /** Public report URLs, every plan. Custom branding needs whiteLabelPdf. Redacted scout teasers are a separate artifact. */
  shareLinks: boolean;
  /** MCP free tools (projects, context, reports), every plan. Paid research stays Agency or BYOK. */
  mcpAccess: boolean;
  teamSeats: number;
  /** New share links per UTC day. 0 = unlimited. */
  shareDailyLimit: number;
  /** MCP tool calls per UTC day. 0 = unlimited. */
  mcpDailyCallLimit: number;
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
    shareLinks: true,
    mcpAccess: true,
    teamSeats: 1,
    shareDailyLimit: FREE_SHARE_DAILY_LIMIT,
    mcpDailyCallLimit: FREE_MCP_DAILY_CALL_LIMIT,
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
    shareLinks: true,
    mcpAccess: true,
    teamSeats: 1,
    shareDailyLimit: 10,
    mcpDailyCallLimit: 300,
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
    shareLinks: true,
    mcpAccess: true,
    teamSeats: 3,
    shareDailyLimit: 0,
    mcpDailyCallLimit: 0,
  },
  agency: {
    id: 'agency',
    title: 'Agency',
    domainLimit: 25,
    sentinelLimit: 25,
    auditHistoryDepth: 0,
    agencyClientLimit: 10,
    competitorWatchLimit: 100,
    scheduledReaudit: 'daily',
    apiAccess: true,
    whiteLabelPdf: true,
    shareLinks: true,
    mcpAccess: true,
    teamSeats: 10,
    shareDailyLimit: 0,
    mcpDailyCallLimit: 0,
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
