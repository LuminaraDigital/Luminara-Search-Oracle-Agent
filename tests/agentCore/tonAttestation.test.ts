import { describe, it, expect } from 'vitest';
import { tonAttestationService } from '../../services/agentCore/tonAttestationService';

describe('TonAttestationService (Blockchain Proof-of-Audit & Micropayments)', () => {
  it('should compute deterministic SHA-256 digests', async () => {
    const hash1 = await tonAttestationService.computeSha256Hex('luminara_test_payload');
    const hash2 = await tonAttestationService.computeSha256Hex('luminara_test_payload');
    const hash3 = await tonAttestationService.computeSha256Hex('different_payload');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(64); // 256 bits = 64 hex chars
  });

  it('should generate an attestation with valid TON comment memo and embed code', async () => {
    const attestation = await tonAttestationService.createAttestation({
      domain: 'testbrand.com',
      healthScore: 92,
      citationRatePercent: 85,
      findings: [],
      timestamp: 1700000000000,
    });

    expect(attestation.domain).toBe('testbrand.com');
    expect(attestation.healthScore).toBe(92);
    expect(attestation.tonMemo).toContain('LUM:POA:testbrand.com:92:');

    const badgeHtml = tonAttestationService.generateBadgeHtml(attestation);
    expect(badgeHtml).toContain('AEO Health: <strong>92/100</strong>');
    expect(badgeHtml).toContain('Verified on TON');
    expect(badgeHtml).toContain(attestation.digestHex);
  });

  it('should generate valid 1-click TON micro-invoices', () => {
    const invoice = tonAttestationService.createRunInvoice('acme.com', 'singleAudit');
    expect(invoice.tonAmount).toBe(0.05);
    expect(invoice.amountNano).toBe('50000000');
    expect(invoice.memo).toContain('LUM:AGENT:');
    expect(invoice.memo).toContain('acme.com');
  });
});
