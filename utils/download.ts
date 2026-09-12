/**
 * Centralized utility for triggering browser file downloads from a Blob, string, or Uint8Array.
 * Handles DOM element creation, object URL lifecycle management, and cleanup.
 */
export function downloadBlob(
  content: Blob | string | Uint8Array,
  filename: string,
  mimeType: string = 'application/octet-stream'
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const blob = content instanceof Blob 
    ? content 
    : new Blob([content], { type: mimeType });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
