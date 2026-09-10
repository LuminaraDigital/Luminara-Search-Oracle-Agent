/**
 * Blockchain / TON Proof-of-Audit Attestation Service
 * 
 * Senior Web3 & Blockchain Engineering:
 * 1. Computes deterministic SHA-256 cryptographic digests of verified audit reports
 * 2. Formats standard TON comment memos for on-chain anchoring via TON Connect
 * 3. Provides verifiable Proof-of-Audit certificates and badge embeds for non-developers
 * 4. Powers autonomous pay-per-run micro-settlements (0.05 TON)
 */

import { AuditAttestation, TonMicroInvoice, AuditFinding } from './types';

export const TON_MICRO_PRICING = {
  singleAudit: { ton: 0.05, nanoTon: '50000000' },
  deepMultiAgentCrawl: { ton: 0.15, nanoTon: '150000000' },
};

export class TonAttestationService {
  /**
   * Computes a SHA-256 cryptographic hash of arbitrary string data using Web Crypto API
   */
  public async computeSha256Hex(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Generates an immutable Proof-of-Audit cryptographic attestation
   */
  public async createAttestation(payload: {
    domain: string;
    healthScore: number;
    citationRatePercent: number;
    findings: AuditFinding[];
    timestamp?: number;
  }): Promise<AuditAttestation> {
    const timestamp = payload.timestamp ?? Date.now();
    const canonicalPayload = JSON.stringify({
      domain: payload.domain.toLowerCase().trim(),
      score: payload.healthScore,
      citationRate: payload.citationRatePercent,
      findingsCount: payload.findings.length,
      timestamp,
      findingsFingerprint: payload.findings.map((f) => `${f.id}:${f.severity}:${f.title}`).sort().join(';'),
    });

    const digestHex = await this.computeSha256Hex(canonicalPayload);
    // TON memos have standard text limits (typically up to 128-512 chars in simple transactions)
    const tonMemo = `LUM:POA:${payload.domain}:${payload.healthScore}:${digestHex.slice(0, 16)}`;

    const attestation: AuditAttestation = {
      digestHex,
      domain: payload.domain,
      healthScore: payload.healthScore,
      citationRatePercent: payload.citationRatePercent,
      timestamp,
      tonMemo,
      verifiedAt: Date.now(),
    };

    this.saveAttestationLocally(attestation);
    return attestation;
  }

  /**
   * Generates a 1-click TON micro-invoice for an autonomous audit run
   */
  public createRunInvoice(domain: string, runType: 'singleAudit' | 'deepMultiAgentCrawl' = 'singleAudit'): TonMicroInvoice {
    const pricing = TON_MICRO_PRICING[runType];
    const orderId = `ton_run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const memo = `LUM:AGENT:${orderId}:${domain.slice(0, 24)}`;

    return {
      orderId,
      amountNano: pricing.nanoTon,
      tonAmount: pricing.ton,
      memo,
      recipientAddress: 'EQB_Luminara_Attestation_Vault_Treasury',
      status: 'pending',
    };
  }

  /**
   * Generate HTML embed badge for non-developers to paste on their website
   */
  public generateBadgeHtml(attestation: AuditAttestation): string {
    const scoreColor = attestation.healthScore >= 80 ? '#10b981' : attestation.healthScore >= 60 ? '#f59e0b' : '#ef4444';
    return `<!-- Luminara AEO Verified Audit Badge -->
<a href="https://luminarasuite.com/verify/${attestation.digestHex}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:#0f172a;color:#f8fafc;border-radius:8px;font-family:sans-serif;font-size:12px;text-decoration:none;border:1px solid #334155;">
  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${scoreColor};"></span>
  <span>AEO Health: <strong>${attestation.healthScore}/100</strong></span>
  <span style="color:#64748b;">| Verified on TON</span>
</a>`;
  }

  private saveAttestationLocally(attestation: AuditAttestation): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const key = `luminara_poa_${attestation.digestHex}`;
      localStorage.setItem(key, JSON.stringify(attestation));
    } catch {
      /* ignore */
    }
  }

  public getAttestationLocally(digestHex: string): AuditAttestation | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(`luminara_poa_${digestHex}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
}

export const tonAttestationService = new TonAttestationService();
