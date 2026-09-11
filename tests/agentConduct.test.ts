import { describe, expect, it } from 'vitest';
import { SYSTEM_INSTRUCTIONS } from '../constants';
import {
  AGENT_CONDUCT_RUNTIME,
  luminaraAgentConductSkill
} from '../services/skills/agentConduct';
import { skillsGeneratorService } from '../services/harness/skillsGeneratorService';

describe('luminara-agent-conduct', () => {
  it('is registered first in the Skills Hub catalog', () => {
    const skills = skillsGeneratorService.listSkills();
    expect(skills[0]?.id).toBe('luminara-agent-conduct');
    expect(skillsGeneratorService.getSkill('luminara-agent-conduct')?.category).toBe('conduct');
  });

  it('exports platform manifests without Claude identity claims', () => {
    const md = skillsGeneratorService.formatForPlatform(luminaraAgentConductSkill, 'antigravity');
    expect(md).toContain('name: luminara-agent-conduct');
    expect(md).toContain('---');
    expect(md).not.toMatch(/You are Claude\b/i);
    expect(md).toMatch(/Never claim Claude/i);
  });

  it('injects compact conduct norms into Oracle system instructions', () => {
    expect(SYSTEM_INSTRUCTIONS).toContain(AGENT_CONDUCT_RUNTIME.slice(0, 40));
    expect(SYSTEM_INSTRUCTIONS).toContain('audit template above still wins');
    expect(SYSTEM_INSTRUCTIONS).not.toMatch(/You are Claude\b/i);
  });
});
