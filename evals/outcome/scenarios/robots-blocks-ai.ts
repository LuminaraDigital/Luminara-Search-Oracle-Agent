import { AI_TXT_GOOD, LLMS_GOOD, ORGANIZATION_JSON_LD, homepage } from '../fakeSite';
import type { Scenario } from '../score';

const scenario: Scenario = {
  id: 'robots-blocks-ai',
  stance: 'regression',
  says: [
    'robots.txt blocks GPTBot, ClaudeBot and PerplexityBot, so the product says AI crawlers are blocked and offers the robots.txt fix.',
  ],
  site: {
    '/': homepage([ORGANIZATION_JSON_LD]),
    '/robots.txt': { body: 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n' },
    '/llms.txt': { body: LLMS_GOOD },
    '/ai.txt': { body: AI_TXT_GOOD },
  },
  expect: {
    checks: { llms_txt: 'pass', llms_structure: 'pass', ai_bot_directives: 'fail', cite_paths: 'fail', ai_txt: 'pass' },
    fixes: ['fix-robots-txt'],
    findings: [],
  },
};

export default scenario;
