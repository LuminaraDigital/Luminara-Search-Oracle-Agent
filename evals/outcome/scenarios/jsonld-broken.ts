import { AI_TXT_GOOD, LLMS_GOOD, ORGANIZATION_JSON_LD, ROBOTS_OPEN, homepage } from '../fakeSite';
import type { Scenario } from '../score';

const scenario: Scenario = {
  id: 'jsonld-broken',
  stance: 'regression',
  says: [
    'One schema block on the homepage is malformed, so the product says a schema block cannot be read. It does not say the site has no schema, because the business identity tag beside it reads fine.',
  ],
  site: {
    '/': homepage([ORGANIZATION_JSON_LD, '{"@context":"https://schema.org","@type":"Product","name":"Filter",}']),
    '/robots.txt': { body: ROBOTS_OPEN },
    '/llms.txt': { body: LLMS_GOOD },
    '/ai.txt': { body: AI_TXT_GOOD },
  },
  expect: {
    checks: { llms_txt: 'pass', llms_structure: 'pass', ai_bot_directives: 'pass', cite_paths: 'pass', ai_txt: 'pass' },
    fixes: [],
    findings: ['finding-schema-org-broken'],
  },
};

export default scenario;
