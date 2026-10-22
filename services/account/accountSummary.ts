import { CHECKOUT_TERM_LINE } from '../../components/paywall/planCopy';
import { formatAuDate } from '../../utils/formatAuDate';

const PLAN_TITLES: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  growth: 'Growth',
  agency: 'Agency',
};

export function planTitle(plan: string | null | undefined): string {
  const key = (plan || 'free').toLowerCase();
  return PLAN_TITLES[key] || key;
}

/** `2 of 3 checks left` for a free allowance. Paid plans have no daily cap. */
export function checksLeftLine(remaining: number, limit: number, unlimited: boolean): string {
  if (unlimited || limit < 0) return 'No daily cap on this plan.';
  const left = Math.max(0, Math.floor(remaining));
  const cap = Math.max(0, Math.floor(limit));
  return `${left} of ${cap} checks left`;
}

export function planDetailLine(plan: string | null | undefined, expiresAt?: number | null): string {
  if (!plan || plan === 'free') return 'Free plan. No renewal.';
  const ends = expiresAt ? formatAuDate(expiresAt) : '';
  return ends ? `Ends ${ends}. ${CHECKOUT_TERM_LINE}` : CHECKOUT_TERM_LINE;
}
