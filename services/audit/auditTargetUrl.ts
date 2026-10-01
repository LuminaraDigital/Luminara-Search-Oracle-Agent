/**
 * Instant Audit URL gate. Prefill and manual entry share this check so a
 * hosted rail cannot spend provider quota on a non-public host.
 */
import { safePublicHostname } from '../security/publicHostname';

export function validateAuditTargetUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 'Please enter a website address or domain (for example, yourbrand.com).';
  }
  if (!safePublicHostname(trimmed)) {
    return 'Enter a public website such as luminaradigital.io. Local hosts, IP addresses, and private suffixes are not audited.';
  }
  return null;
}
