/**
 * One config for the industries Suite sells into.
 * Real estate agency is the default and keeps today's checks and report heading.
 */

export const INDUSTRY_CHECK_IDS = [
  'schema',
  'nap',
  'agent_pages',
  'agent_profile',
  'area_pages',
  'listing_pages',
  'gbp',
  'reviews',
  'answer_prompts',
] as const;

export type IndustryCheckId = (typeof INDUSTRY_CHECK_IDS)[number];

export const INDUSTRY_IDS = [
  'real_estate_agency',
  'individual_agent',
  'buyers_agent',
  'property_manager',
  'mortgage_broker',
  'conveyancer',
  'building_pest_inspector',
  'property_media',
  'home_stylist',
  'property_copywriter',
  'digital_marketing_agency',
  'property_developer',
  'property_trades',
  'strata_manager',
  'franchise_head_office',
] as const;

export type IndustryId = (typeof INDUSTRY_IDS)[number];

export const DEFAULT_INDUSTRY_ID: IndustryId = 'real_estate_agency';

export interface IndustryProfile {
  id: IndustryId;
  label: string;
  defaultChecks: readonly IndustryCheckId[];
  /** Placeholders are <service> and <suburb>. */
  keywordTemplate: string;
  competitorHints: readonly string[];
  reportHeading: string;
  reportAudience: string;
}

const LOCAL: readonly IndustryCheckId[] = ['schema', 'nap', 'gbp', 'reviews', 'answer_prompts'];
const LOCAL_AREA: readonly IndustryCheckId[] = [...LOCAL, 'area_pages'];
const ALL: readonly IndustryCheckId[] = INDUSTRY_CHECK_IDS;

export const INDUSTRY_PROFILES: readonly IndustryProfile[] = [
  {
    id: 'real_estate_agency',
    label: 'Real estate agency',
    defaultChecks: ALL,
    keywordTemplate: '<service> <suburb>',
    competitorHints: ['real estate agency <suburb>', 'other agencies in <suburb>'],
    reportHeading: 'Real estate checks',
    reportAudience: 'buyers and vendors',
  },
  {
    id: 'individual_agent',
    label: 'Individual agent',
    defaultChecks: ['schema', 'nap', 'agent_profile', 'area_pages', 'listing_pages', 'gbp', 'reviews', 'answer_prompts'],
    keywordTemplate: '<service> <suburb>',
    competitorHints: ['real estate agent <suburb>'],
    reportHeading: 'Agent checks',
    reportAudience: 'buyers and vendors',
  },
  {
    id: 'buyers_agent',
    label: 'Buyers agent',
    defaultChecks: LOCAL_AREA,
    keywordTemplate: 'buyers agent <suburb>',
    competitorHints: ['buyers agent <suburb>', 'buyer advocacy <suburb>'],
    reportHeading: 'Buyers agent checks',
    reportAudience: 'buyers',
  },
  {
    id: 'property_manager',
    label: 'Property manager',
    defaultChecks: LOCAL_AREA,
    keywordTemplate: 'property manager <suburb>',
    competitorHints: ['property management <suburb>'],
    reportHeading: 'Property management checks',
    reportAudience: 'landlords and tenants',
  },
  {
    id: 'mortgage_broker',
    label: 'Mortgage broker',
    defaultChecks: LOCAL,
    keywordTemplate: 'mortgage broker <suburb>',
    competitorHints: ['mortgage broker <suburb>'],
    reportHeading: 'Mortgage broker checks',
    reportAudience: 'borrowers',
  },
  {
    id: 'conveyancer',
    label: 'Conveyancer',
    defaultChecks: LOCAL,
    keywordTemplate: 'conveyancer <suburb>',
    competitorHints: ['conveyancer <suburb>', 'property lawyer <suburb>'],
    reportHeading: 'Conveyancer checks',
    reportAudience: 'buyers and sellers',
  },
  {
    id: 'building_pest_inspector',
    label: 'Building and pest inspector',
    defaultChecks: LOCAL_AREA,
    keywordTemplate: 'building and pest inspection <suburb>',
    competitorHints: ['building inspector <suburb>', 'pest inspection <suburb>'],
    reportHeading: 'Building and pest checks',
    reportAudience: 'buyers',
  },
  {
    id: 'property_media',
    label: 'Photographer, videographer, or floor plan',
    defaultChecks: ['schema', 'nap', 'gbp', 'reviews'],
    keywordTemplate: 'property photographer <suburb>',
    competitorHints: ['real estate photographer <suburb>', 'floor plan <suburb>'],
    reportHeading: 'Property media checks',
    reportAudience: 'agents booking a shoot',
  },
  {
    id: 'home_stylist',
    label: 'Stylist or home staging',
    defaultChecks: LOCAL,
    keywordTemplate: 'home staging <suburb>',
    competitorHints: ['home stylist <suburb>'],
    reportHeading: 'Staging checks',
    reportAudience: 'vendors and agents',
  },
  {
    id: 'property_copywriter',
    label: 'Copywriter, print, or signage',
    defaultChecks: ['schema', 'nap', 'gbp'],
    keywordTemplate: 'real estate copywriter <suburb>',
    competitorHints: ['real estate copywriter <suburb>', 'signage <suburb>'],
    reportHeading: 'Copy and signage checks',
    reportAudience: 'agents and vendors',
  },
  {
    id: 'digital_marketing_agency',
    label: 'Digital marketing agency',
    defaultChecks: LOCAL,
    keywordTemplate: 'real estate marketing <suburb>',
    competitorHints: ['real estate marketing agency <suburb>'],
    reportHeading: 'Marketing agency checks',
    reportAudience: 'agency clients',
  },
  {
    id: 'property_developer',
    label: 'Developer or off-the-plan marketer',
    defaultChecks: ['schema', 'nap', 'area_pages', 'listing_pages', 'gbp', 'reviews', 'answer_prompts'],
    keywordTemplate: 'off the plan <suburb>',
    competitorHints: ['off the plan apartments <suburb>', 'property developer <suburb>'],
    reportHeading: 'Developer checks',
    reportAudience: 'buyers',
  },
  {
    id: 'property_trades',
    label: 'Trades, removalist, or cleaner',
    defaultChecks: LOCAL_AREA,
    keywordTemplate: '<service> <suburb>',
    competitorHints: ['<service> <suburb>'],
    reportHeading: 'Trade checks',
    reportAudience: 'home movers and agents',
  },
  {
    id: 'strata_manager',
    label: 'Strata manager',
    defaultChecks: LOCAL,
    keywordTemplate: 'strata manager <suburb>',
    competitorHints: ['strata management <suburb>'],
    reportHeading: 'Strata checks',
    reportAudience: 'owners corporations',
  },
  {
    id: 'franchise_head_office',
    label: 'Franchise head office',
    defaultChecks: ['schema', 'nap', 'agent_pages', 'area_pages', 'gbp', 'reviews', 'answer_prompts'],
    keywordTemplate: '<service> <suburb>',
    competitorHints: ['<service> franchise <suburb>'],
    reportHeading: 'Franchise checks',
    reportAudience: 'franchise owners',
  },
];

const BY_ID = new Map<IndustryId, IndustryProfile>(INDUSTRY_PROFILES.map((profile) => [profile.id, profile]));

export function isIndustryId(value: string): value is IndustryId {
  for (const id of INDUSTRY_IDS) {
    if (id === value) return true;
  }
  return false;
}

export function parseIndustryId(value: unknown): IndustryId | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return isIndustryId(id) ? id : null;
}

/** undefined means the caller left it out. null means the value is not an industry id. */
export function readOptionalIndustry(value: unknown): IndustryId | undefined | null {
  if (value === undefined) return undefined;
  return parseIndustryId(value);
}

export function industryProfile(id: string | null | undefined): IndustryProfile {
  if (id && isIndustryId(id)) {
    const found = BY_ID.get(id);
    if (found) return found;
  }
  const fallback = BY_ID.get(DEFAULT_INDUSTRY_ID);
  if (fallback) return fallback;
  return INDUSTRY_PROFILES[0];
}

export function listIndustryProfiles(): IndustryProfile[] {
  return INDUSTRY_PROFILES.map((profile) => ({ ...profile, defaultChecks: [...profile.defaultChecks], competitorHints: [...profile.competitorHints] }));
}

function fill(template: string, service: string, suburb: string): string {
  return template.replaceAll('<service>', service).replaceAll('<suburb>', suburb).replace(/\s+/g, ' ').trim();
}

export function fillKeywordTemplate(
  profile: IndustryProfile,
  vars: { service?: string; suburb?: string },
): string {
  return fill(profile.keywordTemplate, (vars.service || '').trim(), (vars.suburb || '').trim());
}

export function competitorDiscoveryHints(
  profile: IndustryProfile,
  vars: { service?: string; suburb?: string },
): string[] {
  const service = (vars.service || '').trim();
  const suburb = (vars.suburb || '').trim();
  const hints = profile.competitorHints.map((hint) => fill(hint, service, suburb)).filter(Boolean);
  return [...new Set(hints)];
}

export function filterChecksForIndustry<T extends { id: string }>(
  checks: readonly T[],
  industryId?: string | null,
): T[] {
  if (!industryId) return [...checks];
  const allowed = new Set<string>(industryProfile(industryId).defaultChecks);
  return checks.filter((check) => allowed.has(check.id));
}
