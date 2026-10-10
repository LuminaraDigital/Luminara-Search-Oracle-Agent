import { describe, it, expect } from 'vitest';
import { extractVerifyCardFromContent } from '../components/audit/ActionApprovalCard';
import { CREW_PROFILES } from '../services/agentCore/crewOrchestrator';
import type { VerifyCardData, AgentRosterRole } from '../types';

describe('ActionApprovalCard & VerifyCard Extraction', () => {
  it('extracts embedded verify-card and strips comment tag from content', () => {
    const cardData: VerifyCardData = {
      title: 'Canonical Schema Verification',
      steps: [
        { id: '1', label: 'Robots.txt Crawlability', status: 'passed' },
        { id: '2', label: 'Schema.org JSON-LD', status: 'failed', detail: 'Missing Organization entity' },
      ],
      verdict: 'Schema markup requires single-line Organization fix before next crawl.',
      actionText: 'Copy JSON-LD Patch',
      actionType: 'copy_fix',
      actionPayload: '{"@context": "https://schema.org", "@type": "Organization"}',
      reportUrl: 'https://luminara.ai/report/test-audit-123',
    };

    const rawMessage = `Here is your audit analysis summary.\n\n<!--verify-card:${JSON.stringify(cardData)}-->\n\nPlease review the checklist above.`;

    const result = extractVerifyCardFromContent(rawMessage);
    expect(result.verifyCard).toBeDefined();
    expect(result.verifyCard?.title).toBe('Canonical Schema Verification');
    expect(result.verifyCard?.steps).toHaveLength(2);
    expect(result.verifyCard?.verdict).toContain('Schema markup requires');
    expect(result.verifyCard?.actionType).toBe('copy_fix');
    expect(result.verifyCard?.reportUrl).toBe('https://luminara.ai/report/test-audit-123');

    // Clean content should not contain the <!--verify-card comment
    expect(result.cleanContent).not.toContain('<!--verify-card');
    expect(result.cleanContent).toContain('Here is your audit analysis summary.');
    expect(result.cleanContent).toContain('Please review the checklist above.');
  });

  it('handles message with no verify-card gracefully', () => {
    const rawMessage = 'This is a standard text reply without any action card.';
    const result = extractVerifyCardFromContent(rawMessage);
    expect(result.verifyCard).toBeUndefined();
    expect(result.cleanContent).toBe(rawMessage);
  });

  it('gracefully handles malformed JSON in verify-card comment', () => {
    const rawMessage = 'Summary text.\n<!--verify-card:{corrupted json string-->\nFollow up text.';
    const result = extractVerifyCardFromContent(rawMessage);
    expect(result.verifyCard).toBeUndefined();
    expect(result.cleanContent).toBe(rawMessage);
  });

  it('adheres to APS Invariant 4: verdict + one action + report link', () => {
    const card: VerifyCardData = {
      title: 'Adversarial Probe Result',
      steps: [{ id: 's1', label: 'Citation Gate', status: 'passed' }],
      verdict: 'Passed all 3 verification checks.',
      actionText: 'Execute Patch',
      actionType: 'execute',
      reportUrl: 'https://luminara.ai/share/report/123',
    };

    expect(card.verdict).toBeTruthy();
    expect(card.actionText).toBeTruthy();
    expect(card.reportUrl).toMatch(/^https?:\/\//);
  });
});

describe('Crew Orchestrator Roster Profiles', () => {
  const EXPECTED_ROLES: AgentRosterRole[] = [
    'scout',
    'serp_radar',
    'playbook_auditor',
    'competitor_strategist',
    'remediation_architect',
    'executive_translator',
    'adversarial_critic',
  ];

  it('contains all 7 core specialist profiles with non-empty fields', () => {
    for (const role of EXPECTED_ROLES) {
      const profile = CREW_PROFILES[role];
      expect(profile, `Profile for role ${role} should exist`).toBeDefined();
      expect(profile.role).toBe(role);
      expect(profile.name.length).toBeGreaterThan(0);
      expect(profile.avatar.length).toBeGreaterThan(0);
      expect(profile.tagline.length).toBeGreaterThan(0);
      expect(profile.goal.length).toBeGreaterThan(0);
    }
  });
});
