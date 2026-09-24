/**
 * Stable finding keys so weekly re-audits upsert work-item status instead of duplicating cards.
 */

function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase()
    .trim();
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Fast non-crypto fingerprint suitable for stable_key uniqueness within an account+domain. */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function findingStableKey(domain: string, category: string, title: string): string {
  const material = `${normalizeDomain(domain)}|${category.trim().toLowerCase()}|${normalizeTitle(title)}`;
  return `fk_${fnv1aHex(material)}_${fnv1aHex(material.split('').reverse().join(''))}`;
}
