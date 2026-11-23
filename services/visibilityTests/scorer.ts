/**
 * Visibility Unit Tests scorer. Pure: no I/O, no env, no LLM calls.
 * score(raw) is the only path to a verdict, so a regrade re-runs this on the saved raw record.
 */
import { classifyMention, sameSite } from '../audit/entityMatch';
import { extractSourceHost } from '../visibility/engineVisibilityTypes';
import type {
  ExpectedFacts,
  FamilySummary,
  RawAnswer,
  RawVisibilityRun,
  ScorecardRow,
  VisibilityDerivation,
  VisibilityFamily,
  VisibilityResult,
  VisibilitySummary,
  VisibilityTagKind,
  VisibilityTestType,
  VisibilityVerdict,
} from './types';
import { FAMILIES } from './types';

const FAMILY_BY_TYPE: Record<VisibilityTestType, VisibilityFamily> = {
  brand_named: 'presence',
  site_cited: 'citation',
  fact_stated: 'accuracy',
  claim_absent: 'accuracy',
  schema_present: 'structure',
  site_states_fact: 'structure',
};

const BUSINESS_SCHEMA = /(organization|localbusiness|realestateagent|realestateagency|store|restaurant|professionalservice|medicalbusiness)/i;
const REFUSAL = /^\W*(i'?m sorry|sorry,|i cannot|i can'?t|i am unable|i'?m unable|as an ai\b|unfortunately\b|i (do not|don'?t) have|i could(n'?t| not)\b|no information\b)/i;
const NEGATION = /\b(not|never|no|isn t|isnt|aren t|arent|wasn t|wasnt)\s+(\S+\s+){0,2}$/;
const NEGATED = /\b(not|never|no|isn t|isnt|aren t|arent|wasn t|wasnt)\b/;
const SENTENCE_BREAK = /[.!?]+\s+(?=[A-Z])|[;\n]/;
const SHORT_ANSWER_CHARS = 400;
const MIN_WORD_CHARS = 2;
const MIN_FACT_CHARS = 2;
const PHONE_DIGITS = 6;
const PHONE_SHAPED = /^[\d\s()+.-]+$/;
const PHONE_IN_TEXT = /\+?\d[\d\s().-]{4,}\d/g;
/** Words of a fact may move about, but only this far: scattered words are not the fact. */
const WINDOW_EXTRA_WORDS = 4;

export function tag(kind: VisibilityTagKind, value: string): string {
  return `${kind}:${value.trim().toLowerCase()}`;
}

/** Both sides of a comparison go through this: lower case, no punctuation, single spaces. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function localDigits(phone: string): string {
  return phone.replace(/[^\d+]/g, '').replace(/^(\+?61|0)/, '').replace(/\+/g, '');
}

/** Other spacing, +61 for the leading 0, or a missing one-digit area code is still the same number. */
function statesPhone(text: string, fact: string): boolean {
  if (!PHONE_SHAPED.test(fact)) return false;
  const wanted = localDigits(fact);
  if (wanted.length < PHONE_DIGITS) return false;
  return (text.match(PHONE_IN_TEXT) ?? []).some((run) => {
    const found = localDigits(run);
    return found === wanted || (found.length === wanted.length + 1 && found.endsWith(wanted));
  });
}

/** Words may move a little. Every number must appear whole, so "5 years" never matches "15 years". */
export function statesFact(text: string, fact: string): boolean {
  const body = ` ${fold(text)} `;
  const wanted = fold(fact);
  if (!wanted) return false;
  if (body.includes(` ${wanted} `)) return true;
  if (statesPhone(text, fact)) return true;
  // A number joined up in the fact stays joined up: "24/7" is not "7 days, 24 hours".
  const numbers = fact.match(/\d+(?:[./:-]\d+)*/g) ?? [];
  if (!numbers.every((number) => body.includes(` ${fold(number)} `))) return false;
  const words = wanted.split(' ').filter((word) => /\d/.test(word) || word.length >= MIN_WORD_CHARS);
  if (!words.length) return false;
  const tokens = body.trim().split(' ');
  const span = words.length + WINDOW_EXTRA_WORDS;
  return tokens.some((_, start) => {
    const window = tokens.slice(start, start + span);
    return words.every((word) => window.includes(word));
  });
}

/** "We are not the cheapest agent" does not state the claim. */
export function statesClaim(text: string, claim: string): boolean {
  const wanted = ` ${fold(claim)} `;
  // Sentence by sentence, because a denial in one sentence says nothing about the next.
  const inASentence = text.split(SENTENCE_BREAK).some((sentence) => {
    const body = ` ${fold(sentence)} `;
    let at = body.indexOf(wanted);
    if (at < 0) return statesFact(sentence, claim) && !NEGATED.test(body);
    for (; at >= 0; at = body.indexOf(wanted, at + 1)) {
      if (!NEGATION.test(body.slice(0, at + 1))) return true;
    }
    return false;
  });
  if (inASentence) return true;
  // An abbreviation can split a claim across two "sentences", as in "Pty. Ltd. registered".
  const whole = ` ${fold(text)} `;
  return whole.includes(wanted) && !NEGATED.test(whole.replace(wanted, ' '));
}

/** The one question that does not name the business, so a yes means it was really found. */
export function discoveryQuestion(service?: string | null, suburb?: string | null): string | null {
  const what = service?.trim();
  if (!what) return null;
  const where = suburb?.trim();
  return where ? `best ${what} in ${where}` : `best ${what} near me`;
}

/** A question with the name in it gets the name back, so the answer says nothing about being found. */
export function asksByName(prompt: string, facts: Pick<ExpectedFacts, 'brand' | 'domain' | 'service' | 'suburb'>): boolean {
  const question = ` ${fold(prompt)} `;
  // A business named after its suburb or trade is not named by a question about that suburb or trade.
  const topic = ` ${fold(`${facts.service ?? ''} ${facts.suburb ?? ''}`)} `;
  const stem = facts.domain.split('.')[0];
  return [facts.brand, facts.domain, stem].some((name) => {
    const wanted = fold(name);
    return wanted.length >= MIN_FACT_CHARS && question.includes(` ${wanted} `) && !topic.includes(` ${wanted} `);
  });
}

export function isRefusal(answer: Pick<RawAnswer, 'kind' | 'text' | 'finishReason' | 'error'>): boolean {
  if (answer.error || answer.kind !== 'byok_probe') return false;
  if (answer.finishReason === 'content_filter') return true;
  return answer.text.length < SHORT_ANSWER_CHARS && REFUSAL.test(answer.text) && !/\bbut\b/i.test(answer.text);
}

function derivationOf(facts: ExpectedFacts): VisibilityDerivation {
  return facts.confirmed ? 'dna_confirmed' : 'site_estimated';
}

function testKey(value: string): string {
  return fold(value).replace(/ /g, '-');
}

/** One entry per test id. Two spellings of a fact are one test, and text with no letters or digits is none. */
function uniqueByKey(values: ReadonlyArray<string | undefined>): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const key = testKey(value ?? '');
    if (key.length >= MIN_FACT_CHARS && !byKey.has(key)) byKey.set(key, value!.trim());
  }
  return [...byKey.values()];
}

function factsToCheck(facts: ExpectedFacts): string[] {
  return uniqueByKey([facts.suburb, ...facts.keyFacts]);
}

function answerTags(facts: ExpectedFacts, answer: RawAnswer): string[] {
  const tags = [tag('engine', answer.engine), tag('intent', asksByName(answer.prompt, facts) ? 'by_name' : answer.intent)];
  if (facts.suburb) tags.push(tag('suburb', facts.suburb));
  if (facts.service) tags.push(tag('service', facts.service));
  return tags;
}

function citesSite(answer: RawAnswer, domain: string): boolean {
  return answer.sources.some((source) => sameSite(extractSourceHost(source), domain));
}

type PlannedTest = { type: VisibilityTestType; key: string; label: string; value: string };

function verdictFor(facts: ExpectedFacts, answerId: string | null, tags: string[]) {
  return ({ type, key, label }: Omit<PlannedTest, 'value'>, [result, why]: [VisibilityResult, string]): VisibilityVerdict => ({
    testId: `${type}:${key}`,
    testType: type,
    family: FAMILY_BY_TYPE[type],
    derivation: derivationOf(facts),
    tags,
    answerId,
    label,
    result,
    why,
  });
}

/** Search results are plural and never read as something an AI said. */
function plannedTests(facts: ExpectedFacts, fromSearch: boolean): PlannedTest[] {
  const who = fromSearch ? 'Search results' : 'AI';
  const s = fromSearch ? '' : 's';
  return [
    { type: 'brand_named', key: 'brand', label: `${who} name${s} ${facts.brand}`, value: facts.brand },
    { type: 'site_cited', key: 'site', label: `${who} point${s} to ${facts.domain}`, value: facts.domain },
    ...factsToCheck(facts).map((fact) => ({
      type: 'fact_stated' as const,
      key: testKey(fact),
      label: `${who} say${s}: ${fact}`,
      value: fact,
    })),
    ...uniqueByKey(facts.bannedClaims).map((claim) => ({
      type: 'claim_absent' as const,
      key: testKey(claim),
      label: `${who} ${fromSearch ? 'do' : 'does'} not say: ${claim}`,
      value: claim,
    })),
  ];
}

function outcome(test: PlannedTest, facts: ExpectedFacts, answer: RawAnswer): [VisibilityResult, string] {
  const question = `"${answer.prompt}"`;
  if (answer.error || !answer.text.trim()) {
    return ['not_measured', `We could not get an answer for ${question}, so this was not checked.`];
  }
  const accuracy = FAMILY_BY_TYPE[test.type] === 'accuracy';
  if (!accuracy && asksByName(answer.prompt, facts)) {
    return ['not_measured', 'This question already used your name, so it cannot show whether you get found.'];
  }
  if (isRefusal(answer)) {
    return accuracy
      ? ['not_measured', `This AI refused to answer ${question}, so there was nothing to check.`]
      : ['fail', `This AI refused to answer ${question}.`];
  }

  const fromSearch = answer.kind === 'search';
  const reply = `${fromSearch ? 'The results for' : 'The answer to'} ${question}`;
  const s = fromSearch ? '' : 's';
  const doesNot = fromSearch ? 'do not' : 'does not';
  const named = classifyMention({ domain: facts.domain, brandName: facts.brand }, { text: answer.text }) === 'same';
  switch (test.type) {
    case 'brand_named':
      return named ? ['pass', `${reply} name${s} you.`] : ['fail', `${reply} ${doesNot} name you.`];
    case 'site_cited':
      return citesSite(answer, facts.domain)
        ? ['pass', `${reply} link${s} to your website.`]
        : ['fail', `${reply} ${doesNot} link to your website.`];
    case 'fact_stated':
      if (!named) return ['not_measured', 'You were not mentioned here, so there was nothing to check.'];
      if (statesFact(answer.text, test.value)) return ['pass', `We found "${test.value}" for ${question}.`];
      return answer.finishReason === 'length'
        ? ['not_measured', 'This answer was cut off, so we could not tell.']
        : ['fail', `You are mentioned for ${question}, but "${test.value}" is left out.`];
    default:
      return statesClaim(answer.text, test.value)
        ? ['fail', `We found "${test.value}" for ${question}, which you told us should not be said.`]
        : ['pass', `We did not find "${test.value}" for ${question}.`];
  }
}

function gradeAnswer(facts: ExpectedFacts, answer: RawAnswer): VisibilityVerdict[] {
  const verdict = verdictFor(facts, answer.id, answerTags(facts, answer));
  return plannedTests(facts, answer.kind === 'search').map((test) => verdict(test, outcome(test, facts, answer)));
}

function gradeSite(facts: ExpectedFacts, snapshot: RawVisibilityRun['snapshot']): VisibilityVerdict[] {
  const pages = snapshot?.pages ?? [];
  const verdict = verdictFor(facts, null, []);
  const schemaTest = { type: 'schema_present' as const, key: 'business', label: 'Your website tells AI what kind of business you are' };
  const factTest = (fact: string) => ({ type: 'site_states_fact' as const, key: testKey(fact), label: `Your website says: ${fact}` });
  const notRead: [VisibilityResult, string] = ['not_measured', 'We could not read your website, so this was not checked.'];
  const checks = factsToCheck(facts);
  if (!pages.length) return [verdict(schemaTest, notRead), ...checks.map((fact) => verdict(factTest(fact), notRead))];
  const hasSchema = pages.some((page) => page.schemaTypes.some((type) => BUSINESS_SCHEMA.test(type)));
  const allText = pages.map((page) => `${page.title} ${page.text}`).join(' ');
  return [
    verdict(schemaTest, hasSchema
      ? ['pass', 'Your website has a hidden label that says what your business is.']
      : ['fail', 'Your website has no hidden label that says what your business is, so AI has to guess.']),
    ...checks.map((fact) => verdict(factTest(fact), statesFact(allText, fact)
      ? ['pass', `We found "${fact}" on the pages we read.`]
      : ['fail', `We did not find "${fact}" on the pages we read.`])),
  ];
}

export function score(raw: RawVisibilityRun): VisibilityVerdict[] {
  return [...raw.answers.flatMap((answer) => gradeAnswer(raw.facts, answer)), ...gradeSite(raw.facts, raw.snapshot)];
}

type Counted = Pick<VisibilityVerdict, 'family' | 'result' | 'answerId' | 'derivation'>;

/** The same summary over any slice: pass `verdicts.filter((v) => v.tags.includes(tag(...)))`. */
export function summarize(verdicts: readonly Counted[]): VisibilitySummary {
  const families: VisibilitySummary['families'] = {};
  for (const family of FAMILIES) {
    const rows = verdicts.filter((v) => v.family === family);
    if (!rows.length) continue;
    const graded = rows.filter((v) => v.result !== 'not_measured');
    const passed = graded.filter((v) => v.result === 'pass').length;
    const summary: FamilySummary = {
      score: graded.length ? passed / graded.length : 0,
      tests: graded.length,
      passed,
      notMeasured: rows.length - graded.length,
      answers: new Set(graded.map((v) => v.answerId)).size,
    };
    families[family] = summary;
  }
  const measured = Object.values(families).filter((f) => f.tests > 0);
  return {
    score: measured.length ? measured.reduce((sum, f) => sum + f.score, 0) / measured.length : null,
    families,
    graded: measured.reduce((sum, f) => sum + f.tests, 0),
    notMeasured: Object.values(families).reduce((sum, f) => sum + f.notMeasured, 0),
    estimated: verdicts.some((v) => v.derivation !== 'dna_confirmed'),
  };
}

export type ScorecardAnswerRow = {
  id: string;
  provider: string;
  model: string;
  status: string;
  cost_usd: number | null;
  latency_ms: number | null;
};

export type ScorecardVerdictRow = Pick<VisibilityVerdict, 'family' | 'result'> & { answer_id: string };

/** Quality, cost and refusals per model. Errors measure nothing, so they are counted apart. */
export function buildScorecard(answers: readonly ScorecardAnswerRow[], verdicts: readonly ScorecardVerdictRow[]): ScorecardRow[] {
  const byModel = new Map<string, ScorecardAnswerRow[]>();
  for (const answer of answers) {
    const key = `${answer.provider}\n${answer.model}`;
    byModel.set(key, [...(byModel.get(key) ?? []), answer]);
  }
  const rows = [...byModel.values()].map((group): ScorecardRow => {
    const ids = new Set(group.map((a) => a.id));
    const summary = summarize(
      verdicts
        .filter((v) => ids.has(v.answer_id))
        .map((v) => ({ family: v.family, result: v.result, answerId: v.answer_id, derivation: 'dna_confirmed' as const })),
    );
    const costs = group.map((a) => a.cost_usd).filter((c): c is number => c !== null);
    const latencies = group.map((a) => a.latency_ms).filter((l): l is number => l !== null);
    return {
      provider: group[0].provider,
      model: group[0].model,
      answers: group.length,
      refusals: group.filter((a) => a.status === 'refused').length,
      errors: group.filter((a) => a.status === 'error').length,
      score: summary.score,
      tests: summary.graded,
      passed: Object.values(summary.families).reduce((sum, f) => sum + f.passed, 0),
      costUsd: costs.length ? costs.reduce((sum, c) => sum + c, 0) : null,
      costUnknown: group.length - costs.length,
      averageLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, l) => sum + l, 0) / latencies.length) : null,
    };
  });
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/** Fact and claim labels quote the owner's private words, such as what they fear being said, so they never qualify. */
const SHAREABLE_TYPES: readonly VisibilityTestType[] = ['brand_named', 'site_cited', 'schema_present'];

/** What a share link may show: passing checks by label, with no answer text and no reasons. */
export function passList(verdicts: readonly Pick<VisibilityVerdict, 'label' | 'result' | 'testType'>[]): string[] {
  const shareable = verdicts.filter((v) => SHAREABLE_TYPES.includes(v.testType));
  const failed = new Set(shareable.filter((v) => v.result === 'fail').map((v) => v.label));
  return [...new Set(shareable.filter((v) => v.result === 'pass' && !failed.has(v.label)).map((v) => v.label))];
}

export function answerStatus(answer: RawAnswer): 'ok' | 'refused' | 'error' {
  if (answer.error) return 'error';
  return isRefusal(answer) ? 'refused' : 'ok';
}
