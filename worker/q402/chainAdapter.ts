/**
 * Luminara Q402 Dual-Chain Adapter Interface
 *
 * Provides a unified abstraction for micro-settlements across TON and XDC networks.
 */

import type { Env } from '../env';
import type {
  Q402SignedPayload,
  Q402ChallengeRecord,
  Q402Asset,
  Q402PaymentRequirement,
} from './types';
import type { VerificationResult, SettlementResult } from './facilitator';

export interface ChainAdapter {
  readonly chain: 'ton' | 'xdc';
  createPaymentRequirement(
    env: Env,
    orderId: string,
    resource: string,
    asset: Q402Asset,
    action: string,
  ): Q402PaymentRequirement;
  verifyPayload(
    payload: Q402SignedPayload,
    env: Env,
  ): Promise<VerificationResult>;
  settlePayment(
    env: Env,
    payload: Q402SignedPayload,
    challenge: Q402ChallengeRecord,
    opts?: { fetcher?: typeof fetch },
  ): Promise<SettlementResult>;
  getExplorerUrl(network: string, txHash: string): string;
}
