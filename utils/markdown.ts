import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Renders model/user markdown to HTML that is safe to place in dangerouslySetInnerHTML.
 * Model output and scraped web content are untrusted; without sanitizing, a page we
 * crawled could inject <img onerror> or <script> into the user's session.
 */
export function renderMarkdown(source: string | null | undefined): string {
  if (!source) return '';
  const raw = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'object', 'embed'],
  });
}

// Force links to open safely in a new tab.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});
