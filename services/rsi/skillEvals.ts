/**
 * Deterministic evals a skill or prompt must pass before it goes live.
 * Later correction cases are appended. They never replace these checks.
 */

export interface SkillEvalCase {
  name: string;
  mustContain?: string[];
  mustNotContain?: string[];
  /** Reject a metric word next to a number unless that line says not_measured or unknown. */
  forbidInventedMetrics?: boolean;
}

export interface SkillEvalCaseResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface SkillEvalReport {
  passed: boolean;
  cases: SkillEvalCaseResult[];
}

const INVENTED_METRIC = /\b(domain authority|search volume|citation rate|backlinks|core web vitals)\b[^.\n]{0,40}\d+/i;

export const BUILTIN_SKILL_EVALS: readonly SkillEvalCase[] = [
  { name: 'has-title', mustContain: ['# '] },
  { name: 'names-evidence', mustContain: ['## Evidence'] },
  { name: 'no-invented-metrics', forbidInventedMetrics: true },
];

function lineAllowsNumber(line: string): boolean {
  return /not_measured|unknown/i.test(line);
}

export function evaluateSkillCase(body: string, evalCase: SkillEvalCase): SkillEvalCaseResult {
  const text = String(body || '');
  for (const needle of evalCase.mustContain || []) {
    if (!text.includes(needle)) {
      return { name: evalCase.name, passed: false, detail: `Missing "${needle}".` };
    }
  }
  for (const needle of evalCase.mustNotContain || []) {
    if (needle && text.includes(needle)) {
      return { name: evalCase.name, passed: false, detail: `Contains rejected text "${needle}".` };
    }
  }
  if (evalCase.forbidInventedMetrics) {
    const lines = text.split('\n');
    for (const line of lines) {
      if (INVENTED_METRIC.test(line) && !lineAllowsNumber(line)) {
        return { name: evalCase.name, passed: false, detail: 'Metric number without not_measured or unknown.' };
      }
    }
  }
  return { name: evalCase.name, passed: true };
}

export function runSkillEvals(body: string, extra: readonly SkillEvalCase[] = []): SkillEvalReport {
  const cases = [...BUILTIN_SKILL_EVALS, ...extra].map((evalCase) => evaluateSkillCase(body, evalCase));
  return { passed: cases.every((item) => item.passed), cases };
}

export function failedEvalNames(report: SkillEvalReport): string[] {
  return report.cases.filter((item) => !item.passed).map((item) => item.name);
}
