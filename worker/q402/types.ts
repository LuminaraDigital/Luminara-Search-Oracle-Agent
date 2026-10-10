/**
 * Q402 Protocol Types for Luminara Suite.
 *
 * Implements the x402 Payment Required specification with native
 * TON, TEP-74 Jetton, and XDC Network dual-chain extensions.
 */

export const X402_VERSION = 1;

export const X_PAYMENT_HEADER = 'x-payment';
export const X_PAYMENT_RESPONSE_HEADER = 'x-payment-response';

export type Q402Scheme =
  | 'ton/jetton-transfer'
  | 'ton/native-transfer'
  | 'xdc/native-transfer'
  | 'xdc/xrc20-transfer';

export type Q402Asset = 'TON' | 'USDT' | 'LORA' | 'XDC';

export interface Q402PaymentRequirement {
  scheme: Q402Scheme;
  network: 'mainnet' | 'testnet' | 'apothem';
  maxAmountRequired: string; // nanoTON, Jetton base units, or wei
  resource: string;
  description: string;
  mimeType?: string;
  payTo: string; // Merchant TON or XDC address
  maxTimeoutSeconds: number;
  asset: Q402Asset;
  extra?: {
    orderId: string;
    memo: string;
    decimals: number;
    jettonMaster?: string;
    displayAmount: string;
  };
}

export interface Q402PaymentRequiredResponse {
  x402Version: number;
  accepts: Q402PaymentRequirement[];
  error?: string;
}

export interface Q402SignedPayload {
  x402Version: number;
  scheme: Q402Scheme;
  network: 'mainnet' | 'testnet' | 'apothem';
  orderId?: string;
  txHash: string;
  payerAddress?: string;
  amount: string;
  asset: Q402Asset;
  memo?: string;
}

export interface Q402ExecutionResponse {
  settled: boolean;
  txHash: string;
  orderId?: string;
  payer: string;
  amount: string;
  asset: Q402Asset;
  evidenceHash?: string;
  explorerUrl?: string;
  chain?: 'ton' | 'xdc';
}

export interface Q402ChallengeRecord {
  orderId: string;
  resource: string;
  scheme: Q402Scheme;
  asset: Q402Asset;
  amountUnits: string;
  memo: string;
  recipientAddress: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'settled' | 'expired';
}
