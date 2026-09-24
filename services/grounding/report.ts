import { gateFromSubsetScores } from './gate.ts';
import { macroAverage, scoreSubset } from './score.ts';
import type {
  GroundingExample,
  GroundingPrediction,
  GroundingReport,
  GroundingSubset,
  SubsetScore,
} from './types.ts';

const ORDER: GroundingSubset[] = ['sheets', 'text', 'pro', 'luminara'];

/**
 * Score each subset separately. Never collapse into a single vanity average
 * for gating; macroAverage is informational only.
 */
export function buildGroundingReport(
  examples: GroundingExample[],
  predictions: Map<string, GroundingPrediction>,
  opts?: { required?: GroundingSubset[]; vanityBenchOnly?: boolean },
): GroundingReport {
  const bySubset = new Map<GroundingSubset, GroundingExample[]>();
  for (const ex of examples) {
    const list = bySubset.get(ex.subset) ?? [];
    list.push(ex);
    bySubset.set(ex.subset, list);
  }

  const subsets: SubsetScore[] = [];
  for (const subset of ORDER) {
    const list = bySubset.get(subset);
    if (!list || list.length === 0) continue;
    subsets.push(scoreSubset(subset, list, predictions));
  }

  // Include any unexpected subset keys last.
  for (const [subset, list] of bySubset) {
    if (!ORDER.includes(subset)) {
      subsets.push(scoreSubset(subset, list, predictions));
    }
  }

  return {
    subsets,
    macroAverage: macroAverage(subsets),
    gate: gateFromSubsetScores(subsets, {
      required: opts?.required,
      vanityBenchOnly: opts?.vanityBenchOnly,
    }),
  };
}

export function formatReport(report: GroundingReport): string {
  const lines: string[] = ['Grounding report (per-subset; do not gate on average alone)', '='.repeat(56)];
  for (const s of report.subsets) {
    lines.push(
      `${s.subset.padEnd(10)} ${(s.accuracy * 100).toFixed(2)}%  (${s.hits}/${s.n})  missing=${s.missing}`,
    );
  }
  if (report.macroAverage !== null) {
    lines.push(`macro avg  ${(report.macroAverage * 100).toFixed(2)}%  (informational)`);
  }
  lines.push(`gate       ${report.gate.pass ? 'PASS' : 'FAIL'}`);
  for (const reason of report.gate.reasons) {
    lines.push(`  - ${reason}`);
  }
  return lines.join('\n');
}
