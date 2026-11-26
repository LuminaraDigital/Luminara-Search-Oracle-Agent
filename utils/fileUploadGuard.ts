/**
 * Canonical client-side file upload validator (M-28).
 * Enforces size caps, explicit extension allowlists, and rejects executable double extensions.
 */
export const MAX_CLIENT_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const DANGEROUS_EXT_RE = /\.(php\d?|phtml|exe|dll|sh|bash|bat|cmd|ps1|vbs|js|mjs|cjs|html?|xhtml|svg|jar|msi|scr|com)$/i;

export function validateClientUploadFile(
  file: Pick<File, 'name' | 'size' | 'type'>,
  opts: { allowedExtensions: readonly string[]; maxBytes?: number },
): { ok: true } | { ok: false; error: string } {
  const maxBytes = opts.maxBytes ?? MAX_CLIENT_UPLOAD_BYTES;
  const name = String(file.name || '').trim();
  if (!name || name.includes('\0') || name.includes('/') || name.includes('\\')) {
    return { ok: false, error: 'Invalid file name.' };
  }
  if (DANGEROUS_EXT_RE.test(name)) {
    return { ok: false, error: 'Executable or script file types are not permitted.' };
  }
  const lower = name.toLowerCase();
  const allowed = opts.allowedExtensions.map((ext) => (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`));
  const dotIdx = lower.lastIndexOf('.');
  const ext = dotIdx >= 0 ? lower.slice(dotIdx) : '';
  if (!ext || !allowed.includes(ext)) {
    return { ok: false, error: `Unsupported file type. Allowed: ${allowed.join(', ')}.` };
  }
  // Reject double extensions that smuggle an executable suffix right before the final extension (e.g. report.php.csv or x.html.txt).
  const stem = lower.slice(0, dotIdx);
  if (DANGEROUS_EXT_RE.test(stem)) {
    return { ok: false, error: 'Double file extensions containing executable types are not permitted.' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: 'Selected file is empty.' };
  }
  if (file.size > maxBytes) {
    const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    return { ok: false, error: `File exceeds the ${mb} MB limit.` };
  }
  return { ok: true };
}
