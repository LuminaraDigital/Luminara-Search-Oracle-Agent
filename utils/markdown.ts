import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

// DOMPurify's Node build has no document, so sanitize is absent (isSupported false).
// Browser sessions keep the real sanitizer. Never return unsanitized HTML.
const purify = DOMPurify.isSupported ? DOMPurify : null;

if (purify) {
  // Force links to open safely in a new tab.
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/**
 * Renders model/user markdown to HTML that is safe to place in dangerouslySetInnerHTML.
 * Model output and scraped web content are untrusted; without sanitizing, a page we
 * crawled could inject <img onerror> or <script> into the user's session.
 */
export function renderMarkdown(source: string | null | undefined): string {
  if (!source || !purify) return '';
  const raw = marked.parse(source, { async: false }) as string;
  return purify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'object', 'embed'],
  });
}
