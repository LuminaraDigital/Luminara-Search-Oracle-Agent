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

export function decodeEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
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
