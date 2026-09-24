import { AppView, ReportFocus } from '../types';

export interface UrlSwapRouteParams {
  view: AppView;
  targetUrl?: string;
  focus?: ReportFocus;
}

/**
 * Parses URL-swap routes like /audit/:target, /geo/:target, /aeo/:target, /seo/:target.
 * Returns AppView.INSTANT_AUDIT with decoded target and mapped focus, or null if not matched.
 */
export const parseUrlSwapRoute = (pathname: string): UrlSwapRouteParams | null => {
  if (!pathname) return null;
  const clean = pathname.replace(/^\/+|\/+$/g, '');
  if (!clean) return null;

  const match = clean.match(/^(audit|geo|aeo|seo)(?:\/(.+))?$/i);
  if (!match) return null;

  const prefix = match[1].toUpperCase();
  const rawTarget = match[2] ? decodeURIComponent(match[2].trim()) : undefined;

  let focus: ReportFocus = 'AEO';
  if (prefix === 'GEO') focus = 'GEO';
  else if (prefix === 'SEO') focus = 'SEO';
  else if (prefix === 'AEO' || prefix === 'AUDIT') focus = 'AEO';

  return {
    view: AppView.INSTANT_AUDIT,
    targetUrl: rawTarget,
    focus,
  };
};
