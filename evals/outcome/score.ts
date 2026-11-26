/**
 * Outcome evals: score what the audit said about a fake site against what it should say.
 * Pure functions. The Vitest file tests/outcomeEvals.test.ts runs the real audit code and calls these.
 */
import type { FakeSite } from './fakeSite';

export interface Scenario {
  id: string;
  /** regression: must pass and be in the gate. gap: the owner and the product disagree; reported, not blocking. */
  stance: 'regression' | 'gap';
  /** One plain sentence per fault: what the product should tell the user. The owner confirms these. */
  says: string[];
  site: FakeSite;
  /** Exact results. Every crawler check, and the complete lists of fixes and findings. */
  expect: {
    checks: Record<string, string>;
    fixes: string[];
    findings: string[];
  };
}

export interface Observed {
  checks: Record<string, string>;
  fixes: string[];
  findings: string[];
}

export interface Score {
  /** An expected status, fix or finding is absent. Blocks a regression scenario. */
  missed: string[];
  /** A fix or finding the scenario does not expect. Always blocks. */
  invented: string[];
  /** A failed fetch reported as pass or fail. Always blocks. */
  dishonest: string[];
}

/** The crawler checks that read each file. A file that could not be fetched leaves them not measured. */
const CHECKS_READING: Record<string, readonly string[]> = {
  '/robots.txt': ['ai_bot_directives', 'cite_paths'],
  '/llms.txt': ['llms_txt', 'llms_structure'],
  '/ai.txt': ['ai_txt'],
};

export function scoreScenario(scenario: Scenario, observed: Observed): Score {
  const missed: string[] = [];
  for (const [id, status] of Object.entries(scenario.expect.checks)) {
    const got = observed.checks[id];
    if (got !== status) missed.push(`check ${id}: expected ${status}, got ${got ?? 'nothing'}`);
  }
  for (const id of scenario.expect.fixes) if (!observed.fixes.includes(id)) missed.push(`fix ${id}`);
  for (const id of scenario.expect.findings) if (!observed.findings.includes(id)) missed.push(`finding ${id}`);

  const invented = [
    ...observed.fixes.filter((id) => !scenario.expect.fixes.includes(id)).map((id) => `fix ${id}`),
    ...observed.findings.filter((id) => !scenario.expect.findings.includes(id)).map((id) => `finding ${id}`),
  ];

  const dishonest: string[] = [];
  for (const [path, served] of Object.entries(scenario.site)) {
    if ((served.status || 200) < 500) continue;
    for (const id of CHECKS_READING[path] || []) {
      const got = observed.checks[id];
      if (got && got !== 'not_measured') dishonest.push(`check ${id} is ${got} though ${path} returned ${served.status}`);
    }
  }
  return { missed, invented, dishonest };
}

export function scenarioBlocks(scenario: Scenario, score: Score): boolean {
  if (score.invented.length > 0 || score.dishonest.length > 0) return true;
  return scenario.stance === 'regression' && score.missed.length > 0;
}

/** Problems with the gate file: a regression scenario that is not listed, or whose contents changed. */
export function gateProblems(
  scenarios: readonly { id: string; stance: Scenario['stance']; fingerprint: string }[],
  gate: Record<string, string>,
): string[] {
  const problems: string[] = [];
  for (const scenario of scenarios) {
    if (scenario.stance !== 'regression') continue;
    const recorded = gate[scenario.id];
    if (!recorded) problems.push(`${scenario.id} is not in evals/outcome/gate.json`);
    else if (recorded !== scenario.fingerprint) problems.push(`${scenario.id} changed since it was promoted`);
  }
  return problems.length > 0
    ? [...problems, 'Check the change is intended, then run: npm run evals:outcome:promote']
    : [];
}
