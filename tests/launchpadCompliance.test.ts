import { describe, it, expect } from 'vitest';
import {
  LAUNCHPAD_DISCLAIMER,
  normaliseCopy,
  scanCampaignCompliance,
  type ComplianceCampaignInput,
} from '../services/launchpad/compliance';
import { VOUCHER_CODE_RE, generateVoucherCode, normaliseEvmAddress, LAUNCHPAD_CHAINS } from '../services/launchpad/contracts';

const base = (over: Partial<ComplianceCampaignInput> = {}): ComplianceCampaignInput => ({
  businessName: 'Bondi Surf Shop',
  title: 'Summer surf club loyalty vouchers',
  description: 'Each voucher is redeemable in store for one surfboard hire session or a discount on wax and accessories.',
  campaignType: 'closed_loop_loyalty',
  ...over,
});

describe('launchpad copy screen', () => {
  it('approves a clear goods-and-services loyalty voucher', () => {
    const r = scanCampaignCompliance(base());
    expect(r).toMatchObject({ approved: true, status: 'approved', flaggedTerms: [], method: 'rule_based' });
    expect(r.disclaimerText).toBe(LAUNCHPAD_DISCLAIMER);
  });

  it('approves a milestone pre-order whose payouts sum to 100', () => {
    const r = scanCampaignCompliance(base({
      campaignType: 'milestone_preorder',
      description: 'Pre-order vouchers redeemable for one 1kg bag of single-origin coffee, delivered or collected from our roastery.',
      milestones: [{ title: 'Beans imported', payoutPercentage: 50 }, { title: 'Orders delivered', payoutPercentage: 50 }],
    }));
    expect(r.approved).toBe(true);
  });

  it.each([
    ['15% guaranteed ROI and quarterly dividends', 'Return on investment / passive income'],
    ['Holders get a profit share of every sale', 'Dividends / profit or revenue share / equity'],
    ['Stake for 80% APY', 'Staking yield / APY / interest'],
    ['Price will rise once we grow, invest early', 'Price speculation'],
    ['Tokens will be listed on an exchange', 'Cash redemption / exchange listing'],
    ['Guaranteed R.O.I for early backers', 'Return on investment / passive income'],
    ['Earn a-p-y on your vouchers', 'Staking yield / APY / interest'],
  ])('rejects investment language: %s', (phrase, term) => {
    const r = scanCampaignCompliance(base({ description: `${base().description} ${phrase}.` }));
    expect(r.status).toBe('rejected');
    expect(r.flaggedTerms).toContain(term);
  });

  it.each([
    ['Moonlight Cafe', 'Coffee vouchers redeemable in store for flat whites and pastries at our Moonlight Cafe.'],
    ['Sharehouse Bakery', 'Loyalty rewards redeemable for bread, cakes and catering services at our shop. Staff shares in-store tips.'],
    ['Interest Free Books', 'Store credit vouchers redeemable for any book or stationery products in store.'],
  ])('does not false-positive on ordinary business copy: %s', (businessName, description) => {
    const r = scanCampaignCompliance(base({ businessName, description }));
    expect(r.flaggedTerms).toEqual([]);
    expect(r.approved).toBe(true);
  });

  it('flags vague copy with no goods or services', () => {
    const r = scanCampaignCompliance(base({ title: 'Community badge', description: 'Support our presence on social media and join our telegram group today.' }));
    expect(r.status).toBe('flagged');
  });

  it.each([
    [[{ title: 'A', payoutPercentage: 40 }, { title: 'B', payoutPercentage: 40 }], 'sum'],
    [[{ title: 'A', payoutPercentage: 50.5 }, { title: 'B', payoutPercentage: 49.5 }], 'whole'],
    [[], 'milestones'],
    [[{ title: '', payoutPercentage: 100 }], 'title'],
  ])('flags invalid milestone sets (%#)', (milestones, _why) => {
    const r = scanCampaignCompliance(base({ campaignType: 'milestone_preorder', milestones }));
    expect(r.status).toBe('flagged');
  });

  it('normalises punctuation-split words', () => {
    expect(normaliseCopy('Guaranteed R.O.I!')).toBe('guaranteed roi');
    expect(normaliseCopy('pre-order in-store')).toBe('pre order in store');
  });
});

describe('launchpad chain helpers', () => {
  it('has no factory addresses until our own audited deployment exists', () => {
    for (const chain of Object.values(LAUNCHPAD_CHAINS)) {
      expect(chain.testnet.factoryAddress).toBeNull();
      expect(chain.mainnet.factoryAddress).toBeNull();
    }
  });

  it('generates well-formed, non-repeating voucher codes', () => {
    const codes = new Set(Array.from({ length: 2000 }, generateVoucherCode));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(c).toMatch(VOUCHER_CODE_RE);
  });

  it('normalises 0x and xdc addresses and rejects junk', () => {
    const hex = '0xAbCdEf0123456789abcdef0123456789ABCDEF01';
    expect(normaliseEvmAddress(hex)).toBe(hex.toLowerCase());
    expect(normaliseEvmAddress(`xdc${hex.slice(2)}`)).toBe(hex.toLowerCase());
    expect(normaliseEvmAddress('0x123')).toBeNull();
    expect(normaliseEvmAddress(42)).toBeNull();
  });
});
