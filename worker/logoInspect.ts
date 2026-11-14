/**
 * Reads a logo URL once at save time. https only, public host, raster bytes, size cap.
 * SVG is refused. Rendering uses an img tag, never inline markup.
 */
import { fetchPublicUrl } from './security';
import { LOGO_MAX_BYTES, logoPayloadOk, parseLogoUrl } from '../services/reports/reportBrand';

async function readCapped(response: Response): Promise<Uint8Array | 'too-big' | 'empty'> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > LOGO_MAX_BYTES) return 'too-big';
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.length > LOGO_MAX_BYTES) return 'too-big';
    return buf.length ? buf : 'empty';
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > LOGO_MAX_BYTES) {
      await reader.cancel();
      return 'too-big';
    }
    chunks.push(step.value);
  }
  if (!total) return 'empty';
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function inspectLogoUrl(raw: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const parsed = parseLogoUrl(raw);
  if (!parsed.ok) return parsed;
  const fetched = await fetchPublicUrl(parsed.url, { method: 'GET' });
  if (!fetched.ok || !fetched.finalUrl.startsWith('https://')) {
    return { ok: false, error: 'That logo could not be read. Use a public https image.' };
  }
  const bytes = await readCapped(fetched.response);
  if (bytes === 'too-big' || bytes === 'empty') {
    return { ok: false, error: 'The logo must be a PNG, JPEG, WEBP, or GIF under 512 KB.' };
  }
  const checked = logoPayloadOk(bytes, fetched.response.headers.get('content-type') || '');
  if (!checked.ok) return checked;
  return { ok: true, url: parsed.url };
}
