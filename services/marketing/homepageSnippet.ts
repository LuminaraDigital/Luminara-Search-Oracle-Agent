/**
 * The homepage read in the free check (G1c): what the page itself writes for search, and the
 * fix for each gap. Shared by the Worker probe and the landing result. No DOM.
 *
 * Honesty: these fields are read from the page, so they are Measured as page facts. They are not
 * what Google shows; Google can rewrite titles and snippets, and Google stays Not measured here.
 */
import { checkDescription, checkTitle } from '../freeTools/serpPreview';
import { safePublicHostname } from '../security/publicHostname';

/** Parsed head fields only. The page HTML itself is never returned or stored. */
export interface HomepageHead {
  status: number;
  /** Where the read ended after redirects. */
  finalUrl: string;
  title: string | null;
  description: string | null;
  canonical: string | null;
  h1: string | null;
  /** True when an og:image tag is present. The image is never fetched or shown. */
  ogImage: boolean;
  jsonLdTypes: string[];
  /** A robots meta tag or X-Robots-Tag header asks search engines not to index the page. */
  noindex: boolean;
}

/** Why the homepage could not be read. One coarse code per case, never a raw error. */
export type HomepageReadFailure = 'unreachable' | 'blocked' | 'http_error' | 'not_html';

export const HOMEPAGE_FAILURE_TEXT: Record<HomepageReadFailure, string> = {
  unreachable: 'We could not reach your homepage just now.',
  blocked: 'Your site blocked our check, so the homepage was not read.',
  http_error: 'Your homepage answered with an error, so it was not read.',
  not_html: 'Your homepage did not answer with a web page, so it was not read.',
};

export type SnippetCheckState = 'ok' | 'fix' | 'warn';

export interface SnippetCheck {
  id: 'title' | 'description' | 'noindex' | 'schema' | 'llms';
  label: string;
  state: SnippetCheckState;
  text: string;
  /** Free tool that fixes this gap, when there is one. */
  fixPath?: string;
}

const SERP_TOOL = '/free-tools/serp-preview';

/** One line per field, in the order an owner should fix them. */
export function snippetChecks(head: HomepageHead, llmsPresent: boolean): SnippetCheck[] {
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
  checks.push(
    title.verdict === 'empty'
      ? { id: 'title', label: 'Title', state: 'fix', text: 'Missing. Google will write its own.', fixPath: SERP_TOOL }
      : title.verdict === 'truncated'
        ? { id: 'title', label: 'Title', state: 'fix', text: 'Too wide. Google will likely cut it.', fixPath: SERP_TOOL }
        : { id: 'title', label: 'Title', state: 'ok', text: `${title.chars} characters. Fits.` },
  );

  const description = checkDescription(head.description ?? '', 'desktop');
  checks.push(
    description.verdict === 'empty'
      ? {
        id: 'description',
        label: 'Description',
        state: 'fix',
        text: 'Missing. Google picks text from the page instead.',
        fixPath: SERP_TOOL,
      }
      : description.verdict === 'truncated'
        ? { id: 'description', label: 'Description', state: 'fix', text: 'Too long. Google will likely cut it.', fixPath: SERP_TOOL }
        : { id: 'description', label: 'Description', state: 'ok', text: `${description.chars} characters. Fits.` },
  );

  checks.push(
    head.jsonLdTypes.length
      ? { id: 'schema', label: 'Structured data', state: 'ok', text: `Found: ${head.jsonLdTypes.join(', ')}.` }
      : {
        id: 'schema',
        label: 'Structured data',
        state: 'fix',
        text: 'None found on the homepage.',
        fixPath: '/free-tools/schema-generator',
      },
  );

  checks.push(
    llmsPresent
      ? { id: 'llms', label: 'llms.txt', state: 'ok', text: 'Found.' }
      : { id: 'llms', label: 'llms.txt', state: 'fix', text: 'Missing.', fixPath: '/free-tools/llms-txt-generator' },
  );
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
