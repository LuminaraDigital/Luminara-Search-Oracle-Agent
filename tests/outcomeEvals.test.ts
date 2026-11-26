/**
 * Outcome evals: each scenario under evals/outcome/scenarios is a fake site with planted faults.
 * This runs the real crawler-file and schema audit code against it and scores what came out.
 * No model, no network. See evals/outcome/README.md.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fakeSiteFetcher } from '../evals/outcome/fakeSite';
import { gateProblems, scenarioBlocks, scoreScenario, type Observed, type Scenario, type Score } from '../evals/outcome/score';
import { playbookAuditorAgent } from '../services/agentCore/agents/playbookAuditorAgent';
import { toCrewPage } from '../services/agentCore/agents/scoutAgent';
import { crawlerFixes } from '../services/audit/crawlerFixes';
import { evaluateLlmCrawlerReadiness } from '../services/audit/llmCrawlerReadiness';
import { contentDistiller } from '../services/scraping/contentDistiller';
import { loadCrawlerSnapshot } from '../worker/llmCrawlerRoute';

const OUTCOME_DIR = resolve(__dirname, '../evals/outcome');
const SCENARIO_DIR = join(OUTCOME_DIR, 'scenarios');
const GATE_FILE = join(OUTCOME_DIR, 'gate.json');
const HOST = 'https://example-co.com';
const PROMOTE = process.env.OUTCOME_PROMOTE === '1';

// Line endings are normalised so the code is the same on Windows and in CI.
const text = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const helperText = text(join(OUTCOME_DIR, 'fakeSite.ts'));
const fingerprint = (scenarioText: string) =>
  createHash('sha256').update(scenarioText).update(helperText).digest('hex').slice(0, 12);

const visibleText = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Runs the audit code a real run uses for crawler files and page schema. */
async function audit(scenario: Scenario): Promise<Observed> {
  const loaded = await loadCrawlerSnapshot(HOST, fakeSiteFetcher(scenario.site));
  if (!loaded.ok) throw new Error(loaded.error);
  const report = evaluateLlmCrawlerReadiness(loaded.snapshot);

  const html = scenario.site['/']?.body || '';
  const markdown = visibleText(html);
  const distilled = contentDistiller.distill(html, markdown);
  const page = toCrewPage({
    success: true,
    providerUsed: 'patchright',
    url: HOST,
    statusCode: 200,
    title: distilled.title,
    description: distilled.description,
    markdown,
    rawHtml: html,
    distilled,
    formattedEvidence: distilled.formattedEvidence,
    latencyMs: 1,
  }, HOST);
  // One live search row that names the brand, so the health score is computed and not blocked.
  const serp = [{
    query: 'example co water filters',
    engine: 'tavily' as const,
    title: 'Example Co water filters',
    url: `${HOST}/about`,
    snippet: 'Example Co fits water filters.',
    brandMentioned: true,
  }];
  const result = await playbookAuditorAgent.execute('AEO', [page], serp, null, () => {}, report);

  return {
    checks: Object.fromEntries(report.checks.map((check) => [check.id, check.status])),
    fixes: crawlerFixes(report.checks).map((fix) => fix.id),
    findings: result.findings.map((finding) => finding.id),
  };
}

const files = readdirSync(SCENARIO_DIR).filter((name) => name.endsWith('.ts')).sort();
const loadedScenarios = await Promise.all(files.map(async (name) => {
  const file = join(SCENARIO_DIR, name);
  const scenario = (await import(pathToFileURL(file).href)).default as Scenario;
  return { scenario, fingerprint: fingerprint(text(file)) };
}));
const scores = new Map<string, Score>();

describe('outcome evals', () => {
  it.each(loadedScenarios.map((entry) => [entry.scenario.id, entry.scenario] as const))('%s', async (_id, scenario) => {
    const score = scoreScenario(scenario, await audit(scenario));
    scores.set(scenario.id, score);
    expect(scenario.says.length).toBeGreaterThan(0);
    if (scenarioBlocks(scenario, score)) expect(score).toEqual({ missed: [], invented: [], dishonest: [] });
  });

  it('every regression scenario is in the gate with its current fingerprint', () => {
    const current = loadedScenarios.map((entry) => ({ ...entry.scenario, fingerprint: entry.fingerprint }));
    if (PROMOTE) {
      const passing = current.filter((scenario) => {
        const score = scores.get(scenario.id);
        return scenario.stance === 'regression' && score && !scenarioBlocks(scenario, score);
      });
      const gate = Object.fromEntries(passing.map((scenario) => [scenario.id, scenario.fingerprint]));
      writeFileSync(GATE_FILE, `${JSON.stringify(gate, null, 2)}\n`);
    }
    const gate = JSON.parse(readFileSync(GATE_FILE, 'utf8')) as Record<string, string>;
    expect(gateProblems(current, gate)).toEqual([]);
  });

  afterAll(() => {
    const rows = loadedScenarios.map(({ scenario }) => ({ id: scenario.id, stance: scenario.stance, ...scores.get(scenario.id) }));
    const count = (key: keyof Score) => rows.filter((row) => (row[key] || []).length > 0).length;
    const card = {
      scenarios: rows.length,
      found: rows.filter((row) => row.missed && row.missed.length === 0).length,
      invented: count('invented'),
      dishonest: count('dishonest'),
      checksCovered: [...new Set(loadedScenarios.flatMap(({ scenario }) => [
        ...Object.keys(scenario.expect.checks), ...scenario.expect.fixes, ...scenario.expect.findings,
      ]))].sort(),
      rows,
    };
    mkdirSync(resolve(__dirname, '../coverage'), { recursive: true });
    writeFileSync(resolve(__dirname, '../coverage/outcome-evals.json'), `${JSON.stringify(card, null, 2)}\n`);
    console.log(`[outcome evals] ${card.scenarios} scenarios: ${card.found} found, ${card.invented} invented, ${card.dishonest} dishonest`);
  });
});

describe('outcome eval scorer', () => {
  const scenario: Scenario = {
    id: 'unit',
    stance: 'regression',
    says: ['robots.txt could not be fetched.'],
    site: { '/robots.txt': { body: '', status: 503 } },
    expect: { checks: { ai_bot_directives: 'not_measured' }, fixes: ['fix-llms-txt'], findings: [] },
  };
  const clean: Observed = { checks: { ai_bot_directives: 'not_measured' }, fixes: ['fix-llms-txt'], findings: [] };

  it('passes when the audit said exactly what was expected', () => {
    expect(scoreScenario(scenario, clean)).toEqual({ missed: [], invented: [], dishonest: [] });
  });

  it('reports an expected id that is absent', () => {
    const score = scoreScenario(scenario, { ...clean, fixes: [] });
    expect(score.missed).toEqual(['fix fix-llms-txt']);
    expect(scenarioBlocks(scenario, score)).toBe(true);
    expect(scenarioBlocks({ ...scenario, stance: 'gap' }, score)).toBe(false);
  });

  it('reports an id nobody expected, and blocks even a gap scenario', () => {
    const score = scoreScenario(scenario, { ...clean, findings: ['finding-schema-org'] });
    expect(score.invented).toEqual(['finding finding-schema-org']);
    expect(scenarioBlocks({ ...scenario, stance: 'gap' }, score)).toBe(true);
  });

  it('reports a failed fetch presented as a result, and blocks even a gap scenario', () => {
    const score = scoreScenario(scenario, { ...clean, checks: { ai_bot_directives: 'pass' } });
    expect(score.dishonest).toEqual(['check ai_bot_directives is pass though /robots.txt returned 503']);
    expect(scenarioBlocks({ ...scenario, stance: 'gap' }, score)).toBe(true);
  });

  it('fails the gate and names a scenario whose contents changed or that was never promoted', () => {
    const listed = { id: 'robots-5xx', stance: 'regression' as const, fingerprint: 'aaaaaaaaaaaa' };
    expect(gateProblems([listed], { 'robots-5xx': 'aaaaaaaaaaaa' })).toEqual([]);
    expect(gateProblems([{ ...listed, fingerprint: 'bbbbbbbbbbbb' }], { 'robots-5xx': 'aaaaaaaaaaaa' })[0])
      .toBe('robots-5xx changed since it was promoted');
    expect(gateProblems([listed], {})[0]).toBe('robots-5xx is not in evals/outcome/gate.json');
    expect(gateProblems([{ ...listed, stance: 'gap' }], {})).toEqual([]);
  });
});
