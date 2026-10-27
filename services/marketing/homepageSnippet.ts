/**
 * The homepage read in the free check (G1c): what the page itself writes for search, and the
 * fix for each gap. Shared by the Worker probe and the landing result. No DOM.
 *
 * Honesty: these fields are read from the page, so they are Measured as page facts. They are not
 * what Google shows; Google can rewrite titles and snippets, and Google stays Not measured here.
 */
import { checkDescription, checkTitle, type SerpDevice } from '../freeTools/serpPreview';
import { safePublicHostname } from '../security/publicHostname';
import type { FreeTool } from './freeTools';

/** Parsed head fields only, each at most 300 characters. The page HTML is never returned or stored. */
export interface HomepageHead {
  /** Where the read ended after redirects. */
  finalUrl: string;
  title: string | null;
  description: string | null;
  jsonLdTypes: string[];
  /** A robots meta tag or X-Robots-Tag header asks search engines not to index the page. */
  noindex: boolean;
}

/** Why the homepage could not be read. One coarse code per case, never a raw error. */
export type HomepageReadFailure = 'unreachable' | 'blocked' | 'http_error' | 'not_html';

export const HOMEPAGE_FAILURE_TEXT: Record<HomepageReadFailure, string> = {
  unreachable: 'We could not read your homepage. It may be slow, down, or refusing automated checks. Try again in a minute.',
  blocked:
    "Your site's security turned our check away, so the homepage was not read. This is common and does not tell us whether Google can read it.",
  http_error:
    'Your homepage answered our check with an error. Some sites do this only for automated checks, so open it in your browser to be sure.',
  not_html: 'Your homepage did not answer our check with a web page, so it was not read.',
};

export type SnippetCheckState = 'ok' | 'fix' | 'warn';

export interface SnippetCheck {
  id: 'title' | 'description' | 'noindex' | 'schema';
  label: string;
  state: SnippetCheckState;
  text: string;
  /** Free tool that writes the fix, when there is one. */
  fixPath?: FreeTool['path'];
}

const SERP_TOOL: FreeTool['path'] = '/free-tools/serp-preview';
const SCHEMA_TOOL: FreeTool['path'] = '/free-tools/schema-generator';
/**
 * LocalBusiness and its direct schema.org subtypes: what tells Google a business serves a place.
 * WebSite or Organization alone does not, so the check suggests the schema generator.
 */
const LOCAL_BUSINESS_TYPES = new Set([
  'LocalBusiness', 'RealEstateAgent', 'ProfessionalService', 'AnimalShelter', 'ArchiveOrganization',
  'AutomotiveBusiness', 'ChildCare', 'Dentist', 'DryCleaningOrLaundry', 'EmergencyService', 'EmploymentAgency',
  'EntertainmentBusiness', 'FinancialService', 'FoodEstablishment', 'GovernmentOffice', 'HealthAndBeautyBusiness',
  'HomeAndConstructionBusiness', 'InternetCafe', 'LegalService', 'Library', 'LodgingBusiness', 'MedicalBusiness',
  'RadioStation', 'RecyclingCenter', 'SelfStorage', 'ShoppingCenter', 'SportsActivityLocation', 'Store',
  'TelevisionStation', 'TouristInformationCenter', 'TravelAgency',
]);

function lengthCheck(
  id: 'title' | 'description',
  label: string,
  verdict: ReturnType<typeof checkTitle>['verdict'],
  chars: number,
  missing: string,
): SnippetCheck {
  if (verdict === 'empty') return { id, label, state: 'fix', text: missing, fixPath: SERP_TOOL };
  if (verdict === 'truncated') return { id, label, state: 'fix', text: 'Too long. Google will likely cut it.', fixPath: SERP_TOOL };
  if (verdict === 'short') return { id, label, state: 'warn', text: 'Short. Say what you do and where.', fixPath: SERP_TOOL };
  return { id, label, state: 'ok', text: `${chars} characters. Should fit.` };
}

/**
 * One line per field, in the order an owner should fix them. Lengths are estimates of Google's cut;
 * the description is judged for the same device the preview card shows.
 */
export function snippetChecks(head: HomepageHead, device: SerpDevice = 'desktop'): SnippetCheck[] {
  const checks: SnippetCheck[] = [];
  if (head.noindex) {
    checks.push({
      id: 'noindex',
      label: 'Indexing',
      state: 'warn',
      text: 'Your homepage asks search engines not to index it. Remove the noindex rule if you want it found.',
    });
  }

  const title = checkTitle(head.title ?? '');
  checks.push(lengthCheck('title', 'Title', title.verdict, title.chars, 'No title tag in the homepage HTML. Google will write its own.'));
  const description = checkDescription(head.description ?? '', device);
  checks.push(
    lengthCheck(
      'description',
      'Description',
      description.verdict,
      description.chars,
      'No meta description in the homepage HTML. Google picks text from the page instead.',
    ),
  );

  const types = head.jsonLdTypes;
  if (!types.length) {
    checks.push({ id: 'schema', label: 'Structured data', state: 'fix', text: 'No JSON-LD found in the homepage HTML.', fixPath: SCHEMA_TOOL });
  } else if (!types.some((type) => LOCAL_BUSINESS_TYPES.has(type))) {
    checks.push({
      id: 'schema',
      label: 'Structured data',
      state: 'warn',
      text: `Found: ${types.join(', ')}. No LocalBusiness-type schema found, such as RealEstateAgent.`,
      fixPath: SCHEMA_TOOL,
    });
  } else {
    checks.push({ id: 'schema', label: 'Structured data', state: 'ok', text: `Found: ${types.join(', ')}.` });
  }

  return checks;
}

/** Path of the shareable free check for a host. Opening it runs the check again. */
export function checkPathForHost(host: string): string {
  return `/check/${encodeURIComponent(host)}`;
}

/** The public host in a /check/<host> path, or null. Same hostname rules as the Worker fetch guard. */
export function checkHostFromPath(pathname: string): string | null {
  const match = /^\/check\/([^/]+)\/?$/i.exec(pathname);
  if (!match) return null;
  let raw: string;
  try {
    raw = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return safePublicHostname(raw);
}
