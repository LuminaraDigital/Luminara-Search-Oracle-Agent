/**
 * Browser client for the SMB Launchpad Worker routes (/api/launchpad/*).
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';
import type { ComplianceScanResult } from './compliance';

export interface LaunchpadCampaign {
  id: string;
  domain: string | null;
  business_name: string;
  country: 'AU' | 'NZ';
  campaign_type: 'closed_loop_loyalty' | 'milestone_preorder';
  title: string;
  description: string;
  chain: 'xdc' | 'polygon';
  network: 'testnet' | 'mainnet';
  token_name: string | null;
  token_symbol: string | null;
  contract_address: string | null;
  target_fiat_cents: number;
  fiat_currency: 'AUD' | 'NZD';
  voucher_expiry_months: number | null;
  listed_at: string | null;
  created_at: string;
  compliance_status?: string;
}

export interface LaunchpadVoucher {
  voucher_code: string;
  item_description: string;
  status: 'issued' | 'redeemed' | 'cancelled';
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  business_name: string;
  campaign_title: string;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string; compliance?: ComplianceScanResult; status: number };

async function call<T>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  try {
    const res = await workerFetchWithAuthRetry(`${apiBase()}/api/launchpad${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && data.ok === true) return data as { ok: true } & T;
    return {
      ok: false,
      status: res.status,
      error: typeof data.error === 'string' ? data.error : `Request failed (${res.status})`,
      compliance: data.compliance as ComplianceScanResult | undefined,
    };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export interface LaunchpadConfig {
  factories: Record<'xdc' | 'polygon', Record<'testnet' | 'mainnet', string | null>>;
  mainnetEnabled: boolean;
}

export interface OnchainEscrow {
  state: 'Funding' | 'Active' | 'Completed' | 'Failed';
  totalPledgedWei: string;
  totalDisbursedWei: string;
  totalRefundedWei: string;
  softCapWei: string;
  hardCapWei: string;
  fundingDeadline: number;
  deliveryDeadline: number;
  currentMilestone: number;
  milestoneCount: number;
  merchant: string;
}

export interface LaunchpadMilestone {
  milestone_index: number;
  title: string;
  description: string | null;
  payout_percentage: number;
}

export const launchpadClient = {
  config: () => call<LaunchpadConfig>('/config'),
  detail: (campaignId: string) =>
    call<{ campaign: LaunchpadCampaign; milestones: LaunchpadMilestone[] }>(`/campaigns/${encodeURIComponent(campaignId)}`),
  onchain: (campaignId: string) =>
    call<{ onchain: OnchainEscrow | 'not_measured' | 'not_applicable' }>(`/campaigns/${encodeURIComponent(campaignId)}/onchain`),
  listPublic: () => call<{ campaigns: LaunchpadCampaign[] }>('/campaigns'),
  listMine: () => call<{ campaigns: LaunchpadCampaign[] }>('/campaigns?mine=true'),
  create: (body: Record<string, unknown>) =>
    call<{ campaignId: string; compliance: ComplianceScanResult }>('/campaigns', { method: 'POST', body: JSON.stringify(body) }),
  registerContract: (campaignId: string, contractAddress: string, txHash?: string) =>
    call<{ contractAddress: string; listedAt: string }>(`/campaigns/${encodeURIComponent(campaignId)}/contract`, {
      method: 'PUT',
      body: JSON.stringify({ contractAddress, txHash: txHash || undefined }),
    }),
  issueVoucher: (campaignId: string, itemDescription: string, customerRef?: string) =>
    call<{ voucherCode: string; expiresAt: string | null }>('/vouchers', {
      method: 'POST',
      body: JSON.stringify({ campaignId, itemDescription, customerRef: customerRef || undefined }),
    }),
  lookupVoucher: (code: string) => call<{ voucher: LaunchpadVoucher }>(`/vouchers/${encodeURIComponent(code)}`),
  redeemVoucher: (voucherCode: string) =>
    call<{ redeemedAt: string }>('/vouchers/redeem', { method: 'POST', body: JSON.stringify({ voucherCode }) }),
  subscribe: (campaignId: string, input: { subscriberRef: string; channel: 'email' | 'telegram' | 'webhook'; walletAddress?: string }) =>
    call<{ campaignId: string; subscriberRef: string; channel: string }>(`/campaigns/${encodeURIComponent(campaignId)}/subscribe`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  unsubscribe: (campaignId: string, subscriberRef: string) =>
    call<{ removed: boolean }>(`/campaigns/${encodeURIComponent(campaignId)}/unsubscribe`, {
      method: 'POST',
      body: JSON.stringify({ subscriberRef }),
    }),
};
