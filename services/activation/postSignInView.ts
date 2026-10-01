import { AppView } from '../../types';

/**
 * Where a visitor lands after signing in from the login modal.
 * A pending audit handoff (the Probe domain) or an open Instant Audit wins over Home,
 * so signing in never discards the site they were about to check.
 */
export function viewAfterSignIn(pendingHandoffUrl: string | null | undefined, currentView: AppView): AppView {
  if (pendingHandoffUrl || currentView === AppView.INSTANT_AUDIT) return AppView.INSTANT_AUDIT;
  return AppView.DASHBOARD;
}
