// Rewrites evals/outcome/gate.json for the regression scenarios that pass. Review the diff before committing.
import { spawnSync } from 'node:child_process';

const run = spawnSync('npx', ['vitest', 'run', 'tests/outcomeEvals.test.ts'], {
  env: { ...process.env, OUTCOME_PROMOTE: '1' },
  stdio: 'inherit',
  shell: true,
});
process.exit(run.status ?? 1);
