/**
 * Audit digest service.
 *
 * Computes a SHA-256 digest of an audit summary in the browser. Nothing here
 * is sent to any blockchain, and the digest is self-reported: it shows the
 * summary has not changed since it was computed, not that the audit is correct.
 * Real TON testnet anchoring is planned in Phase 4 of
 * docs/plans/zoro-concepts-implementation-plan.md.
 */

import { AuditAttestation, AuditFinding } from './types';

/**
 * Gates every Proof-of-Audit badge entry point: the Mission Control button,
 * the badge modal, and the embeddable badge HTML with its /verify/<digest> link.
 * Off because no client writes the digest to the Worker store yet, so the link
 * would 404. Phase 4 (P4-7) of docs/plans/zoro-concepts-implementation-plan.md
 * re-enables it against real rows.
 */
export const PROOF_BADGE_ENABLED: boolean = false;

/** The one honest label for the digest. Reused by the badge, modal and verify page. */
export const AUDIT_DIGEST_DISCLOSURE = 'Recorded by Luminara. Self-reported audit, not independently checked.';

/** States exactly which fields the digest covers (see createAttestation). */
export const AUDIT_DIGEST_COVERAGE =
  'SHA-256 digest of the domain, health score, citation rate, number of findings, timestamp, and the id, severity and title of each finding. It does not cover page content or search results.';

export class TonAttestationService {
  /**
   * Computes a SHA-256 hash of arbitrary string data using Web Crypto API
   */
  public async computeSha256Hex(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const buffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Builds the audit digest record. Keep AUDIT_DIGEST_COVERAGE in sync with
   * the canonical payload below.
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
    // Short reference string. Not sent anywhere today; reserved for Phase 4.
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
   * HTML embed badge linking to /verify/<digest>. Returns an empty string
   * while the badge is disabled, so no caller can emit a dead link.
   */
  public generateBadgeHtml(attestation: AuditAttestation, enabled: boolean = PROOF_BADGE_ENABLED): string {
    if (!enabled) return '';
    const scoreColor = attestation.healthScore >= 80 ? '#10b981' : attestation.healthScore >= 60 ? '#f59e0b' : '#ef4444';
    return `<!-- Luminara audit digest badge -->
<a href="https://luminarasuite.com/verify/${attestation.digestHex}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;background:#0f172a;color:#f8fafc;border-radius:8px;font-family:sans-serif;font-size:12px;text-decoration:none;border:1px solid #334155;">
  <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${scoreColor};"></span>
  <span>AEO Health: <strong>${attestation.healthScore}/100</strong></span>
  <span style="color:#64748b;">| Recorded by Luminara. Self-reported.</span>
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
