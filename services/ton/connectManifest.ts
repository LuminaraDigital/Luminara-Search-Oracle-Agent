export function tonConnectManifestUrl(): string {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (origin && origin !== 'null' && (origin.startsWith('http://') || origin.startsWith('https://'))) {
      return new URL('tonconnect-manifest.json', origin).toString();
    }
  } catch {
    /* fallback */
  }
  return 'https://www.luminarasuite.com/tonconnect-manifest.json';
}
