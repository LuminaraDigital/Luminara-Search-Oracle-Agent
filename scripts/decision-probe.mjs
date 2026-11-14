#!/usr/bin/env node
/**
 * Track GD (docs/plans/gemini-decision-shadow.md): is Google's gemini-decision-1 good enough
 * to stand in for the hosted Jev evidence check? Nothing here runs in the product.
 *
 *   node scripts/decision-probe.mjs snippet
 *       Prints the in-page fetch wrapper an agent installs before each staging audit. It copies
 *       the Jev request body and response into window.__gdCaptures. No headers or cookies.
 *   node scripts/decision-probe.mjs save <captures.json> [dir]
 *       Writes each captured request to <dir>/requests/<id>.json. A 401 retry repeats the same
 *       body, so the last capture of a body wins.
 *   node scripts/decision-probe.mjs probe
 *       Three made-up calls to the Decisions API. Needs GEMINI_API_KEY.
 *   node scripts/decision-probe.mjs replay [dir]
 *       Sends every saved request to Gemini, uses the captured Jev answer (or calls Jev directly
 *       when TYPESAFE_API_KEY is set and the capture has none), writes results.jsonl,
 *       to-mark.csv and to-mark-key.json, and prints the counts. Needs GEMINI_API_KEY.
 *   node scripts/decision-probe.mjs decide [dir]
 *       Reads the marked to-mark.csv and prints the outcome under the plan's section 5 rules.
 *
 * [dir] defaults to scratch/decision-replay (git-ignored). Keys are read from the environment
 * and never printed or written.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/decisions';
export const GEMINI_MODEL = 'gemini-decision-1';
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_RELAY_PATH = '/api/providers/typesafe/v1/systemone';
const DEFAULT_DIR = join('scratch', 'decision-replay');
const TIMEOUT_MS = 5000;
const PROBE_LIMIT_MS = 2000;
const SLOW_MS = 1500;
const SUPPORTED_MIN = 0.6; // services/audit/jevVerifier.ts JEV_NOUL_MIN
const MARK_SAMPLE = 40;
const MARKS = new Set(['supported', 'not supported', 'cannot tell']);

export const CAPTURE_SNIPPET = `(() => {
  if (window.__gdCaptures) return 'already installed';
  const captures = (window.__gdCaptures = []);
  const original = window.fetch;
  window.fetch = function (input, init) {
    const pending = original.apply(this, arguments);
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.includes('${JEV_RELAY_PATH}') || typeof (init && init.body) !== 'string') return pending;
    let request;
    try { request = JSON.parse(init.body); } catch { return pending; }
    const entry = { request, jev: null };
    captures.push(entry);
    pending.then(
      (res) => res.clone().json().then(
        (body) => { entry.jev = { status: res.status, body }; },
        () => { entry.jev = { status: res.status, body: null }; },
      ),
      () => {},
    );
    return pending;
  };
  return 'installed';
})()`;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The answers when every question asked has a well-formed answer and nothing else came back, else null. */
export function validAnswers(questions, answers) {
  if (!isObject(questions) || !isObject(answers)) return null;
  const asked = Object.keys(questions);
  if (Object.keys(answers).some((key) => !asked.includes(key))) return null;
  for (const key of asked) {
    const question = questions[key];
    const answer = answers[key];
    if (!['noul', 'choice', 'score'].includes(question?.type)) return null;
    if (!isObject(answer) || answer.type !== question.type) return null;
    if (question.type === 'noul' && !(typeof answer.noul === 'number' && answer.noul >= 0 && answer.noul <= 1)) return null;
    // Jev's yes/no answers carry no confidence; jevVerifier.ts reads confidence only on a pick.
    if (question.type === 'choice' && !(typeof answer.choice === 'string' && Object.hasOwn(question.criteria || {}, answer.choice) && typeof answer.confidence === 'number')) return null;
    if (question.type === 'score') {
      const top = Array.isArray(question.criteria) ? question.criteria.length - 1 : -1;
      if (!(typeof answer.score === 'number' && answer.score >= 0 && answer.score <= top)) return null;
    }
  }
  return answers;
}

export function geminiBody(request) {
  return { model: GEMINI_MODEL, input: JSON.stringify(request.state), questions: request.questions };
}

export function domainOf(state) {
  try {
    return new URL(state.pages[0].url).hostname;
  } catch {
    return 'unknown';
  }
}

/** One POST with a limit that also covers reading the body. Status 0 means no response. */
async function post(url, headers, body, fetchImpl) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, ms: Date.now() - started, json };
  } catch {
    return { status: 0, ms: Date.now() - started, json: null };
  } finally {
    clearTimeout(timer);
  }
}

export function capturesToFiles(captures) {
  const byBody = new Map();
  for (const capture of Array.isArray(captures) ? captures : []) {
    const request = capture?.request;
    if (!isObject(request?.state) || !isObject(request?.questions)) continue;
    const text = JSON.stringify(request);
    byBody.delete(text); // keep the last capture of a body, in capture order
    byBody.set(text, { request, jev: isObject(capture.jev) ? capture.jev : null });
  }
  return [...byBody].map(([text, file]) => {
    const host = domainOf(file.request.state).replace(/[^a-z0-9.-]/gi, '_');
    return { id: `${host}-${createHash('sha256').update(text).digest('hex').slice(0, 10)}`, file };
  });
}

const supported = (answer) => answer.noul >= SUPPORTED_MIN;

/** Counts from results.jsonl lines. A pair is a request where both providers gave a valid call. */
export function summarize(lines) {
  const byRequest = new Map();
  for (const line of lines) {
    const entry = byRequest.get(line.request_id) || {};
    entry[line.provider] = line;
    byRequest.set(line.request_id, entry);
  }
  const gemini = lines.filter((line) => line.provider === 'gemini');
  const summary = {
    R: gemini.length,
    geminiValid: gemini.filter((line) => line.valid).length,
    geminiSlow: gemini.filter((line) => line.ms > SLOW_MS).length,
    P: 0,
    noJev: 0,
    Q: 0,
    D: 0,
    otherDiffs: {},
    disagreements: [],
  };
  for (const [requestId, { jev, gemini: gem }] of byRequest) {
    if (!gem) continue;
    if (!jev?.valid) {
      summary.noJev += 1;
      continue;
    }
    if (!gem.valid) continue;
    summary.P += 1;
    for (const key of Object.keys(jev.answers)) {
      const a = jev.answers[key];
      const b = gem.answers[key];
      if (key.startsWith('finding_') && a.type === 'noul') {
        summary.Q += 1;
        if (supported(a) !== supported(b)) {
          summary.D += 1;
          summary.disagreements.push({ requestId, key, jevSupported: supported(a) });
        }
        continue;
      }
      const differs = a.type === 'noul' ? supported(a) !== supported(b) : a.choice !== b.choice;
      if (differs) summary.otherDiffs[key] = (summary.otherDiffs[key] || 0) + 1;
    }
  }
  return summary;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // Excel adds a byte-order mark
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

const MARK_HEADER = ['row_id', 'page', 'claim', 'evidence', 'A', 'B', 'mark'];

/** The blind marking sheet and its key. A and B are assigned at random per row. */
export function markingFiles(disagreements, requests, random = Math.random) {
  const pool = [...disagreements];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const shown = pool.slice(0, MARK_SAMPLE);
  const keyRows = [];
  const lines = [MARK_HEADER.join(',')];
  shown.forEach((row, index) => {
    const rowId = `r${String(index + 1).padStart(2, '0')}`;
    const request = requests.get(row.requestId);
    const a = random() < 0.5 ? 'jev' : 'gemini';
    const aSays = (a === 'jev') === row.jevSupported ? 'supported' : 'not supported';
    const bSays = aSays === 'supported' ? 'not supported' : 'supported';
    const evidence = [...(request.state.pages || []), ...(request.state.files || [])]
      .map((item) => `${item.url}: ${item.excerpt || ''}`)
      .join(' | ');
    keyRows.push({ row_id: rowId, request_id: row.requestId, question_key: row.key, a });
    lines.push([rowId, request.state.pages?.[0]?.url, request.questions[row.key].instructions, evidence, aSays, bSays, '']
      .map(csvCell)
      .join(','));
  });
  return { csv: `${lines.join('\r\n')}\r\n`, key: { disagreements: disagreements.length, sampled: shown.length, rows: keyRows } };
}

/** Section 5 of the plan. The first step that decides the outcome ends it. */
export function decide(summary, markedRows, key) {
  const { disagreements, ...totals } = summary;
  const header = markedRows[0] || [];
  const idCol = header.indexOf('row_id');
  const markCol = header.indexOf('mark');
  if (idCol < 0 || markCol < 0) throw new Error('to-mark.csv has no row_id or mark column.');
  const marks = new Map(markedRows.slice(1).map((cells) => [cells[idCol], (cells[markCol] || '').trim().toLowerCase()]));
  const problems = key.rows.filter((row) => !MARKS.has(marks.get(row.row_id))).map((row) => row.row_id);
  if (problems.length) {
    throw new Error(`Rows without a mark of supported, not supported or cannot tell: ${problems.join(', ')}.`);
  }
  let J = 0;
  let G = 0;
  let M = 0;
  let cannotTell = 0;
  for (const row of key.rows) {
    const mark = marks.get(row.row_id);
    if (mark === 'cannot tell') { cannotTell += 1; continue; }
    M += 1;
    const disagreement = disagreements.find((d) => d.requestId === row.request_id && d.key === row.question_key);
    if (!disagreement) throw new Error(`Row ${row.row_id} does not match results.jsonl. Re-run replay.`);
    // In a disagreement exactly one provider sided with the marker.
    if (disagreement.jevSupported === (mark === 'supported')) G += 1;
    else J += 1;
  }
  const counts = { ...totals, shown: key.rows.length, sampled: key.sampled, M, cannotTell, J, G };
  const { R, geminiValid, geminiSlow, P, Q, D } = totals;
  if (R - geminiValid > 1 || geminiSlow > 2) {
    return { outcome: 'do nothing', reason: `Step 1: ${R - geminiValid} Gemini calls not valid, ${geminiSlow} slower than 1.5 s.`, counts };
  }
  if (P < 20) return { outcome: 'inconclusive', reason: `Step 2: only ${P} usable pairs.`, counts };
  if (cannotTell * 3 > key.rows.length) return { outcome: 'inconclusive', reason: `Step 2: ${cannotTell} of ${key.rows.length} rows marked cannot tell.`, counts };
  if (M < 8 && Q < 100) return { outcome: 'inconclusive', reason: `Step 2: ${M} marked rows and ${Q} questions compared.`, counts };
  const reason = `Step 3: Gemini wrong ${G}, Jev wrong ${J}, ${D} of ${Q} disagree.`;
  if (G > J + 2 || (M < 8 && D * 10 > Q)) return { outcome: 'do nothing', reason, counts };
  return { outcome: 'good enough', clearlyBetter: J >= G + 5, reason, counts };
}

const PROBE_REQUEST = {
  state: {
    pages: [{ url: 'https://example-realty.test/', status: 200, excerpt: 'Example Realty. Sales and rentals in Brighton. Call 03 9000 0000.' }],
    files: [{ url: 'https://example-realty.test/llms.txt', status: 404, excerpt: 'Not found' }],
  },
  questions: {
    finding_0: { type: 'noul', instructions: 'Is this finding supported by the evidence? The site has no llms.txt file.' },
    site_type: {
      type: 'choice',
      instructions: 'What kind of site is this?',
      criteria: { real_estate_agency: 'A real estate agency with more than one agent', individual_agent: 'A single real estate agent', other: 'None of those' },
    },
    clarity: { type: 'score', instructions: 'How clearly does the page say what the business does?', criteria: ['Not at all', 'Partly', 'Clearly'] },
  },
};

export async function probe(env, fetchImpl = fetch, log = console.log) {
  let passed = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const call = await post(GEMINI_URL, { 'x-goog-api-key': env.GEMINI_API_KEY }, geminiBody(PROBE_REQUEST), fetchImpl);
    const answers = call.status === 200 ? validAnswers(PROBE_REQUEST.questions, call.json?.answers) : null;
    passed ||= answers !== null && call.ms <= PROBE_LIMIT_MS;
    log(`Try ${attempt}: status ${call.status}, ${call.ms} ms, ${answers ? 'valid' : 'not valid'}`);
    log(JSON.stringify(call.json, null, 2));
  }
  log(passed ? 'Probe passed: at least one valid answer within 2 s.' : 'Stop rule: no valid answer within 2 s. Record this in the plan.');
  return passed;
}

export async function replay(dir, env, fetchImpl = fetch, log = console.log) {
  if (existsSync(join(dir, 'to-mark.csv'))) {
    throw new Error(`${join(dir, 'to-mark.csv')} exists. Move it away first so marks are not overwritten.`);
  }
  const requestDir = join(dir, 'requests');
  const names = existsSync(requestDir) ? readdirSync(requestDir).filter((name) => name.endsWith('.json')).sort() : [];
  if (!names.length) throw new Error(`No saved requests in ${requestDir}. Run "save" first.`);
  const requests = new Map();
  const lines = [];
  // One call at a time, so each timing is the provider's alone.
  for (const name of names) {
    const requestId = name.slice(0, -'.json'.length);
    const { request, jev } = JSON.parse(readFileSync(join(requestDir, name), 'utf8'));
    requests.set(requestId, request);
    const line = (provider, model, source, call) => {
      const answers = call.status === 200 ? validAnswers(request.questions, call.json?.answers) : null;
      return {
        request_id: requestId,
        domain: domainOf(request.state),
        provider,
        model,
        model_returned: typeof call.json?.model === 'string' ? call.json.model : null,
        source,
        status: call.status,
        ms: call.ms,
        valid: answers !== null,
        answers,
      };
    };
    const gemini = await post(GEMINI_URL, { 'x-goog-api-key': env.GEMINI_API_KEY }, geminiBody(request), fetchImpl);
    lines.push(line('gemini', GEMINI_MODEL, 'direct', gemini));
    let jevLine = line('jev', request.model ?? null, 'captured', { status: jev?.status ?? 0, ms: null, json: jev?.body });
    if (!jevLine.valid && env.TYPESAFE_API_KEY) {
      const direct = await post(JEV_URL, { authorization: `Bearer ${env.TYPESAFE_API_KEY}` }, request, fetchImpl);
      jevLine = line('jev', request.model ?? null, 'direct', direct);
    }
    lines.push(jevLine);
    log(`${requestId}: gemini ${gemini.status} in ${gemini.ms} ms, jev ${jevLine.valid ? 'valid' : 'no answer'} (${jevLine.source})`);
  }
  writeFileSync(join(dir, 'results.jsonl'), `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const { disagreements, ...totals } = summarize(lines);
  const marking = markingFiles(disagreements, requests);
  writeFileSync(join(dir, 'to-mark.csv'), marking.csv);
  writeFileSync(join(dir, 'to-mark-key.json'), `${JSON.stringify(marking.key, null, 2)}\n`);
  log(JSON.stringify({ ...totals, sampled: marking.key.sampled }, null, 2));
  log(`Mark ${marking.key.sampled} rows in ${join(dir, 'to-mark.csv')}, then run "decide". Do not open to-mark-key.json.`);
  return totals;
}

function main() {
  const [mode, first, second] = process.argv.slice(2);
  const fail = (message) => {
    console.error(message);
    process.exit(1);
  };
  const needKey = () => {
    if (!process.env.GEMINI_API_KEY?.trim()) fail('GEMINI_API_KEY is not set. Set it in this terminal first; see the plan, section 7.');
  };
  if (mode === 'snippet') {
    console.log(CAPTURE_SNIPPET);
  } else if (mode === 'save') {
    if (!first) fail('Usage: decision-probe.mjs save <captures.json> [dir]');
    const dir = second || DEFAULT_DIR;
    mkdirSync(join(dir, 'requests'), { recursive: true });
    const files = capturesToFiles(JSON.parse(readFileSync(first, 'utf8')));
    for (const { id, file } of files) writeFileSync(join(dir, 'requests', `${id}.json`), `${JSON.stringify(file, null, 2)}\n`);
    console.log(`Saved ${files.length} requests to ${join(dir, 'requests')}.`);
  } else if (mode === 'probe') {
    needKey();
    probe(process.env).then((passed) => process.exit(passed ? 0 : 1));
  } else if (mode === 'replay') {
    needKey();
    replay(first || DEFAULT_DIR, process.env).catch((err) => fail(err.message));
  } else if (mode === 'decide') {
    const dir = first || DEFAULT_DIR;
    try {
      const lines = readFileSync(join(dir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
      const result = decide(summarize(lines), parseCsv(readFileSync(join(dir, 'to-mark.csv'), 'utf8')), JSON.parse(readFileSync(join(dir, 'to-mark-key.json'), 'utf8')));
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      fail(err.message);
    }
  } else {
    fail('Usage: decision-probe.mjs snippet | save <captures.json> [dir] | probe | replay [dir] | decide [dir]');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
