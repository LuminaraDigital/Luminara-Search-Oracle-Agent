/**
 * Homepage positioning shared by the React page, crawler HTML, and agent markdown.
 * Facts come from plan entitlements, the Worker quota defaults, and the legal lines.
 * No competitor prices, no user counts, no invented guarantees.
 */
import { LEGAL_ABN, LEGAL_ENTITY, REFUND_LINE } from '../legal/consumerTerms';
import { PLAN_ENTITLEMENTS } from '../plans/planEntitlements';
import { LIVE_ANSWER_CHECKS } from './engineCoverage';
import type { HubRow } from './seoHubPages';

/** Worker default in quotaMiddleware.ts: env.FREE_DAILY_LIMIT || 3. wrangler.jsonc sets 3. */
export const FREE_HOSTED_AUDIT_DAILY = 3;

/** Worker default in quotaMiddleware.ts: env.ASK_DAILY_LIMIT ?? 10. wrangler does not override it. */
export const FREE_ASK_DAILY = 10;

export const PROOF_HEADING = 'Measured, Estimated, or Not measured.';

export const PROOF_BODY =
  'Every result carries one of those labels, and the label names how the number was collected. Measured means a live check or data you supplied. Estimated means a directional read from partial data. Not measured means the check did not run, and the gap stays empty. There is no blended score.';

export const STACK_HEADING = 'What an agency would otherwise do by hand.';

export const STACK_INTRO =
  'One Suite plan covers the check, the fix, and a link you can share. The rows below are jobs, not prices.';

export const STACK_ROWS: readonly HubRow[] = [
  {
    label: 'Asking what AI says',
    them: 'Someone pastes buyer questions into a chatbot. The answer comes from what that model remembers. It does not open your live pages for this check.',
    us: 'Instant Audit fetches your public pages and live web search, then labels every result.',
  },
  {
    label: 'A page and schema audit',
    them: 'A separate audit tool, or a spreadsheet of titles, schema, and crawler files.',
    us: 'The same run flags the page leaks and gives copy and schema you can paste.',
  },
  {
    label: 'A consultant write-up',
    them: 'A person reviews the site when you can book them, then sends a list of changes.',
    us: 'You run the check when you need it. A paid pass lasts 30 days and does not renew. It does not replace a rebuild of the site.',
  },
];

/** Named with permission. No quote, photo, years, clients, or awards. */
export const PRACTITIONER = {
  eyebrow: 'Built with agency practitioners',
  heading: 'The checks follow what Kim sees in agencies.',
  name: 'Kim W. Fulwood',
  role: 'Co-founder and business developer at Luminara Digital',
  body: 'Kim visits independent real estate agencies in person, mainly in Melbourne, VIC, and works with them remotely. Suite checks look for the page leaks Kim sees in those agencies day to day.',
} as const;

const free = PLAN_ENTITLEMENTS.free;

export const MCP_HEADING = 'Use Suite from your AI.';

export const MCP_BODY =
  `Free MCP on every plan, for Claude, ChatGPT, Cursor, and Grok when that app can call an HTTP MCP server. Free allows ${free.mcpDailyCallLimit} calls a day. The included tools are projects, context, and reports. Paid research needs Agency or your own DataForSEO login. ${LIVE_ANSWER_CHECKS}`;

export const MCP_DOCS_PATH = '/docs/mcp.html';

export interface TrustItem {
  title: string;
  body: string;
}

export const TRUST_ITEMS: readonly TrustItem[] = [
  {
    title: 'No card to start',
    body: `The free check needs no card and no account. A free account gets ${FREE_HOSTED_AUDIT_DAILY} hosted Instant Audit checks a day and ${FREE_ASK_DAILY} Ask questions a day.`,
  },
  {
    title: 'Nothing to cancel',
    body: REFUND_LINE,
  },
  {
    title: 'Read-only checks',
    body: 'A check reads your public pages. Suite does not change the site unless you connect WordPress, Webflow, or GitHub and ask it to.',
  },
  {
    title: 'Australian company',
    body: `${LEGAL_ENTITY}, ABN ${LEGAL_ABN}, founded 2025. Victoria, Australia.`,
  },
];
