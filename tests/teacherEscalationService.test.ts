import { describe, it, expect } from 'vitest';
import {
  detectStudentFailure,
  synthesizeSkillDraft,
  evaluateAndEscalate,
} from '../services/oracle/teacherEscalationService';

describe('TeacherEscalationService', () => {
  it('detects student failure patterns accurately', () => {
    expect(detectStudentFailure("I don't have access to real-time SERP data.").failed).toBe(true);
    expect(detectStudentFailure("Unknown action 'run_custom_probe'").failed).toBe(true);
    expect(detectStudentFailure("As an AI, I am unable to crawl live websites.").failed).toBe(true);
    expect(detectStudentFailure("The brand was cited in 4 out of 5 queries.").failed).toBe(false);
  });

  it('detects tool execution errors', () => {
    const res = detectStudentFailure("Executing crawl...", "Connection refused 502 Bad Gateway");
    expect(res.failed).toBe(true);
    expect(res.reason).toContain("Connection refused");
  });

  it('synthesizes a structured skill draft following Luminara methodology playbooks', () => {
    const draft = synthesizeSkillDraft({
      topic: 'Pricing Schema Audit',
      userQuery: 'How to check pricing table schema for ChatGPT search',
      teacherCorrection: 'Inspect Offer and PriceSpecification JSON-LD entities.',
    });

    expect(draft.skillName).toBe('seo-pricing-schema-audit');
    expect(draft.markdownProcedure).toContain('Methodology Playbook');
    expect(draft.markdownProcedure).toContain('Offer and PriceSpecification');
    expect(draft.triggerPatterns[0]).toContain('How to check pricing');
  });

  it('escalates failure to teacher and returns corrective reply with synthesized skill', async () => {
    const escalation = await evaluateAndEscalate({
      userQuery: 'Extract Reddit consensus citations',
      studentReply: "I don't have a tool to search Reddit discussions.",
      topic: 'Reddit Citations',
      teacherHandler: async (query) => `Teacher verified extraction for '${query}': 8 mentions identified.`,
    });

    expect(escalation.escalated).toBe(true);
    expect(escalation.correctiveReply).toContain('8 mentions identified');
    expect(escalation.synthesizedSkill).toBeDefined();
    expect(escalation.synthesizedSkill?.skillName).toBe('seo-reddit-citations');
  });

  it('does not escalate when student response is successful', async () => {
    const escalation = await evaluateAndEscalate({
      userQuery: 'Check Schema status',
      studentReply: 'Schema.org Organization markup is valid and active.',
    });

    expect(escalation.escalated).toBe(false);
    expect(escalation.correctiveReply).toBeUndefined();
  });
});
