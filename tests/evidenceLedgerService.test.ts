import { describe, it, expect } from 'vitest';
import {
  EvidenceLedger,
  validateArtifactUsability,
  fastHash,
  EXTERNAL_EFFECT_UNVERIFIED,
} from '../services/audit/evidenceLedgerService';

describe('EvidenceLedgerService', () => {
  it('computes deterministic non-empty fastHash digests', () => {
    const hash1 = fastHash('payload-alpha');
    const hash2 = fastHash('payload-alpha');
    const hash3 = fastHash('payload-beta');
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(64);
  });

  it('validates artifact usability correctly by content type', () => {
    expect(validateArtifactUsability('', 'json')).toBe(false);
    expect(validateArtifactUsability('   ', 'text')).toBe(false);
    expect(validateArtifactUsability('{"valid": true}', 'json')).toBe(true);
    expect(validateArtifactUsability('{not json}', 'json')).toBe(false);
    expect(validateArtifactUsability('<!DOCTYPE html><html><body>Audit</body></html>', 'html')).toBe(true);
    expect(validateArtifactUsability('%PDF-1.4 header text', 'pdf')).toBe(true);
    expect(validateArtifactUsability('invalid pdf', 'pdf')).toBe(false);
  });

  it('records events and tracks valid artifacts', () => {
    const ledger = new EvidenceLedger();
    ledger.recordEvent({
      kind: 'tool_result',
      tool: 'serp_radar',
      success: true,
      authoritative: true,
      detail: 'SERP inspection completed',
    });

    const isValid = ledger.recordArtifact('/reports/audit.json', '{"score": 95}', 'json');
    expect(isValid).toBe(true);
    expect(ledger.hasValidArtifact('/reports/audit.json')).toBe(true);
    expect(ledger.hasValidArtifact('/reports/missing.json')).toBe(false);
  });

  it('enforces verified completion decision when requirements are met', () => {
    const ledger = new EvidenceLedger();
    ledger.recordEvent({
      kind: 'probe_verification',
      tool: 'llm_crawler',
      success: true,
      authoritative: true,
      detail: 'Crawler 200 OK',
    });
    ledger.recordArtifact('/out/report.html', '<div>Report content</div>', 'html');

    const decision = ledger.evaluateCompletion({
      requiredArtifacts: ['/out/report.html'],
      requireAuthoritativeTool: true,
      requiredTools: ['llm_crawler'],
    });

    expect(decision.canComplete).toBe(true);
    expect(decision.status).toBe('verified');
  });

  it('enforces unverified status and EXTERNAL_EFFECT_UNVERIFIED when authoritative proof is absent', () => {
    const ledger = new EvidenceLedger();
    ledger.recordEvent({
      kind: 'tool_result',
      tool: 'untrusted_proxy',
      success: true,
      authoritative: false,
      detail: 'Proxy output without proof',
    });

    const decision = ledger.evaluateCompletion({
      requireAuthoritativeTool: true,
    });

    expect(decision.canComplete).toBe(false);
    expect(decision.status).toBe('unverified');
    expect(decision.reason).toBe(EXTERNAL_EFFECT_UNVERIFIED);
  });

  it('fails completion when a required artifact is missing', () => {
    const ledger = new EvidenceLedger();
    ledger.recordEvent({
      kind: 'tool_result',
      tool: 'tool_a',
      success: true,
      authoritative: true,
      detail: 'Done',
    });

    const decision = ledger.evaluateCompletion({
      requiredArtifacts: ['/out/missing_file.pdf'],
    });

    expect(decision.canComplete).toBe(false);
    expect(decision.missingArtifacts).toContain('/out/missing_file.pdf');
  });
});
