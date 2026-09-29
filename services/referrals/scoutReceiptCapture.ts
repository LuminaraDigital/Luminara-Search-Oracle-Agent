/**
 * Latest Worker scout receipt seen on this page load.
 * The header is set only after a signed-in evidence call. Qualify sends it once.
 */

let pending: string | null = null;

export function noteScoutReceipt(header: string | null): void {
  const token = String(header || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(token)) return;
  pending = token;
}

export function takeScoutReceipt(): string | null {
  const token = pending;
  pending = null;
  return token;
}

export function clearScoutReceipt(): void {
  pending = null;
}
