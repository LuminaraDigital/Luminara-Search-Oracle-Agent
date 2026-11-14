import { AI_TXT_GOOD, LLMS_GOOD, ORGANIZATION_JSON_LD, ROBOTS_OPEN, homepage } from '../fakeSite';
import type { Scenario } from '../score';

const scenario: Scenario = {
  id: 'clean-control',
  stance: 'regression',
  says: [
    'Nothing is wrong with this site, so the product reports no fault and suggests no fix.',
  ],
  site: {
    '/': homepage([ORGANIZATION_JSON_LD]),
    '/robots.txt': { body: ROBOTS_OPEN },
    '/llms.txt': { body: LLMS_GOOD },
    '/ai.txt': { body: AI_TXT_GOOD },
  },
  expect: {
    checks: { llms_txt: 'pass', llms_structure: 'pass', ai_bot_directives: 'pass', cite_paths: 'pass', ai_txt: 'pass' },
    fixes: [],
    findings: [],
  },
};

export default scenario;
