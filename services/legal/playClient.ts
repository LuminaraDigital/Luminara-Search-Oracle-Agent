/**
 * Play-distributed Android legal pages.
 * shortcut: the 1.0.2 app opens these URLs without ?client=android, add the query in the 1.0.3 Settings build.
 */
export const ANDROID_LEGAL_LINKS = [
  { label: 'Privacy', href: '/privacy?client=android' },
  { label: 'Terms', href: '/terms?client=android' },
  { label: 'Contact', href: '/contact?client=android' },
  { label: 'Delete account', href: '/delete-account' },
] as const;

export function isAndroidPlayClientSearch(search: string): boolean {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(raw).get('client') === 'android';
}

export function isAndroidPlayClient(): boolean {
  const scope = globalThis as { location?: { search?: string }; window?: { location?: { search?: string } } };
  const search = scope.location?.search ?? scope.window?.location?.search;
  return typeof search === 'string' && isAndroidPlayClientSearch(search);
}
