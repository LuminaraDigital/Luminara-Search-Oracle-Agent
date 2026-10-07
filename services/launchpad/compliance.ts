/**
 * Rule-based copy screen for SMB Launchpad campaigns (shared by Worker and UI).
 *
 * This is a guardrail, not legal advice and not a legal determination. It blocks
 * campaign copy that markets a token as an investment (returns, dividends, yield,
 * price speculation) and checks structural rules the product requires. Passing the
 * screen does not mean a campaign is outside the financial services regime.
 * See specs/0015-smb-launchpad.md for the regulatory reasoning and open questions.
 */

export type CampaignType = 'closed_loop_loyalty' | 'milestone_preorder';

export interface ComplianceMilestoneInput {
  title: string;
  description?: string;
  payoutPercentage: number;
}

export interface ComplianceCampaignInput {
  businessName: string;
  title: string;
  description: string;
  campaignType: CampaignType;
  fiatCurrency?: string;
  targetFiatCents?: number;
  milestones?: ComplianceMilestoneInput[];
}

export type ComplianceStatus = 'approved' | 'flagged' | 'rejected';

export interface ComplianceScanResult {
  approved: boolean;
  status: ComplianceStatus;
  flaggedTerms: string[];
  reasons: string[];
  suggestedEdits: string[];
  disclaimerText: string;
  /** Always 'rule_based'. The screen does not call a model. */
  method: 'rule_based';
  scannedAt: string;
}

export const LAUNCHPAD_LIMITS = {
  businessNameMax: 120,
  titleMax: 140,
  descriptionMin: 40,
  descriptionMax: 4000,
  milestonesMin: 1,
  milestonesMax: 10,
  milestoneTitleMax: 140,
  targetFiatCentsMax: 100_000_000, // 1,000,000.00 AUD/NZD per campaign
} as const;

/**
 * Investment-marketing patterns. Matched against normalised text (lower case,
 * punctuation between letters stripped) so "R.O.I" and "a-p-y" still match.
 */
const PROHIBITED_PATTERNS: Array<{ regex: RegExp; term: string; explanation: string }> = [
  {
    regex: /\b(roi|return on (your )?investment|guaranteed returns?|passive income|earn returns?)\b/,
    term: 'Return on investment / passive income',
    explanation: 'Promising a financial return markets the token as an investment.',
  },
  {
    regex: /\b(dividends?|profit ?shar(e|es|ing)|revenue ?shar(e|es|ing)|equity stake|ownership stake|shareholders?)\b/,
    term: 'Dividends / profit or revenue share / equity',
    explanation: 'A right to profits, revenue or ownership looks like a security or managed investment scheme.',
  },
  {
    regex: /\b(apy|apr|staking (rewards?|yields?|returns?)|yield farm(ing)?|interest[- ]bearing|earn interest)\b/,
    term: 'Staking yield / APY / interest',
    explanation: 'Yield or interest mechanics resemble a debenture or collective investment.',
  },
  {
    regex: /\b(capital (gains?|appreciation)|price will (rise|increase|go up)|\d+x (gains?|returns?)|to the moon|moonshot|pump|investment opportunit(y|ies)|invest (now|today|early))\b/,
    term: 'Price speculation',
    explanation: 'Promoting a token for resale profit invites investment characterisation and misleading conduct risk.',
  },
  {
    regex: /\b(guaranteed buy ?back|cash (out|redemption)|redeem(able)? for cash|exchange listing|listed on (an )?exchange)\b/,
    term: 'Cash redemption / exchange listing',
    explanation: 'Cash redemption or trading venues move the token away from a closed-loop voucher.',
  },
];

const UTILITY_SIGNALS: RegExp[] = [
  /\b(vouchers?|coupons?|loyalty|rewards?|membership|discounts?|store credit|pre ?orders?|gift cards?|perks?|passes|tickets?|class(es)?|sessions?)\b/,
  /\b(redeem(able|ed)?|exchange(able)? for|valid at|in ?store|collect(ed)? from|delivered|products?|goods|services?)\b/,
];

export const LAUNCHPAD_DISCLAIMER =
  'These tokens are vouchers for goods or services supplied by the issuing business. ' +
  'They are not an investment, carry no right to profits, dividends, interest or a cash refund from Luminara, ' +
  'and should not be bought expecting their price to rise. Luminara provides software only, never holds your funds, ' +
  'and is not a party to the sale. Check with the issuing business for its redemption, refund and expiry terms.';

/** Lower-case, collapse whitespace, and join letters split by punctuation ("r.o.i" -> "roi"). */
export function normaliseCopy(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/(?<=\b\w)[.\-_*](?=\w\b)/g, '')
    .replace(/[^\p{L}\p{N}%$ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scanCampaignCompliance(input: ComplianceCampaignInput): ComplianceScanResult {
  const flaggedTerms: string[] = [];
  const reasons: string[] = [];
  const suggestedEdits: string[] = [];

  const text = normaliseCopy(`${input.businessName ?? ''} ${input.title ?? ''} ${input.description ?? ''}`);

  for (const { regex, term, explanation } of PROHIBITED_PATTERNS) {
    if (regex.test(text)) {
      flaggedTerms.push(term);
      reasons.push(explanation);
    }
  }

  if ((input.description ?? '').trim().length < LAUNCHPAD_LIMITS.descriptionMin) {
    reasons.push(`Describe the offer in at least ${LAUNCHPAD_LIMITS.descriptionMin} characters.`);
  }

  if (!UTILITY_SIGNALS.every((p) => p.test(text))) {
    reasons.push('State the specific goods or services customers receive and how they redeem them.');
    suggestedEdits.push('Example: "Each voucher is redeemable for one 1kg bag of coffee, collected in store or delivered."');
  }

  if (input.campaignType === 'milestone_preorder') {
    const ms = input.milestones ?? [];
    if (ms.length < LAUNCHPAD_LIMITS.milestonesMin || ms.length > LAUNCHPAD_LIMITS.milestonesMax) {
      reasons.push(`Pre-orders need ${LAUNCHPAD_LIMITS.milestonesMin} to ${LAUNCHPAD_LIMITS.milestonesMax} delivery milestones.`);
    } else {
      const total = ms.reduce((acc, m) => acc + (Number.isInteger(m.payoutPercentage) ? m.payoutPercentage : NaN), 0);
      if (!Number.isFinite(total) || total !== 100) {
        reasons.push(`Milestone payouts must be whole percentages summing to exactly 100% (currently ${Number.isFinite(total) ? total : 'invalid'}).`);
      }
      if (ms.some((m) => !m.title?.trim() || m.payoutPercentage <= 0)) {
        reasons.push('Every milestone needs a title and a payout above 0%.');
      }
    }
  }

  let status: ComplianceStatus = 'approved';
  if (flaggedTerms.length > 0) {
    status = 'rejected';
    suggestedEdits.push('Remove references to returns, dividends, yield, price rises, cash-out or exchange listings.');
  } else if (reasons.length > 0) {
    status = 'flagged';
  }

  return {
    approved: status === 'approved',
    status,
    flaggedTerms,
    reasons,
    suggestedEdits,
    disclaimerText: LAUNCHPAD_DISCLAIMER,
    method: 'rule_based',
    scannedAt: new Date().toISOString(),
  };
}
