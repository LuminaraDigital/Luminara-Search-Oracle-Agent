/**
 * HTML sanitization, entity encoding/decoding, and tag stripping utilities.
 */

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A numeric character reference as text, or the reference unchanged when it is not a valid code point. */
function fromCodePoint(raw: string, radix: number): string | null {
  const code = Number.parseInt(raw, radix);
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
    ? String.fromCodePoint(code)
    : null;
}

export function decodeEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    // Numeric references such as WordPress's &#8211; (en dash) and &#x2019; (apostrophe).
    .replace(/&#x([0-9a-f]{1,6});/gi, (ref, hex: string) => fromCodePoint(hex, 16) ?? ref)
    .replace(/&#([0-9]{1,7});/g, (ref, dec: string) => fromCodePoint(dec, 10) ?? ref)
    .replace(/&amp;/gi, '&');
}

export function stripTags(html: string): string {
  if (!html) return '';
  let text = decodeEntities(html);
  // Remove script and style blocks completely
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Recursively strip tags to prevent bypass with nested tags
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, ' ');
  } while (text !== previous);

  text = text.replace(/<[^>]*$/, '');
  return text.replace(/\s+/g, ' ').trim();
}
