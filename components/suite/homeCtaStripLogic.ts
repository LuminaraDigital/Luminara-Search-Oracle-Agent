/**
 * Pure decision logic for the zero-audit home CTA strip.
 * Kept separate from the component so it can be unit-tested without a
 * DOM/component-test harness (this repo's vitest runs node env only).
 */

import { AppView } from '../../types';
import { auditHistoryService } from '../../services/audit/auditHistoryService';

export const HOME_CTA_HEADING = 'Run your first audit';
export const HOME_CTA_SUB =
  'Get an honest SEO, AEO and GEO read on one URL in ~1-2 minutes.';
export const HOME_CTA_PRIMARY_LABEL = 'Start Instant Audit';
export const HOME_CTA_SECONDARY_LABEL = 'Set up Business DNA first';
export const HOME_CTA_IDEA_LABEL = 'No domain yet? Idea Scout';

/** Audit count from the persisted audit history source (localStorage-backed). */
export function auditCountFromStorage(): number {
  try {
    return auditHistoryService.list().length;
  } catch {
    return 0;
  }
}

export function shouldShowHomeCta(auditCount: number): boolean {
  return auditCount === 0;
}

export type HomeCtaAction = 'primary' | 'secondary' | 'idea';

/** Which app view each CTA navigates to. */
export function homeCtaTarget(action: HomeCtaAction): AppView {
  if (action === 'primary') return AppView.INSTANT_AUDIT;
  if (action === 'idea') return AppView.IDEA_SCOUT;
  return AppView.BUSINESS_DNA;
}
