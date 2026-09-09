export type ShipCommitment = {
  actionId: string;
  label: string;
  committedAt: number;
};

const STORAGE_PREFIX = 'luminara_ship_commit_';
const memoryFallback = new Map<string, string>();

export function fingerprintReport(text: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(text.length, 4000); i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return `fp${Math.abs(h).toString(36)}`;
}

function storageKey(domain: string, reportFingerprint: string): string {
  return `${STORAGE_PREFIX}${domain.trim().toLowerCase()}::${reportFingerprint.slice(0, 48)}`;
}

function readRaw(key: string): string | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(key);
    }
  } catch {
    /* fall through */
  }
  return memoryFallback.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(key, value);
      return;
    }
  } catch {
    /* fall through */
  }
  memoryFallback.set(key, value);
}

export function readShipCommitment(domain: string, markdownText: string): ShipCommitment | null {
  try {
    const raw = readRaw(storageKey(domain || 'unknown', fingerprintReport(markdownText)));
    if (!raw) return null;
    return JSON.parse(raw) as ShipCommitment;
  } catch {
    return null;
  }
}

export function writeShipCommitment(domain: string, markdownText: string, commitment: ShipCommitment): void {
  writeRaw(
    storageKey(domain || 'unknown', fingerprintReport(markdownText)),
    JSON.stringify(commitment),
  );
}
