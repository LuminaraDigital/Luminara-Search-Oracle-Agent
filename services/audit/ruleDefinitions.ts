/**
 * One home for the audit rules' ids, thresholds and type lists, so the browser auditor and the
 * server checks (Allora 3.1) cannot drift. The browser auditor imports the type predicates and
 * the word threshold only; the app-shell rule and the closed code lists are for the server and
 * the label helper.
 */

/** Rule ids the crew attaches to findings (`AuditFinding.ruleId`). */
export const RULE_IDS = {
  zeroCitations: 'finding-zero-citations',
  schemaOrg: 'finding-schema-org',
  schemaOrgPartial: 'finding-schema-org-partial',
  deprecatedHowto: 'finding-deprecated-howto',
  thinContent: 'finding-thin-content',
} as const;
export type RuleId = (typeof RULE_IDS)[keyof typeof RULE_IDS];

/** A page with fewer words of visible text than this is thin. */
export const MIN_WORDS = 250;
/** Server only: under this many words with a script bundle is an app shell, not thin content. */
export const APP_SHELL_MAX_WORDS = 50;
/** A finding names at most this many pages for a re-check. */
export const MAX_TARGET_URLS = 3;

/** The last segment of a schema.org type: `https://schema.org/Corporation` and `schema:Corporation` give `corporation`. */
export function schemaLeaf(type: string): string {
  const trimmed = type.trim().toLowerCase();
  const slash = trimmed.lastIndexOf('/');
  const base = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  const colon = base.lastIndexOf(':');
  const leaf = colon >= 0 ? base.slice(colon + 1) : base;
  const hash = leaf.indexOf('#');
  return (hash >= 0 ? leaf.slice(0, hash) : leaf).trim();
}

/**
 * Organization, a name ending in Organization, Corporation, LocalBusiness,
 * ProfessionalService, or RealEstateAgent.
 * shortcut: other LocalBusiness leaves (Dentist, Store, Hotel) still look missing. Add one when a live page uses it.
 */
export function isOrganizationEntityType(type: string): boolean {
  const leaf = schemaLeaf(type);
  if (!leaf) return false;
  if (leaf.endsWith('organization')) return true;
  return leaf === 'corporation' || leaf === 'localbusiness' || leaf === 'professionalservice' || leaf === 'realestateagent';
}

/** The deprecated how-to type, matched as the auditor always has: the whole type, any case. */
export function isHowToType(type: string): boolean {
  return type.trim().toLowerCase() === 'howto';
}

// ---- Closed lists for the server checks (Allora 3.1 and 3.7). Not imported by the browser auditor. ----

export const CHECK_IDS = ['org_schema_present', 'howto_schema_absent', 'min_words_250'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/** Names shown to users, as a closed list. */
export const CHECK_NAMES: Record<CheckId, string> = {
  org_schema_present: 'Organization schema',
  howto_schema_absent: 'HowTo schema',
  min_words_250: 'Page text length',
};

/** `baseline_code` and `retest_code` values. */
export const RESULT_CODES = [
  'ok',
  'type_missing',
  'howto_present',
  'too_short',
  'app_shell',
  'http_error',
  'not_html',
  'deadline',
  'truncated',
  'unparseable',
  'redirect_off_domain',
  'refused_host',
  'not_run',
  'attempts_exhausted',
] as const;
export type ResultCode = (typeof RESULT_CODES)[number];

/** `checkRefused` values: returned in a response, never stored. */
export const REFUSAL_CODES = [
  'no_domain',
  'plan_limit',
  'decision_cap',
  'open_cap',
  'daily_cap',
  'site_cap',
  'host_backoff',
  'rate_limited',
  'unavailable',
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];
