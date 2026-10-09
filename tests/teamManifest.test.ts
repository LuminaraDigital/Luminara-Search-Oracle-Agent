import { describe, it, expect } from 'vitest';
import {
  exportTeamManifest,
  parseTeamManifest,
  type VisibilityTeamManifest,
} from '../services/teams/teamManifest';

describe('teamManifest', () => {
  it('exports a valid manifest and redacts any accidentally included credentials', () => {
    const leakKey = 'gsk_dummy_sample_test_key_1234567890';
    const manifest: VisibilityTeamManifest = {
      version: '1.0',
      name: 'B2B SaaS AEO Defense Team',
      description: 'Autonomous team monitoring Google AIO and Perplexity share of voice.',
      category: 'AEO_WAR_ROOM',
      agents: [
        {
          id: 'aeo-scout',
          name: 'AEO Scout Bot',
          role: 'Answer Engine Citation Analyst',
          systemInstructions: `Audit citations. Do not use test key ${leakKey}`,
          toolsAllowed: ['tavily_search', 'read_brand_dna'],
        },
      ],
      routines: [
        {
          name: 'Weekly Monday Probe',
          schedule: '0 9 * * 1',
          prompt: 'Run weekly 14 non-branded buyer prompt probe.',
          continuity: true,
        },
      ],
      playbookMarkdown: '# B2B AEO Playbook\nPrioritize schema and directory citations.',
    };

    const exported = exportTeamManifest(manifest);

    expect(exported).toContain('name: "B2B SaaS AEO Defense Team"');
    expect(exported).toContain('category: "AEO_WAR_ROOM"');
    expect(exported).not.toContain(leakKey);
    expect(exported).toContain('«redacted');
    expect(exported).toContain('# B2B AEO Playbook');
  });

  it('parses valid manifest frontmatter correctly', () => {
    const raw = `---
version: "1.0"
name: "Local Dental GEO Team"
description: "Optimizes local map pack and AI engine recommendations."
category: "LOCAL_GEO"
---
# Local Playbook
Optimize Google Business Profile and local citations.
`;
    const parsed = parseTeamManifest(raw);
    expect(parsed.name).toBe('Local Dental GEO Team');
    expect(parsed.category).toBe('LOCAL_GEO');
    expect(parsed.playbookMarkdown).toContain('# Local Playbook');
  });

  it('throws on invalid manifest formatting', () => {
    expect(() => parseTeamManifest('missing frontmatter')).toThrow(
      'missing frontmatter delimiter'
    );
  });
});
