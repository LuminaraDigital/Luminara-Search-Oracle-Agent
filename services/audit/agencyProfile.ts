const HOSTS = {
  realestateProfileUrl: 'realestate.com.au',
  domainProfileUrl: 'domain.com.au',
} as const;

export type PortalField = keyof typeof HOSTS;

/** Empty is valid. A filled value must be https on the portal host. */
export function optionalPortalUrl(value: string, host: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const name = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol === 'https:' && name === host) return url.toString();
  } catch {
    return null;
  }
  return null;
}

export function portalHost(field: PortalField): string {
  return HOSTS[field];
}
