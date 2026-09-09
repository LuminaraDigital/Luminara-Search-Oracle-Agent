import { describe, it, expect } from 'vitest';
import { planCapsFor, PLANS, FREE_PLAN_CAPS } from '../worker/telegramBot';
import { TON_PRICING } from '../worker/tonPayment';

describe('agency plan + caps', () => {
  it('exposes agency in Stars and TON catalogs', () => {
    expect(PLANS.agency.title).toMatch(/Agency/i);
    expect(PLANS.agency.domainLimit).toBe(25);
    expect(PLANS.agency.sentinelLimit).toBe(25);
    expect(PLANS.agency.agencyClientLimit).toBe(10);
    expect(TON_PRICING.agency.ton).toBe(120);
  });

  it('planCapsFor respects free and paid tiers', () => {
    expect(planCapsFor(undefined).sentinelLimit).toBe(FREE_PLAN_CAPS.sentinelLimit);
    expect(planCapsFor('starter').domainLimit).toBe(2);
    expect(planCapsFor('growth').scheduledReaudit).toBe('weekly');
    expect(planCapsFor('pro').apiAccess).toBe(true);
    expect(planCapsFor('agency').sentinelLimit).toBe(25);
  });
});
