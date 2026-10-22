import { getAudit, listAudits, type AuditHistoryEntry } from './auditHistoryService';

export function auditReportHash(id: string): string {
  return `#instant_audit/${encodeURIComponent(id)}`;
}

export function auditIdFromHash(hash: string): string {
  const match = hash.replace(/^#/, '').match(/^instant_audit\/([^/?#]+)$/i);
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

export function auditFromHash(hash: string): AuditHistoryEntry | null {
  const id = auditIdFromHash(hash);
  return id ? getAudit(id) : null;
}

/** Point the address bar at the newest saved report for this domain. */
export function publishReportHash(domain: string): void {
  if (typeof window === 'undefined') return;
  const entry = listAudits({ domain, limit: 1 })[0] || listAudits({ limit: 1 })[0];
  if (!entry) return;
  const next = `/${auditReportHash(entry.id)}`;
  if (`${window.location.pathname}${window.location.hash}` === next) return;
  window.history.replaceState(null, '', next);
}
