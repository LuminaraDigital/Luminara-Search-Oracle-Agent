import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUDIT_DIGEST_COVERAGE,
  AUDIT_DIGEST_DISCLOSURE,
  PROOF_BADGE_ENABLED,
  tonAttestationService,
} from '../../services/agentCore/tonAttestationService';
import { AgentMissionControl } from '../../components/audit/AgentMissionControl';
import { ProofOfAuditBadgeModal } from '../../components/audit/ProofOfAuditBadgeModal';
import { PLANS } from '../../worker/telegramBot';

/** Words the digest copy must never use: nothing is sent to a chain or independently checked. */
const OVERCLAIM = /verified|on-chain|immutabl|permanent|blockchain|certifi|anchor|\bTON\b/i;

const sampleAttestation = () =>
  tonAttestationService.createAttestation({
    domain: 'testbrand.com',
    healthScore: 92,
    citationRatePercent: 85,
    findings: [],
    timestamp: 1700000000000,
  });

describe('audit digest service', () => {
  it('should compute deterministic SHA-256 digests', async () => {
    const hash1 = await tonAttestationService.computeSha256Hex('luminara_test_payload');
    const hash2 = await tonAttestationService.computeSha256Hex('luminara_test_payload');
    const hash3 = await tonAttestationService.computeSha256Hex('different_payload');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(64); // 256 bits = 64 hex chars
  });

  it('builds a digest record for the audit summary', async () => {
    const attestation = await sampleAttestation();

    expect(attestation.domain).toBe('testbrand.com');
    expect(attestation.healthScore).toBe(92);
    expect(attestation.digestHex).toMatch(/^[a-f0-9]{64}$/);
    expect(attestation.tonMemo).toContain('LUM:POA:testbrand.com:92:');
  });

  it('describes the digest without over-claiming', () => {
    expect(AUDIT_DIGEST_DISCLOSURE).toBe('Recorded by Luminara. Self-reported audit, not independently checked.');
    expect(AUDIT_DIGEST_COVERAGE).toContain('domain, health score, citation rate, number of findings, timestamp');
    expect(AUDIT_DIGEST_COVERAGE).toContain('It does not cover page content or search results.');
    expect(AUDIT_DIGEST_COVERAGE).not.toMatch(OVERCLAIM);
  });
});

describe('Proof-of-Audit badge is hidden until Phase 4', () => {
  it('keeps the badge switched off', () => {
    expect(PROOF_BADGE_ENABLED).toBe(false);
  });

  it('emits no badge HTML and no /verify link by default', async () => {
    const attestation = await sampleAttestation();
    const badgeHtml = tonAttestationService.generateBadgeHtml(attestation);
    expect(badgeHtml).toBe('');
  });

  it('uses truthful badge wording when enabled', async () => {
    const attestation = await sampleAttestation();
    const badgeHtml = tonAttestationService.generateBadgeHtml(attestation, true);
    expect(badgeHtml).toContain('AEO Health: <strong>92/100</strong>');
    expect(badgeHtml).toContain('Recorded by Luminara. Self-reported.');
    expect(badgeHtml).toContain(`/verify/${attestation.digestHex}`);
    expect(badgeHtml).not.toMatch(OVERCLAIM);
  });

  it('does not render the Mission Control entry point by default', async () => {
    const props = { events: [], isComplete: true, hasAttestation: true, onViewAttestation: () => {} };
    const hidden = renderToStaticMarkup(createElement(AgentMissionControl, props));
    expect(hidden).not.toContain('View Luminara-recorded digest');
    expect(hidden).not.toMatch(/attestation|on-chain/i);

    const shown = renderToStaticMarkup(createElement(AgentMissionControl, { ...props, proofBadgeEnabled: true }));
    expect(shown).toContain('View Luminara-recorded digest');
    expect(shown).not.toMatch(/on-chain|attestation/i);
  });

  it('renders nothing from the badge modal by default, and truthful copy when enabled', async () => {
    const attestation = await sampleAttestation();
    const hidden = renderToStaticMarkup(createElement(ProofOfAuditBadgeModal, { attestation, onClose: () => {} }));
    expect(hidden).toBe('');

    const shown = renderToStaticMarkup(
      createElement(ProofOfAuditBadgeModal, { attestation, onClose: () => {}, enabled: true }),
    );
    expect(shown).toContain('Luminara-recorded digest');
    expect(shown).toContain(AUDIT_DIGEST_DISCLOSURE);
    expect(shown).toContain(AUDIT_DIGEST_COVERAGE);
    expect(shown).not.toMatch(OVERCLAIM);
    expect(shown).not.toContain(attestation.tonMemo);
  });
});

describe('no false on-chain attestation claims', () => {
  it('sells the one-off runs without attestation claims', () => {
    for (const id of ['single_audit', 'multi_agent_crawl']) {
      const plan = PLANS[id];
      expect(`${plan.title} ${plan.description}`).not.toMatch(/verified|on-chain|certifi|proof|\bTON\b/i);
      expect(plan.description).toContain('Self-reported audit, not independently checked.');
    }
  });

  it('keeps the P0-4 phrases and the fake vault address out of shipped source', () => {
    const banned = /on the TON blockchain|Verified on TON|TON anchoring|On-Chain (Search Authority )?Attestation|on-chain certification|Attestation_Vault/i;
    const root = join(__dirname, '..', '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && banned.test(readFileSync(full, 'utf8'))) hits.push(full);
      }
    };
    for (const dir of ['components', 'services', 'worker']) walk(join(root, dir));
    expect(hits).toEqual([]);
  });
});
