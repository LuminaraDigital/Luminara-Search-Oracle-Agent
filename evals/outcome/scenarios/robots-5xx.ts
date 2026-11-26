import { AI_TXT_GOOD, LLMS_GOOD, ORGANIZATION_JSON_LD, homepage } from '../fakeSite';
import type { Scenario } from '../score';

const scenario: Scenario = {
  id: 'robots-5xx',
  stance: 'regression',
  says: [
    'robots.txt could not be fetched (server error), so the product says crawler access was not measured. It does not say crawlers are allowed or blocked, and offers no robots.txt fix.',
  ],
  site: {
    '/': homepage([ORGANIZATION_JSON_LD]),
    '/robots.txt': { body: 'Service Unavailable', status: 503 },
    '/llms.txt': { body: LLMS_GOOD },
    '/ai.txt': { body: AI_TXT_GOOD },
  },
  expect: {
    checks: { llms_txt: 'pass', llms_structure: 'pass', ai_bot_directives: 'not_measured', cite_paths: 'not_measured', ai_txt: 'pass' },
    fixes: [],
    findings: [],
  },
};

export default scenario;
