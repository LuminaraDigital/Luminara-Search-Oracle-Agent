import { AI_TXT_GOOD, ORGANIZATION_JSON_LD, ROBOTS_OPEN, homepage } from '../fakeSite';
import type { Scenario } from '../score';

const scenario: Scenario = {
  id: 'api-error-as-file',
  stance: 'regression',
  says: [
    'The address /llms.txt answers with a JSON error message, not a text file, so the product says llms.txt is missing and offers the llms.txt fix.',
  ],
  site: {
    '/': homepage([ORGANIZATION_JSON_LD]),
    '/robots.txt': { body: ROBOTS_OPEN },
    '/llms.txt': { body: '{"error":"not found"}', type: 'application/json' },
    '/ai.txt': { body: AI_TXT_GOOD },
  },
  expect: {
    checks: { llms_txt: 'fail', llms_structure: 'not_measured', ai_bot_directives: 'pass', cite_paths: 'pass', ai_txt: 'pass' },
    fixes: ['fix-llms-txt'],
    findings: [],
  },
};

export default scenario;
