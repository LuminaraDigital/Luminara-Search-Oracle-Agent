import { describe, expect, it } from 'vitest';
import { generatePostCandidates, predictWinner, reflectPostingPlaybook } from '../services/rsi/postingAgent';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { handleRsiRoute } from '../worker/rsiRoutes';

const user = { id: 'acct_post', accountId: 'acct_post' } as HostedIdentity;

function envFor(): Env {
  return { DB: createSqliteD1() } as unknown as Env;
}

async function post(env: Env, path: string, body: unknown) {
  return handleRsiRoute(
    new Request(`https://luminarasuite.com/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
    user,
    path,
  );
}

describe('posting agent', () => {
  it('drafts 3 to 5 posts and does not pretend to know a winner without measured history', () => {
    const candidates = generatePostCandidates({ brandName: 'Luminara', offer: 'an audit', audience: 'founders', count: 5 });
    expect(candidates).toHaveLength(5);
    expect(generatePostCandidates({ brandName: 'Luminara', offer: 'an audit', audience: 'founders' })).toHaveLength(4);
    const cold = predictWinner(candidates, []);
    expect(cold.prediction).toBe('not_measured');
    expect(cold.evidence).toBe('not_measured');
    const pinned = reflectPostingPlaybook({
      brandName: 'Luminara',
      history: [],
      currentBody: '# Pinned\n\n## Evidence\nkeep',
      pinned: true,
      editsThisWeek: 0,
      evidenceRef: 'reflection:2026-W02',
    });
    expect(pinned.added).toEqual([]);
    expect(pinned.reason).toContain('Pinned');
  });

  it('selects one post, ingests 72h metrics, and adds a pattern only after two measured successes', async () => {
    const env = envFor();
    const scores = [1, 2, 3, 8, 9];
    const ids: string[] = [];
    for (let i = 0; i < scores.length; i++) {
      const drafted = await post(env, '/rsi/posts/draft', {
        brandId: 'luminara',
        brandName: 'Luminara',
        offer: 'a citation audit',
        audience: 'founders',
        sourceRefs: [`brief-${i}`],
      });
      const body = (await drafted!.json()) as { postId: string; candidates: unknown[]; prediction: string };
      expect(body.candidates).toHaveLength(4);
      if (i < 3) expect(body.prediction).toBe('not_measured');
      ids.push(body.postId);
      const early = await post(env, `/rsi/posts/${body.postId}/metrics`, {
        horizon: '24h',
        measurementStatus: 'not_measured',
        impressions: 10,
        engagements: 1,
      });
      expect(early!.status).toBe(400);
      const metric = await post(env, `/rsi/posts/${body.postId}/metrics`, {
        horizon: '72h',
        measurementStatus: 'measured',
        impressions: 100,
        engagements: scores[i],
      });
      expect(metric!.status).toBe(200);
    }
    const reflected = await post(env, '/rsi/posts/reflect', { brandId: 'luminara', brandName: 'Luminara' });
    const playbook = (await reflected!.json()) as { applied: boolean; added: string[] };
    expect(playbook.applied).toBe(true);
    expect(playbook.added[0]).toContain('Pattern question');
    const again = await post(env, '/rsi/posts/reflect', { brandId: 'luminara', brandName: 'Luminara' });
    const held = (await again!.json()) as { applied: boolean; added: string[] };
    expect(held.added).toEqual([]);
    expect(held.applied).toBe(false);
  });
});
