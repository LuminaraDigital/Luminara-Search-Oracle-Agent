import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_SNIPPET,
  GEMINI_MODEL,
  GEMINI_URL,
  JEV_URL,
  capturesToFiles,
  decide,
  geminiBody,
  markingFiles,
  parseCsv,
  probe,
  replay,
  summarize,
  validAnswers,
} from '../scripts/decision-probe.mjs';

/**
 * scripts/decision-probe.mjs (Track GD, docs/plans/gemini-decision-shadow.md). No test calls
 * Google or TypeSafe: every network call goes through a fake fetch.
 */

type Json = Record<string, any>;

const QUESTIONS: Json = {
  finding_0: { type: 'noul', instructions: 'Is this finding supported by the evidence? No llms.txt file.' },
  finding_1: { type: 'noul', instructions: 'Is this finding supported by the evidence? No Organization schema.' },
  site_type: { type: 'choice', instructions: 'What kind of site is this?', criteria: { real_estate_agency: 'An agency', other: 'None of those' } },
};
const STATE: Json = {
  pages: [{ url: 'https://example-realty.test/', status: 200, excerpt: 'Example Realty, "Brighton" sales' }],
  files: [{ url: 'https://example-realty.test/llms.txt', status: 404, excerpt: 'Not found' }],
};
const REQUEST: Json = { model: 'jev-latest', state: STATE, questions: QUESTIONS };

const noul = (p: number) => ({ type: 'noul', noul: p, confidence: Math.max(p, 1 - p) });
const choice = (c: string) => ({ type: 'choice', choice: c, confidence: 0.9, probabilities: { [c]: 0.9 } });
const answers = (f0: number, f1: number, site = 'real_estate_agency'): Json => ({ finding_0: noul(f0), finding_1: noul(f1), site_type: choice(site) });

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('validAnswers', () => {
  it('accepts an answer for every question asked', () => {
    const good = answers(0.9, 0.2);
    expect(validAnswers(QUESTIONS, good)).toBe(good);
  });

  it('accepts a Jev-style yes/no answer, which has no confidence field', () => {
    const jevStyle = { ...answers(0.9, 0.2), finding_0: { type: 'noul', noul: 0.65 } };
    expect(validAnswers(QUESTIONS, jevStyle)).toBe(jevStyle);
  });

  it.each([
    ['an extra key', { ...answers(0.9, 0.2), brand_pick: choice('x') }],
    ['a missing key', { finding_0: noul(0.9), site_type: choice('other') }],
    ['a wrong type', { ...answers(0.9, 0.2), finding_1: choice('other') }],
    ['a probability over 1', { ...answers(0.9, 0.2), finding_0: noul(1.2) }],
    ['an option not offered', { ...answers(0.9, 0.2), site_type: choice('developer') }],
    ['a pick with no confidence', { ...answers(0.9, 0.2), site_type: { type: 'choice', choice: 'other' } }],
    ['no answers at all', undefined],
  ])('rejects %s', (_label, given) => {
    expect(validAnswers(QUESTIONS, given)).toBeNull();
  });

  it('checks a rubric score against the number of levels and rejects unknown question types', () => {
    const rubric = { clarity: { type: 'score', instructions: 'How clear?', criteria: ['No', 'Partly', 'Yes'] } };
    expect(validAnswers(rubric, { clarity: { type: 'score', score: 1.4, confidence: 0.7 } })).not.toBeNull();
    expect(validAnswers(rubric, { clarity: { type: 'score', score: 2.5, confidence: 0.7 } })).toBeNull();
    expect(validAnswers({ q: { type: 'rank', instructions: 'x' } }, { q: { type: 'rank', confidence: 1 } })).toBeNull();
  });
});

describe('geminiBody', () => {
  it('sends the same questions, the state as one text input, and the Gemini model', () => {
    expect(geminiBody(REQUEST)).toEqual({ model: GEMINI_MODEL, input: JSON.stringify(STATE), questions: QUESTIONS });
  });
});

describe('capture and save', () => {
  it('copies the Jev body and response, nothing else, and leaves other calls alone', async () => {
    const fakeWindow: Json = { fetch: vi.fn(async () => jsonResponse({ model: 'jev-1.14.0', answers: answers(0.9, 0.2) })) };
    const install = new Function('window', `return ${CAPTURE_SNIPPET}`);
    expect(install(fakeWindow)).toBe('installed');
    expect(install(fakeWindow)).toBe('already installed');

    await fakeWindow.fetch('https://staging.test/api/providers/groq/v1/chat/completions', { method: 'POST', body: '{"x":1}' });
    const res = await fakeWindow.fetch('https://staging.test/api/providers/typesafe/v1/systemone', {
      method: 'POST',
      headers: { authorization: 'Bearer secret-token' },
      body: JSON.stringify(REQUEST),
    });
    expect((await res.json()).model).toBe('jev-1.14.0');

    await vi.waitFor(() => expect(fakeWindow.__gdCaptures[0].jev).not.toBeNull());
    expect(fakeWindow.__gdCaptures).toHaveLength(1);
    expect(fakeWindow.__gdCaptures[0].request).toEqual(REQUEST);
    expect(fakeWindow.__gdCaptures[0].jev.status).toBe(200);
    expect(JSON.stringify(fakeWindow.__gdCaptures)).not.toContain('secret-token');
  });

  it('keeps the last capture of a retried body and skips captures without state', () => {
    const files = capturesToFiles([
      { request: REQUEST, jev: null },
      { request: { model: 'jev-latest', questions: QUESTIONS }, jev: null },
      { request: REQUEST, jev: { status: 200, body: { answers: answers(0.9, 0.2) } } },
    ]);
    expect(files).toHaveLength(1);
    expect(files[0].id).toMatch(/^example-realty\.test-[0-9a-f]{10}$/);
    expect(files[0].file.jev.status).toBe(200);
  });
});

function lines(count: number, gemini: (i: number) => Json, options: { invalidGemini?: number[]; slow?: number[]; noJev?: number[] } = {}) {
  const out: Json[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `req-${i}`;
    const gemValid = !options.invalidGemini?.includes(i);
    out.push({ request_id: id, provider: 'gemini', ms: options.slow?.includes(i) ? 1800 : 400, valid: gemValid, answers: gemValid ? gemini(i) : null });
    const jevValid = !options.noJev?.includes(i);
    out.push({ request_id: id, provider: 'jev', ms: null, valid: jevValid, answers: jevValid ? answers(0.9, 0.2) : null });
  }
  return out;
}

const requestsFor = (count: number) => new Map(Array.from({ length: count }, (_, i) => [`req-${i}`, REQUEST]));

/** Marks every row: `jevRight(index)` says whether the marker sided with Jev on that row. */
function marked(summary: Json, count: number, jevRight: (index: number) => boolean | 'cannot tell') {
  const { csv, key } = markingFiles(summary.disagreements, requestsFor(count), () => 0.3);
  const rows = parseCsv(csv);
  key.rows.forEach((row: Json, index: number) => {
    const verdict = jevRight(index);
    const disagreement = summary.disagreements.find((d: Json) => d.requestId === row.request_id && d.key === row.question_key);
    const mark = verdict === 'cannot tell' ? verdict : verdict === disagreement.jevSupported ? 'supported' : 'not supported';
    rows[index + 1][6] = mark;
  });
  return { rows, key };
}

describe('summarize', () => {
  it('counts pairs, findings compared, disagreements and other differences', () => {
    const summary = summarize(lines(4, (i) => (i === 0 ? answers(0.3, 0.2, 'other') : answers(0.9, 0.59)), { noJev: [3], slow: [1] }));
    expect(summary).toMatchObject({ R: 4, geminiValid: 4, geminiSlow: 1, P: 3, noJev: 1, Q: 6, D: 1, otherDiffs: { site_type: 1 } });
    expect(summary.disagreements).toEqual([{ requestId: 'req-0', key: 'finding_0', jevSupported: true }]);
  });
});

describe('decide (plan section 5)', () => {
  const tenDisagreements = (i: number) => (i < 10 ? answers(0.3, 0.2) : answers(0.9, 0.2));

  it('is good enough when Gemini is wrong no more than Jev plus 2', () => {
    const summary = summarize(lines(25, tenDisagreements));
    const { rows, key } = marked(summary, 25, (i) => i < 6);
    const result = decide(summary, rows, key);
    expect(result.outcome).toBe('good enough');
    expect(result.counts).toMatchObject({ P: 25, Q: 50, D: 10, M: 10, G: 6, J: 4 });
    expect(result.clearlyBetter).toBe(false);
  });

  it('does nothing when Gemini is wrong more often', () => {
    const summary = summarize(lines(25, tenDisagreements));
    const { rows, key } = marked(summary, 25, (i) => i < 8);
    expect(decide(summary, rows, key).outcome).toBe('do nothing');
  });

  it('judges availability first: two failed Gemini calls mean do nothing even with few pairs', () => {
    const summary = summarize(lines(15, () => answers(0.9, 0.2), { invalidGemini: [0, 1] }));
    const { rows, key } = marked(summary, 15, () => true);
    expect(decide(summary, rows, key)).toMatchObject({ outcome: 'do nothing' });
  });

  it('is inconclusive with fewer than 20 pairs', () => {
    const summary = summarize(lines(18, () => answers(0.9, 0.2)));
    const { rows, key } = marked(summary, 18, () => true);
    expect(decide(summary, rows, key).outcome).toBe('inconclusive');
  });

  it('is inconclusive when more than a third of rows are cannot tell', () => {
    const summary = summarize(lines(25, tenDisagreements));
    const { rows, key } = marked(summary, 25, (i) => (i < 4 ? 'cannot tell' : true));
    expect(decide(summary, rows, key).outcome).toBe('inconclusive');
  });

  it('with few marked rows, needs at least 100 questions and disagreement at most 10%', () => {
    const fourFindings = (f: number) => ({ ...answers(f, 0.2), finding_2: noul(0.9), finding_3: noul(0.9) });
    const wide = (count: number, disagreeing: number) => {
      const out = lines(count, (i) => fourFindings(i < disagreeing ? 0.3 : 0.9));
      for (const line of out) if (line.provider === 'jev') line.answers = fourFindings(0.9);
      return summarize(out);
    };
    const enough = wide(25, 4);
    expect(enough).toMatchObject({ Q: 100, D: 4 });
    const even = marked(enough, 25, (i) => i < 2);
    expect(decide(enough, even.rows, even.key).outcome).toBe('good enough');
    const allGeminiWrong = marked(enough, 25, () => true);
    expect(decide(enough, allGeminiWrong.rows, allGeminiWrong.key).outcome).toBe('do nothing');
    const narrow = summarize(lines(25, (i) => (i < 3 ? answers(0.3, 0.2) : answers(0.9, 0.2))));
    const few = marked(narrow, 25, () => false);
    expect(decide(narrow, few.rows, few.key).outcome).toBe('inconclusive');
  });

  it('refuses a sheet with an unmarked row, naming it', () => {
    const summary = summarize(lines(25, tenDisagreements));
    const { rows, key } = marked(summary, 25, () => true);
    rows[3][6] = '';
    expect(() => decide(summary, rows, key)).toThrow(/r03/);
  });

  it('reads a sheet saved by Excel: byte-order mark, quoted commas and quotes', () => {
    const saved = `${String.fromCharCode(0xfeff)}row_id,claim,mark\r\nr01,"No ""llms.txt"", page 2",Supported\r\n`;
    expect(parseCsv(saved)).toEqual([['row_id', 'claim', 'mark'], ['r01', 'No "llms.txt", page 2', 'Supported']]);
  });

  it('samples 40 rows when there are more disagreements and says so', () => {
    const summary = summarize(lines(50, () => answers(0.3, 0.2)));
    const { key, csv } = markingFiles(summary.disagreements, requestsFor(50));
    expect(key).toMatchObject({ disagreements: 50, sampled: 40 });
    expect(parseCsv(csv)).toHaveLength(41);
  });
});

describe('probe and replay with a fake network', () => {
  const geminiReply = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ answers: answers(0.3, 0.2) }));

  function fakeFetch(seen: Json[]) {
    return vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(String(init.body)) });
      if (url === GEMINI_URL) return geminiReply(url, init);
      if (url === JEV_URL) return jsonResponse({ model: 'jev-1.14.0', answers: answers(0.9, 0.2) });
      return jsonResponse({}, 404);
    });
  }

  function workDir() {
    const dir = mkdtempSync(join(tmpdir(), 'gd-replay-'));
    mkdirSync(join(dir, 'requests'));
    writeFileSync(join(dir, 'requests', 'a.json'), JSON.stringify({ request: REQUEST, jev: { status: 200, body: { model: 'jev-1.14.0', answers: answers(0.9, 0.2) } } }));
    writeFileSync(join(dir, 'requests', 'b.json'), JSON.stringify({ request: REQUEST, jev: null }));
    return dir;
  }

  it('probe passes on a valid answer and never prints the key', async () => {
    const out: string[] = [];
    const seen: Json[] = [];
    geminiReply.mockImplementationOnce(async () => jsonResponse({ answers: { finding_0: noul(0.8), site_type: choice('other'), clarity: { type: 'score', score: 1.6, confidence: 0.7 } } }));
    expect(await probe({ GEMINI_API_KEY: 'g-key' }, fakeFetch(seen), (line: string) => out.push(line))).toBe(true);
    expect(seen).toHaveLength(3);
    expect(seen[0].headers['x-goog-api-key']).toBe('g-key');
    expect(Object.values(seen[0].body.questions).map((q: any) => q.type)).toEqual(['noul', 'choice', 'score']);
    expect(out.join('\n')).not.toContain('g-key');
  });

  it('replay uses captured Jev answers, calls Jev directly only when needed, and writes no key', async () => {
    const dir = workDir();
    const seen: Json[] = [];
    await replay(dir, { GEMINI_API_KEY: 'g-key', TYPESAFE_API_KEY: 't-key' }, fakeFetch(seen), () => {});

    expect(seen.map((call) => call.url)).toEqual([GEMINI_URL, GEMINI_URL, JEV_URL]);
    expect(seen[0].body).toEqual(geminiBody(REQUEST));
    expect(seen[2].headers.authorization).toBe('Bearer t-key');

    const results = readFileSync(join(dir, 'results.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(results.map((r: Json) => [r.request_id, r.provider, r.source, r.valid])).toEqual([
      ['a', 'gemini', 'direct', true],
      ['a', 'jev', 'captured', true],
      ['b', 'gemini', 'direct', true],
      ['b', 'jev', 'direct', true],
    ]);
    expect(results[1]).toMatchObject({ domain: 'example-realty.test', model: 'jev-latest', model_returned: 'jev-1.14.0', status: 200, ms: null });
    expect(Object.keys(results[0]).sort()).toEqual(['answers', 'domain', 'model', 'model_returned', 'ms', 'provider', 'request_id', 'source', 'status', 'valid']);

    for (const name of readdirSync(dir).filter((n) => n !== 'requests')) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(text).not.toContain('g-key');
      expect(text).not.toContain('t-key');
    }
    expect(parseCsv(readFileSync(join(dir, 'to-mark.csv'), 'utf8'))).toHaveLength(3);
  });

  it('without a TypeSafe key, a request with no captured answer stays "no Jev answer"', async () => {
    const dir = workDir();
    const seen: Json[] = [];
    const summary = await replay(dir, { GEMINI_API_KEY: 'g-key' }, fakeFetch(seen), () => {});
    expect(seen.map((call) => call.url)).toEqual([GEMINI_URL, GEMINI_URL]);
    expect(summary).toMatchObject({ R: 2, P: 1, noJev: 1 });
  });

  it('records a Gemini failure as status 0 and not valid', async () => {
    const dir = workDir();
    geminiReply.mockImplementationOnce(async () => {
      throw new TypeError('network down');
    });
    await replay(dir, { GEMINI_API_KEY: 'g-key' }, fakeFetch([]), () => {});
    const first = JSON.parse(readFileSync(join(dir, 'results.jsonl'), 'utf8').split('\n')[0]);
    expect(first).toMatchObject({ provider: 'gemini', status: 0, valid: false, answers: null });
  });

  it('refuses to run when a marking sheet already exists', async () => {
    const dir = workDir();
    writeFileSync(join(dir, 'to-mark.csv'), 'row_id,mark\r\nr01,supported\r\n');
    await expect(replay(dir, { GEMINI_API_KEY: 'g-key' }, fakeFetch([]), () => {})).rejects.toThrow(/Move it away/);
  });
});

describe('command line', () => {
  it('stops with a clear message when the Gemini key is missing', () => {
    const script = resolve(__dirname, '..', 'scripts', 'decision-probe.mjs');
    const result = spawnSync(process.execPath, [script, 'probe'], { env: { ...process.env, GEMINI_API_KEY: '' }, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GEMINI_API_KEY is not set');
  }, 60_000);
});
