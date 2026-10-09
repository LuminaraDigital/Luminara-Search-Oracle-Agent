import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBrandTwin,
  saveBrandTwin,
  stageSteeringAction,
  resolveSteeringAction,
  buildBrandTwinPromptContext,
  clearBrandTwinStoreForTesting,
} from '../services/agentCore/brandTwinService';

describe('Luminara AEO Brand Twin & Steering Wheel', () => {
  beforeEach(() => {
    clearBrandTwinStoreForTesting();
  });

  it('initializes a default brand twin profile', () => {
    const twin = getBrandTwin('proj_123', 'luminarasuite.com');
    expect(twin.projectId).toBe('proj_123');
    expect(twin.domain).toBe('luminarasuite.com');
    expect(twin.preferences.brandTone).toBe('authoritative');
    expect(twin.preferences.riskTolerance).toBe('balanced');
    expect(twin.delegation.requireHumanSignOff).toBe(true);
    expect(twin.inbox).toHaveLength(0);
  });

  it('updates preferences and delegation parameters', () => {
    const updated = saveBrandTwin('proj_123', {
      domain: 'mybrand.com',
      preferences: {
        brandTone: 'technical',
        targetCompetitors: ['rival.com', 'peer.io'],
      },
      delegation: {
        monitoringCadence: 'daily',
        alertThresholdSovDrop: 15,
      },
    });

    expect(updated.preferences.brandTone).toBe('technical');
    expect(updated.preferences.targetCompetitors).toEqual(['rival.com', 'peer.io']);
    expect(updated.delegation.monitoringCadence).toBe('daily');
    expect(updated.delegation.alertThresholdSovDrop).toBe(15);
  });

  it('stages a steering action and resolves it with distilled human judgment', () => {
    getBrandTwin('proj_123');
    const staged = stageSteeringAction('proj_123', {
      projectId: 'proj_123',
      findingId: 'f_schema_org',
      title: 'Deploy TechArticle Schema',
      category: 'structured_data',
      proposedAction: 'Inject JSON-LD TechArticle snippet into /docs',
      evidenceSummary: 'Google Rich Results requires structured schema for technical tutorials.',
    });

    expect(staged.status).toBe('pending');

    const { action, contextDecision } = resolveSteeringAction(
      'proj_123',
      staged.id,
      'accept',
      'Approved for next release.',
    );

    expect(action.status).toBe('accepted');
    expect(action.humanFeedback).toBe('Approved for next release.');
    expect(contextDecision.outcome).toBe('accept');
    expect(contextDecision.confidence).toBe(1.0);
    expect(contextDecision.metadata?.findingId).toBe('f_schema_org');
  });

  it('builds human-steered prompt context incorporating approved and dismissed patterns', () => {
    saveBrandTwin('proj_123', {
      preferences: {
        brandTone: 'institutional',
        targetCompetitors: ['competitor.com'],
      },
    });

    const act1 = stageSteeringAction('proj_123', {
      projectId: 'proj_123',
      findingId: 'f1',
      title: 'Add HowTo Schema',
      category: 'schema',
      proposedAction: 'Add HowTo',
      evidenceSummary: 'None',
    });
    resolveSteeringAction('proj_123', act1.id, 'dismiss', 'Deprecated by Google');

    const act2 = stageSteeringAction('proj_123', {
      projectId: 'proj_123',
      findingId: 'f2',
      title: 'Add Organization SameAs',
      category: 'schema',
      proposedAction: 'Add SameAs',
      evidenceSummary: 'Authority graph',
    });
    resolveSteeringAction('proj_123', act2.id, 'accept', 'Matches Brand DNA');

    const promptContext = buildBrandTwinPromptContext('proj_123');
    expect(promptContext).toContain('Tone: institutional');
    expect(promptContext).toContain('Key Competitors: competitor.com');
    expect(promptContext).toContain('Operator-Approved Recommendations: Add Organization SameAs');
    expect(promptContext).toContain('Operator-Dismissed Patterns (Do Not Propose): Add HowTo Schema');
  });
});
