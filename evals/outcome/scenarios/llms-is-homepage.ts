import { AI_TXT_GOOD, ORGANIZATION_JSON_LD, ROBOTS_OPEN, homepage } from '../fakeSite';
import type { Scenario } from '../score';

const scenario: Scenario = {
  id: 'llms-is-homepage',
  stance: 'regression',
  says: [
    'The address /llms.txt answers with the homepage, not a text file, so the product says llms.txt is missing and offers the llms.txt fix.',
  ],
  site: {
    '/': homepage([ORGANIZATION_JSON_LD]),
    '/robots.txt': { body: ROBOTS_OPEN },
    '/llms.txt': homepage([ORGANIZATION_JSON_LD]),
    '/ai.txt': { body: AI_TXT_GOOD },
  },
  expect: {
    checks: { llms_txt: 'fail', llms_structure: 'not_measured', ai_bot_directives: 'pass', cite_paths: 'pass', ai_txt: 'pass' },
    fixes: ['fix-llms-txt'],
    findings: [],
  },
};

export default scenario;
