import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import { plainLanguage, runAllValidators } from '../worker/agentOutputValidators';
import { collectExportPayload, eraseAccountRows } from '../worker/privacyService';
import { exportVisibilityRaw, listRuns, regradeRun, saveRun, sanitizeRun, sharedPassList } from '../worker/visibilityTests';
import { handleVisibilityTestsRoute } from '../worker/visibilityTestsRoute';
import { handleMcpRequest } from '../worker/mcpServer';
import { SESSION_MCP_CREDENTIAL } from '../worker/userTypes';
import { sanitizeSharePayload } from '../worker/shareService';
import { answerStatus, asksByName, buildScorecard, discoveryQuestion, isRefusal, passList, score, statesClaim, statesFact, summarize, tag } from '../services/visibilityTests/scorer';
import { ownKeyQuestions, searchAnswers, snapshotFromPages } from '../services/visibilityTests/client';
import type { ExpectedFacts, RawAnswer, RawVisibilityRun } from '../services/visibilityTests/types';
import { gradedDetailsChanged } from '../components/suite/BusinessDNAView';
import type { BusinessDNA } from '../types';
import { createSqliteD1 } from './helpers/sqliteD1';

vi.mock('../worker/workerUtils', async (original) => ({
  ...(await original<typeof import('../worker/workerUtils')>()),
  identify: vi.fn(async () => ({ user: { id: 'u1', account_id: 'acct-1' } })),
  billingId: vi.fn(() => 'acct-1'),
}));
vi.mock('../worker/quotaMiddleware', async (original) => ({
  ...(await original<typeof import('../worker/quotaMiddleware')>()),
  getActiveSubscription: vi.fn(async () => ({ plan: 'free' })),
}));

const facts: ExpectedFacts = {
  brand: 'Harbour Realty',
  domain: 'harbourrealty.com.au',
  suburb: 'Manly',
  service: 'Real estate',
  keyFacts: ['Open since 2011', '02 9000 1234'],
  bannedClaims: ['cheapest agent'],
  confirmed: true,
};

function answer(over: Partial<RawAnswer> = {}): RawAnswer {
  return {
    id: 'a0',
    kind: 'byok_probe',
    engine: 'openai/gpt-4o-mini',
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    prompt: 'best agent in Manly',
    intent: 'commercial',
    text: 'Harbour Realty in Manly has been open since 2011. Call 02 9000 1234.',
    sources: ['https://www.harbourrealty.com.au/about'],
    inputTokens: 40,
    outputTokens: 60,
    costUsd: 0.00005,
    latencyMs: 900,
    answeredAt: 1000,
    ...over,
  };
}

const snapshot = {
  pages: [{ url: 'https://harbourrealty.com.au', title: 'Harbour Realty', schemaTypes: ['RealEstateAgent'], text: 'Manly agents. Open since 2011. Call 02 9000 1234.' }],
  fetchedAt: 1000,
};

function run(over: Partial<RawVisibilityRun> = {}): RawVisibilityRun {
  return { facts, answers: [answer()], snapshot, ...over };
}

function r2() {
  const store = new Map<string, string>();
  const bucket = {
    store,
    put: vi.fn(async (key: string, body: string) => void store.set(key, body)),
    get: vi.fn(async (key: string) => {
      const body = store.get(key);
      return body === undefined ? null : { json: async () => JSON.parse(body) };
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) store.delete(key);
    }),
  };
  return bucket;
}

function envWith(bucket?: ReturnType<typeof r2>): Env {
  return { DB: createSqliteD1(), AUDIT_EVIDENCE: bucket } as unknown as Env;
}

describe('statesFact', () => {
  it('matches words in any order but digits exactly', () => {
    expect(statesFact('We opened in Manly in 2011, open since then', 'Open since 2011')).toBe(true);
    expect(statesFact('Call (02) 9000-1234 today', '02 9000 1234')).toBe(true);
    expect(statesFact('Open since 2012', 'Open since 2011')).toBe(false);
    expect(statesFact('Call 02 9000 1235', '02 9000 1234')).toBe(false);
  });

  it('needs every number whole, however short', () => {
    expect(statesFact('3 years of experience', '5 years experience')).toBe(false);
    expect(statesFact('15 years of experience', '5 years experience')).toBe(false);
    expect(statesFact('5 years of experience', '5 years experience')).toBe(true);
    expect(statesFact('a 4 star rating', '5 star')).toBe(false);
    expect(statesFact('Call 0290001234', '02 9000 1234')).toBe(true);
  });

  it('does not build a number out of digits scattered through the text', () => {
    expect(statesFact('We did 1500 jobs by 2015', 'Over 500 jobs since 2015')).toBe(false);
  });

  it('keeps numbers that sit together in the fact together in the text', () => {
    expect(statesFact('open 7 days, 24 hour service', 'Open 24/7')).toBe(false);
    expect(statesFact('5 stars rated 4 out of 10', '4.5 stars')).toBe(false);
    expect(statesFact('We are open 24/7', 'Open 24/7')).toBe(true);
    expect(statesFact('Rated 4.5 stars', '4.5 stars')).toBe(true);
    expect(statesFact('120 George St, Level 3', 'Level 3, 120 George St')).toBe(true);
    expect(statesFact('120 George St, Level 4', 'Level 3, 120 George St')).toBe(false);
  });

  it('matches a phone number in either form, and not inside a longer number', () => {
    expect(statesFact('Call 0412 345 678', '+61 412 345 678')).toBe(true);
    expect(statesFact('Call +61 412 345 678', '0412 345 678')).toBe(true);
    expect(statesFact('Call 02 9999 1234', '9999 1234')).toBe(true);
    expect(statesFact('ABN 12 345 699 991 234', '9999 1234')).toBe(false);
    expect(statesFact('Running from 2020-2024', '2020-2024')).toBe(true);
  });

  it('treats +61 as the leading 0', () => {
    expect(statesFact('Call +61 2 9000 1234', '02 9000 1234')).toBe(true);
  });

  it('does not accept words scattered through a long answer', () => {
    expect(statesFact(`best ${'filler '.repeat(20)} west`, 'best west')).toBe(false);
  });

  it('does not match inside a longer word', () => {
    expect(statesFact('The Manlyvale office', 'Manly')).toBe(false);
  });
});

describe('score', () => {
  it('passes every family on a good answer and site', () => {
    const verdicts = score(run());
    expect(verdicts.filter((v) => v.result !== 'pass')).toEqual([]);
    expect(Object.keys(summarize(verdicts).families).sort()).toEqual(['accuracy', 'citation', 'presence', 'structure']);
    expect(summarize(verdicts).score).toBe(1);
    expect(summarize(verdicts).estimated).toBe(false);
  });

  it('does not grade facts when the answer never mentions the business', () => {
    const verdicts = score(run({ answers: [answer({ text: 'Try Coastal Homes.', sources: [] })] }));
    expect(verdicts.find((v) => v.testType === 'brand_named')?.result).toBe('fail');
    const stated = verdicts.filter((v) => v.testType === 'fact_stated');
    expect(stated.length).toBe(3);
    expect(stated.every((v) => v.result === 'not_measured')).toBe(true);
  });

  it('checks nothing on an empty answer, so a banned claim cannot pass on silence', () => {
    const verdicts = score(run({ answers: [answer({ text: '  ', sources: [] })], snapshot: null }));
    expect(verdicts.every((v) => v.result === 'not_measured')).toBe(true);
  });

  it('never calls a search result AI', () => {
    const verdicts = score(run({ answers: [answer({ kind: 'search', text: 'Try Coastal Homes.', sources: [] })], snapshot: null }));
    expect(verdicts.length).toBeGreaterThan(0);
    for (const verdict of verdicts.filter((v) => v.answerId)) expect(`${verdict.label} ${verdict.why}`).not.toMatch(/\bAI\b/);
  });

  it('makes one test from two spellings of a fact, and none from punctuation', () => {
    const verdicts = score(run({ facts: { ...facts, suburb: undefined, keyFacts: ['Sydney', 'SYDNEY!', '!!!'], bannedClaims: ['24/7', '24-7'] }, snapshot: null }));
    const ids = verdicts.map((v) => `${v.testId}/${v.answerId}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(verdicts.filter((v) => v.testType === 'fact_stated').length).toBe(1);
    expect(verdicts.filter((v) => v.testType === 'claim_absent').length).toBe(1);
  });

  it('never counts a name the question already supplied', () => {
    expect(asksByName('"Harbour Realty" harbourrealty.com.au', facts)).toBe(true);
    expect(asksByName('best harbourrealty alternative reviews', facts)).toBe(true);
    expect(asksByName('what is harbourrealty.com.au', facts)).toBe(true);
    expect(asksByName('best Real estate in Manly', facts)).toBe(false);
    expect(asksByName('best plumber in Sydney', { brand: 'Sydney', domain: 'sydney.com.au', suburb: 'Sydney' })).toBe(false);
    const verdicts = score(run({ answers: [answer({ prompt: 'who is Harbour Realty' })], snapshot: null }));
    expect(verdicts.find((v) => v.testType === 'brand_named')?.result).toBe('not_measured');
    expect(verdicts.find((v) => v.testType === 'site_cited')?.result).toBe('not_measured');
    expect(verdicts.find((v) => v.testId === 'fact_stated:open-since-2011')?.result).toBe('pass');
    expect(verdicts[0].tags).toContain(tag('intent', 'by_name'));
  });

  it('builds the discovery question without the name, and only with a service', () => {
    expect(discoveryQuestion('Real estate', 'Manly')).toBe('best Real estate in Manly');
    expect(discoveryQuestion('Plumbing', '')).toBe('best Plumbing near me');
    expect(discoveryQuestion('', 'Manly')).toBeNull();
  });

  it('asks own models one discovery question and one by name', () => {
    expect(ownKeyQuestions(run()).map((q) => q.prompt)).toEqual([
      'best Real estate in Manly',
      'What do you know about Harbour Realty (harbourrealty.com.au)?',
    ]);
  });

  it('spots soft refusals, and keeps a helpful answer that opens with a caveat', () => {
    expect(isRefusal(answer({ text: "I don't have information on harbourrealty.com.au." }))).toBe(true);
    expect(isRefusal(answer({ text: 'Unfortunately I could not find that.' }))).toBe(true);
    expect(isRefusal(answer({ text: "I can't verify prices, but Harbour Realty is a long standing Manly agency." }))).toBe(false);
  });

  it('does not fail a by-name question when the model refuses it', () => {
    const verdicts = score(run({ answers: [answer({ prompt: 'What do you know about Harbour Realty', text: "I don't have information on that." })], snapshot: null }));
    expect(verdicts.every((v) => v.result === 'not_measured')).toBe(true);
  });

  it('never treats a search row as a refusal', () => {
    expect(isRefusal(answer({ kind: 'search', text: 'Unfortunately the best agent is Coastal Homes.' }))).toBe(false);
  });

  it('marks a missing fact on a cut-off answer as not checked', () => {
    const verdicts = score(run({ answers: [answer({ text: 'Harbour Realty in Manly is', finishReason: 'length' })], snapshot: null }));
    expect(verdicts.find((v) => v.testId === 'fact_stated:open-since-2011')?.result).toBe('not_measured');
    expect(verdicts.find((v) => v.testId === 'fact_stated:manly')?.result).toBe('pass');
  });

  it('does not treat a denied claim as stated', () => {
    expect(statesClaim('We are not the cheapest agent', 'cheapest agent')).toBe(false);
    expect(statesClaim('They are never really the cheapest agent', 'cheapest agent')).toBe(false);
    expect(statesClaim('The cheapest agent in town', 'cheapest agent')).toBe(true);
    expect(statesClaim('not the cheapest agent here, but the cheapest agent there', 'cheapest agent')).toBe(true);
    expect(statesClaim('much cheaper than others', 'cheap')).toBe(false);
    expect(statesClaim('We are not cheap. The cheapest agent in town.', 'cheapest agent')).toBe(true);
    expect(statesClaim('Not the cheapest and best agent', 'cheapest agent')).toBe(false);
    expect(statesClaim('rated 4.5 stars', '4.5 stars')).toBe(true);
    expect(statesClaim('Rated No. 1 agent in Sydney', 'No.1 agent')).toBe(true);
    expect(statesClaim('Price from $1.5m', '$1.5m')).toBe(true);
    expect(statesClaim('Smith is Pty. Ltd. registered', 'Pty Ltd registered')).toBe(true);
  });

  it('fails a banned claim', () => {
    const verdicts = score(run({ answers: [answer({ text: 'Harbour Realty is the cheapest agent around.' })] }));
    expect(verdicts.find((v) => v.testType === 'claim_absent')?.result).toBe('fail');
  });

  it('marks a failed call not measured, and a refusal as failed', () => {
    const failed = score(run({ answers: [answer({ text: '', error: 'The call failed' })], snapshot: null }));
    expect(failed.every((v) => v.result === 'not_measured')).toBe(true);
    const refused = answer({ text: "I'm sorry, I can't help with that." });
    expect(isRefusal(refused)).toBe(true);
    expect(answerStatus(refused)).toBe('refused');
    const verdicts = score(run({ answers: [refused], snapshot: null })).filter((v) => v.answerId);
    expect(verdicts.filter((v) => v.family === 'accuracy').every((v) => v.result === 'not_measured')).toBe(true);
    expect(verdicts.filter((v) => v.family !== 'accuracy').every((v) => v.result === 'fail')).toBe(true);
  });

  it('does not read a long helpful answer that opens with sorry as a refusal', () => {
    expect(isRefusal(answer({ text: `Sorry, here is the list. ${'Harbour Realty is great. '.repeat(30)}` }))).toBe(false);
  });

  it('never fails the website when it could not be read', () => {
    const verdicts = score(run({ answers: [], snapshot: null }));
    expect(verdicts.length).toBeGreaterThan(0);
    expect(verdicts.every((v) => v.result === 'not_measured')).toBe(true);
    expect(summarize(verdicts).score).toBeNull();
  });

  it('reads as Estimated until the owner confirms the facts', () => {
    const verdicts = score(run({ facts: { ...facts, confirmed: false } }));
    expect(verdicts.every((v) => v.derivation === 'site_estimated')).toBe(true);
    expect(summarize(verdicts).estimated).toBe(true);
  });

  it('weights each family equally, however many tests it has', () => {
    const verdicts = [
      { family: 'presence', result: 'pass', answerId: 'a', derivation: 'dna_confirmed' },
      ...Array.from({ length: 9 }, () => ({ family: 'accuracy', result: 'fail', answerId: 'a', derivation: 'dna_confirmed' })),
    ] as Parameters<typeof summarize>[0];
    expect(summarize(verdicts).score).toBe(0.5);
  });

  it('tags slice results and never change a verdict', () => {
    const verdicts = score(run());
    const sliced = verdicts.filter((v) => v.tags.includes(tag('suburb', 'manly')));
    expect(sliced.length).toBeGreaterThan(0);
    expect(sliced.every((v) => v.result === 'pass')).toBe(true);
    expect(verdicts.filter((v) => v.tags.includes(tag('engine', 'nobody')))).toEqual([]);
  });

  it('writes every reason in plain words that pass the honesty validators', () => {
    const verdicts = [
      ...score(run()),
      ...score(run({ answers: [answer({ text: 'Try Coastal Homes.', sources: [] })], snapshot: { ...snapshot, pages: [{ ...snapshot.pages[0], schemaTypes: [], text: '' }] } })),
      ...score(run({ answers: [answer({ error: 'x', text: '' }), answer({ text: "I can't help." })], snapshot: null })),
    ];
    for (const verdict of verdicts) {
      expect(plainLanguage(`${verdict.label} ${verdict.why}`)).toEqual([]);
      expect(runAllValidators(verdict.why).ok).toBe(true);
      expect(verdict.why).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe('plainLanguage', () => {
  it('flags jargon and leaves ordinary words alone', () => {
    expect(plainLanguage('Add JSON-LD schema').length).toBe(2);
    expect(plainLanguage('A geographic market on your website')).toEqual([]);
  });
});

describe('search answers and snapshots', () => {
  it('groups rows by question and drops sample rows', () => {
    const rows = [
      { query: 'best agent', engine: 'tavily', title: 'One', url: 'https://a.com', snippet: 'A', brandMentioned: false },
      { query: 'best agent', engine: 'tavily', title: 'Two', url: 'https://b.com', snippet: 'B', brandMentioned: false },
      { query: 'x vs y', engine: 'tavily', title: 'Sample', url: 'https://c.com', snippet: 'C', brandMentioned: false, sample: true },
    ] as Parameters<typeof searchAnswers>[0];
    const answers = searchAnswers(rows, 5);
    expect(answers.length).toBe(1);
    expect(answers[0].sources).toEqual(['https://a.com', 'https://b.com']);
    expect(answers[0].intent).toBe('commercial');
    expect(answers[0].costUsd).toBeNull();
  });

  it('reads a fact that only sits in valid page labels, and ignores broken labels', () => {
    const page = {
      url: 'https://a.com', title: 'A', h1s: [], wordCount: 1, rawTextSnippet: 'Hello',
      schemasFound: [
        { type: 'LocalBusiness', rawJson: '{"telephone":"02 9000 1234"}', isValid: true },
        { type: 'Organization', rawJson: '{', isValid: false },
      ],
    } as unknown as Parameters<typeof snapshotFromPages>[0][number];
    const made = snapshotFromPages([page], 5);
    expect(made?.pages[0].schemaTypes).toEqual(['LocalBusiness']);
    expect(statesFact(made?.pages[0].text ?? '', '02 9000 1234')).toBe(true);
  });
});

describe('confirmed facts', () => {
  const dna = { name: 'Harbour', suburb: 'Manly', keyFacts: ['Open since 2011'] } as BusinessDNA;

  it('counts a change to anything the checks grade', () => {
    expect(gradedDetailsChanged(dna, { ...dna, mission: 'New words' })).toBe(false);
    expect(gradedDetailsChanged(dna, { ...dna, suburb: 'Bondi' })).toBe(true);
    expect(gradedDetailsChanged(dna, { ...dna, keyFacts: ['Open since 2012'] })).toBe(true);
  });
});

describe('sanitizeRun', () => {
  it('rebuilds ids and keeps only web links', () => {
    const checked = sanitizeRun({
      facts,
      answers: [{ ...answer({ id: 'attacker' }), sources: ['javascript:alert(1)', 'https://ok.com'], costUsd: -3, surprise: 1 }],
    }, 5);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.run.answers[0].id).toBe('a0');
    expect(checked.run.answers[0].sources).toEqual(['https://ok.com']);
    expect(checked.run.answers[0].costUsd).toBeNull();
    expect(checked.run.answers[0]).not.toHaveProperty('surprise');
  });

  it('refuses an empty run and too many answers', () => {
    expect(sanitizeRun({ facts, answers: [] }, 5).ok).toBe(false);
    expect(sanitizeRun({ facts, answers: Array(16).fill(answer()) }, 5).ok).toBe(false);
    expect(sanitizeRun({ facts: {}, answers: [answer()] }, 5).ok).toBe(false);
  });
});

describe('saving and regrading', () => {
  it('keeps raw private and regrades with no provider call', async () => {
    const bucket = r2();
    const env = envWith(bucket);
    const saved = await saveRun(env, 'acct-1', run(), 1000, 'agency');
    expect(saved.run.canRegrade).toBe(true);
    expect([...bucket.store.keys()]).toEqual([`visibility-raw/${saved.run.id}.json`]);

    const row = await env.DB!.prepare(`SELECT * FROM visibility_test_runs WHERE id = ?`).bind(saved.run.id).first<never>();
    const regraded = await regradeRun(env, row, { ...facts, keyFacts: ['Open since 1999'], suburb: undefined }, 2000);
    expect(regraded?.verdicts.find((v) => v.testType === 'fact_stated')?.result).toBe('fail');
    expect(regraded?.run.gradedAt).toBe(2000);

    const rows = await env.DB!.prepare(`SELECT result FROM visibility_test_verdicts WHERE run_id = ? AND test_type = 'fact_stated'`).bind(saved.run.id).all();
    expect(rows.results).toEqual([{ result: 'fail' }]);
    expect(JSON.parse(bucket.store.get(`visibility-raw/${saved.run.id}.json`)!).facts.keyFacts).toEqual(['Open since 1999']);
  });

  it('saves verdicts without a bucket and says a regrade is not possible', async () => {
    const env = envWith();
    const saved = await saveRun(env, 'acct-1', run(), 1000, 'agency');
    expect(saved.run.canRegrade).toBe(false);
    const res = await handleVisibilityTestsRoute(
      new Request(`https://x/visibility-tests/runs/${saved.run.id}/regrade`, { method: 'POST', body: '{}' }),
      env,
      `/visibility-tests/runs/${saved.run.id}/regrade`,
    );
    expect(res.status).toBe(409);
  });

  it('keeps verdicts when the raw write fails, as a run that cannot be regraded', async () => {
    const bucket = r2();
    bucket.put.mockRejectedValueOnce(new Error('r2 down'));
    const saved = await saveRun(envWith(bucket), 'acct-1', run(), 1000, 'agency');
    expect(saved.run.canRegrade).toBe(false);
    expect(saved.verdicts.length).toBeGreaterThan(0);
  });

  it('reports a saved run as saved when pruning fails', async () => {
    const bucket = r2();
    const env = envWith(bucket);
    for (let i = 0; i < 5; i += 1) await saveRun(env, 'acct-1', run(), 1000 + i, 'free');
    const prepare = env.DB!.prepare.bind(env.DB);
    vi.spyOn(env.DB!, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('LIMIT ? OFFSET ?')) throw new Error('d1 busy');
      return prepare(sql);
    });
    await expect(saveRun(env, 'acct-1', run(), 2000, 'free')).resolves.toBeTruthy();
  });

  it('refuses a run on another account', async () => {
    const env = envWith(r2());
    const saved = await saveRun(env, 'acct-other', run(), 1000, 'agency');
    const path = `/visibility-tests/runs/${saved.run.id}`;
    expect((await handleVisibilityTestsRoute(new Request(`https://x${path}`), env, path)).status).toBe(404);
  });

  it('prunes past the plan depth, raw first', async () => {
    const bucket = r2();
    const env = envWith(bucket);
    for (let i = 0; i < 7; i += 1) await saveRun(env, 'acct-1', run(), 1000 + i, 'free');
    const runs = await listRuns(env, 'acct-1', '', 50);
    expect(runs.length).toBe(5);
    expect(bucket.store.size).toBe(5);
    const orphans = await env.DB!.prepare(
      `SELECT COUNT(*) AS n FROM visibility_test_verdicts WHERE run_id NOT IN (SELECT id FROM visibility_test_runs)`,
    ).first<{ n: number }>();
    expect(orphans?.n).toBe(0);
  });

  it('never lets own-model runs push out an audit', async () => {
    const bucket = r2();
    const env = envWith(bucket);
    const audit = await saveRun(env, 'acct-1', run(), 1000, 'free');
    for (let i = 0; i < 7; i += 1) await saveRun(env, 'acct-1', run({ snapshot: null }), 2000 + i, 'free');
    expect((await listRuns(env, 'acct-1', '', 1, 'audit')).map((r) => r.id)).toEqual([audit.run.id]);
    expect((await listRuns(env, 'acct-1', '', 50)).length).toBe(6);
  });

  it('keeps the row when the raw delete fails, so the next save retries', async () => {
    const bucket = r2();
    const env = envWith(bucket);
    for (let i = 0; i < 5; i += 1) await saveRun(env, 'acct-1', run(), 1000 + i, 'free');
    bucket.delete.mockRejectedValueOnce(new Error('r2 down'));
    await saveRun(env, 'acct-1', run(), 2000, 'free');
    expect((await listRuns(env, 'acct-1', '', 50)).length).toBe(6);
    await saveRun(env, 'acct-1', run(), 3000, 'free');
    expect((await listRuns(env, 'acct-1', '', 50)).length).toBe(5);
  });

  it('over MCP, a run is found only for its own domain', async () => {
    const env = envWith(r2());
    const saved = await saveRun(env, 'acct-1', run(), 1000, 'agency');
    const call = async (args: Record<string, unknown>) => {
      const res = await handleMcpRequest(
        new Request('https://luminarasuite.com/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_visibility_test', arguments: args } }),
        }),
        env,
        { id: 'acct-1', source: 'firebase', accountId: 'acct-1' } as never,
        SESSION_MCP_CREDENTIAL,
      );
      return ((await res.json()) as { result?: { isError?: boolean; content?: Array<{ text: string }> } }).result;
    };
    expect((await call({ runId: saved.run.id, domain: 'other-site.com' }))?.isError).toBe(true);
    const own = await call({ runId: saved.run.id, domain: 'https://www.harbourrealty.com.au/' });
    expect(own?.isError).toBeFalsy();
    expect(own?.content?.[0]?.text).toContain('[');
  });
});

describe('provider scorecard', () => {
  it('counts a refusal as failed tests and an error as nothing measured', () => {
    const rows = buildScorecard(
      [
        { id: '1', provider: 'p', model: 'm', status: 'ok', cost_usd: 0.01, latency_ms: 100 },
        { id: '2', provider: 'p', model: 'm', status: 'refused', cost_usd: null, latency_ms: 300 },
        { id: '3', provider: 'p', model: 'm', status: 'error', cost_usd: null, latency_ms: null },
      ],
      [
        { answer_id: '1', family: 'presence', result: 'pass' },
        { answer_id: '2', family: 'presence', result: 'fail' },
        { answer_id: '3', family: 'presence', result: 'not_measured' },
      ],
    );
    expect(rows).toEqual([{
      provider: 'p', model: 'm', answers: 3, refusals: 1, errors: 1, score: 0.5, tests: 2, passed: 1,
      costUsd: 0.01, costUnknown: 2, averageLatencyMs: 200,
    }]);
  });

  it('counts checks passed, not the family mean', () => {
    const [row] = buildScorecard(
      [{ id: '1', provider: 'p', model: 'm', status: 'ok', cost_usd: null, latency_ms: null }],
      [
        { answer_id: '1', family: 'presence', result: 'pass' },
        ...Array.from({ length: 9 }, () => ({ answer_id: '1', family: 'accuracy' as const, result: 'fail' as const })),
      ],
    );
    expect(row.score).toBe(0.5);
    expect(row.passed).toBe(1);
    expect(row.tests).toBe(10);
  });

  it('reads own-model answers only, through the route', async () => {
    const env = envWith(r2());
    await saveRun(env, 'acct-1', run({ answers: [answer(), answer({ id: 'a1', kind: 'search', provider: 'search', model: 'tavily' })] }), 1000, 'agency');
    const path = '/visibility-tests/scorecard';
    const res = await handleVisibilityTestsRoute(new Request(`https://x${path}?domain=harbourrealty.com.au`), env, path);
    const body = await res.json() as { scorecard: Array<{ provider: string; answers: number; score: number }> };
    expect(body.scorecard.map((row) => row.provider)).toEqual(['openrouter']);
    expect(body.scorecard[0].score).toBe(1);
  });
});

describe('sharing and privacy', () => {
  it('shows only labels that never failed, and no reasons or answers', () => {
    const list = passList([
      { label: 'AI names you', result: 'pass', testType: 'brand_named' },
      { label: 'AI names you', result: 'fail', testType: 'brand_named' },
      { label: 'AI points to you', result: 'pass', testType: 'site_cited' },
      { label: 'Not checked', result: 'not_measured', testType: 'site_cited' },
      { label: 'AI does not say: we were sued', result: 'pass', testType: 'claim_absent' },
      { label: 'AI says: 02 9000 1234', result: 'pass', testType: 'fact_stated' },
      { label: 'Your website says: 02 9000 1234', result: 'pass', testType: 'site_states_fact' },
    ]);
    expect(list).toEqual(['AI points to you']);
    expect(sanitizeSharePayload({ visibilityPassList: list })).toEqual({ visibilityPassList: list });
  });

  it('builds the pass list from the account\'s own rows, never from what a client sends', async () => {
    const env = envWith(r2());
    const saved = await saveRun(env, 'acct-1', run(), 1000, 'agency');
    const list = await sharedPassList(env, 'acct-1', saved.run.id, 'harbourrealty.com.au');
    expect(list).toContain('Your website tells AI what kind of business you are');
    expect(list?.join(' ')).not.toContain('AI names');
    expect(list?.join(' ')).not.toContain('cheapest');
    expect(await sharedPassList(env, 'acct-2', saved.run.id, 'harbourrealty.com.au')).toBeUndefined();
    const broken = { DB: { prepare: () => { throw new Error('no such table'); } } } as unknown as Env;
    expect(await sharedPassList(broken, 'acct-1', saved.run.id, 'harbourrealty.com.au')).toBeUndefined();
  });

  it('never puts one site\'s passes on another site\'s shared report', async () => {
    const env = envWith(r2());
    const saved = await saveRun(env, 'acct-1', run(), 1000, 'agency');
    expect(await sharedPassList(env, 'acct-1', saved.run.id, 'other-site.com')).toBeUndefined();
    expect(await sharedPassList(env, 'acct-1', saved.run.id, '')).toBeUndefined();
  });

  it('treats a model answer as a model answer whatever the client calls it, and drops an absurd cost', () => {
    const sanitized = sanitizeRun({
      facts,
      answers: [answer({ kind: 'search', provider: 'openrouter', costUsd: 900 }), answer({ costUsd: 0.002 })],
      snapshot,
    }, 1000);
    if (!sanitized.ok) throw new Error(sanitized.error);
    expect(sanitized.run.answers.map((a) => a.kind)).toEqual(['byok_probe', 'byok_probe']);
    expect(sanitized.run.answers.map((a) => a.costUsd)).toEqual([null, 0.002]);
  });

  it('stops a daily flood of saves', async () => {
    const counters = new Map<string, string>();
    const env = { ...envWith(r2()), LUMINARA_KV: {
      get: async (key: string) => counters.get(key) ?? null,
      put: async (key: string, value: string) => void counters.set(key, value),
    } } as unknown as Env;
    const post = () => handleVisibilityTestsRoute(
      new Request('https://x/visibility-tests/runs', { method: 'POST', body: JSON.stringify({ facts, answers: [answer()] }) }),
      env,
      '/visibility-tests/runs',
    );
    counters.set(`visibility_run:acct-1:${new Date().toISOString().slice(0, 10)}`, '30');
    expect((await post()).status).toBe(429);
  });

  it('keeps an export small enough to store', async () => {
    const bucket = r2();
    const env = envWith(bucket);
    const big = 'x'.repeat(4_000_000);
    for (let i = 0; i < 4; i += 1) {
      const saved = await saveRun(env, 'acct-1', run(), 1000 + i, 'agency');
      bucket.store.set(`visibility-raw/${saved.run.id}.json`, JSON.stringify({ big }));
    }
    const exported = await exportVisibilityRaw(env, 'acct-1');
    expect(exported.records).toHaveLength(2);
    expect(exported.omitted).toBe(2);
  });

  it('never returns raw text from the run route', async () => {
    const env = envWith(r2());
    const saved = await saveRun(env, 'acct-1', run(), 1000, 'agency');
    const path = `/visibility-tests/runs/${saved.run.id}`;
    const body = await (await handleVisibilityTestsRoute(new Request(`https://x${path}`), env, path)).text();
    expect(body).not.toContain('Call 02 9000 1234');
  });

  it('exports raw records and erases them before their rows', async () => {
    const bucket = r2();
    const env = envWith(bucket);
    await saveRun(env, 'acct-1', run(), 1000, 'agency');
    const exported = await collectExportPayload(env, 'acct-1') as unknown as Record<string, unknown[]>;
    expect(exported.visibilityTestRuns).toHaveLength(1);
    expect(exported.visibilityTestRawRecords).toHaveLength(1);

    await eraseAccountRows(env, 'acct-1');
    expect(bucket.store.size).toBe(0);
    expect((await listRuns(env, 'acct-1', '', 50)).length).toBe(0);
  });

  it('stops the erase when raw records cannot be removed, so a retry finds them', async () => {
    const bucket = r2();
    const env = envWith(bucket);
    await saveRun(env, 'acct-1', run(), 1000, 'agency');
    bucket.delete.mockRejectedValueOnce(new Error('r2 down'));
    await expect(eraseAccountRows(env, 'acct-1')).rejects.toThrow('r2 down');
    expect((await listRuns(env, 'acct-1', '', 50)).length).toBe(1);
  });

  it('still erases the rows when no bucket is bound, and logs the raw keys for an operator', async () => {
    const env = envWith(r2());
    const saved = await saveRun(env, 'acct-1', run(), 1000, 'agency');
    const unbound = { ...env, AUDIT_EVIDENCE: undefined } as unknown as Env;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await eraseAccountRows(unbound, 'acct-1');
    expect((await listRuns(env, 'acct-1', '', 50)).length).toBe(0);
    expect(logged.mock.calls.flat().join(' ')).toContain(saved.run.id);
    logged.mockRestore();
  });
});
