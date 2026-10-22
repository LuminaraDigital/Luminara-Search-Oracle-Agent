/** Fired after an audit is saved or a mission changes, so an open dashboard can reload. */
export const AUDIT_ACTIVITY_EVENT = 'luminara-audit-activity';

export function notifyAuditActivity(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new Event(AUDIT_ACTIVITY_EVENT));
}
