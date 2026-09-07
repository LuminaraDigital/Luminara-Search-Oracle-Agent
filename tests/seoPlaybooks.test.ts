import { describe, expect, it } from 'vitest';
import { PLAYBOOKS, selectAuditPlaybooks, selectChatPlaybooks, playbookContext, inferLenses } from '../services/skills/seoPlaybooks';

describe('compiled playbooks', () => {
  it('ship the core set with real content and no runtime leftovers', () => {
    const ids = PLAYBOOKS.map(p => p.id);
    for (const id of ['core', 'technical', 'content', 'schema', 'geo', 'local', 'ecommerce']) expect(ids).toContain(id);
    for (const p of PLAYBOOKS) {
      expect(p.body.length).toBeGreaterThan(500);
      expect(p.body).not.toMatch(/claude-seo run|skool\.com|MCP/);
    }
  });

  it('keeps the deprecation rules the model must not violate', () => {
    const core = PLAYBOOKS.find(p => p.id === 'core')!;
    expect(core.body).toMatch(/HowTo/);
    expect(core.body).toMatch(/INP/);
  });
});

describe('selection', () => {
  it('picks focus-appropriate playbooks plus lenses', () => {
    expect(selectAuditPlaybooks('SEO').map(p => p.id)).toEqual(['core', 'technical', 'content', 'schema']);
    expect(selectAuditPlaybooks('AEO', ['local']).map(p => p.id)).toEqual(['core', 'geo', 'schema', 'local']);
  });

  it('attaches at most two playbooks to a chat turn', () => {
    const picks = selectChatPlaybooks('is my FAQ schema still worth it for AI Overviews and does it help my Google Business Profile?');
    expect(picks.length).toBe(2);
    expect(picks[0].id).toBe('geo');
    expect(selectChatPlaybooks('hello there')).toEqual([]);
  });

  it('infers local and ecommerce lenses from the business profile', () => {
    const lenses = inferLenses({ name: 'Bright Smile Dental', mission: '', usp: '', targetAudience: 'families in Austin', competitors: [], perceivedGaps: [], rawContext: 'dental clinic' });
    expect(lenses).toContain('local');
  });
});

describe('playbookContext', () => {
  it('respects the character budget', () => {
    const ctx = playbookContext(selectAuditPlaybooks('SEO'), 3000);
    expect(ctx.length).toBeLessThan(3600);
    expect(ctx).toContain('[SEO METHODOLOGY PLAYBOOKS]');
  });
});
