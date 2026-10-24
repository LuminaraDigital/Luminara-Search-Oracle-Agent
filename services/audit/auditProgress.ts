/** Crew order: read the site, search the web, then the auditor checks crawler files, then the write-up. */
export const AUDIT_STEPS = [
  'Reading your site',
  'Searching the web for your agency',
  'Checking AI crawler access',
  'Writing your fixes',
] as const;

/** General practice. No rates, scores, or counts. */
export const AGENCY_TIPS = [
  'A suburb page gives an answer engine a local page to quote.',
  'The same name, address, and phone on the site and the profile is easier to match.',
  'A direct answer in the first paragraph is easier to quote than a slogan.',
  'robots.txt and llms.txt tell crawlers which pages they may read.',
] as const;

export type AuditStepIndex = 0 | 1 | 2 | 3;

/** Map a live crew message onto a step. Unknown lines stay on reading so a later max() does not invent progress. */
export function auditStepIndex(message: string): AuditStepIndex {
  const text = message.toLowerCase();
  if (/synth|translat|remediat|patch|plain english|writing your fix|executive report|executive summary/.test(text)) {
    return 3;
  }
  if (/crawler|robots\.txt|llms\.txt|ai\.txt|playbook|compliance audit|auditing \d/.test(text)) {
    return 2;
  }
  if (/web search|search result|search provider|serp|citation rate|share of voice|other sites/.test(text)) {
    return 1;
  }
  return 0;
}

/** Steps only move forward. A later message that does not name a stage leaves the current one. */
export function advanceAuditStep(previous: number, message: string): AuditStepIndex {
  const next = auditStepIndex(message);
  const held = previous <= next ? next : previous;
  if (held <= 0) return 0;
  if (held === 1) return 1;
  if (held === 2) return 2;
  return 3;
}
