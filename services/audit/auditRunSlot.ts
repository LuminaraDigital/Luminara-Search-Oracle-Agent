/** The open Instant Audit run. providerFetch reads it; chat does not. */
const TOKEN_HEADER = 'x-audit-run';
const DOMAIN_HEADER = 'x-audit-domain';

let token = '';
let domain = '';

export function setAuditRun(next: { token: string; domain: string } | null): void {
  token = next?.token?.trim() || '';
  domain = next?.domain?.trim() || '';
}

export function currentAuditRun(): { token: string; domain: string } | null {
  return token && domain ? { token, domain } : null;
}

export function auditRunHeaders(): Record<string, string> {
  if (!token || !domain) return {};
  return { [TOKEN_HEADER]: token, [DOMAIN_HEADER]: domain };
}
