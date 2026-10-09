/**
 * Spoken Register Audio Synthesizer
 * Adapted from OpenMausBot (server/tts/speech-text.ts, Apache 2.0).
 *
 * Converts markdown audit reports and agent outputs into clear, natural prose
 * for speech synthesis: Gemini Live Voice, Telegram Mini App voice notes,
 * and executive audio briefings.
 * Say the prose, name the artifacts, drop the syntax noise.
 * No em dashes in copy.
 */

function describeCodeBlock(fence: string): string {
  const lang = fence.trim().split(/\s+/)[0]?.replace(/[^a-z0-9+#]/gi, '') ?? '';
  const spokenLanguages: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript',
    js: 'JavaScript',
    jsx: 'JavaScript',
    py: 'Python',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    json: 'JSON',
    jsonld: 'JSON-LD schema',
    yml: 'YAML',
    yaml: 'YAML',
    sql: 'SQL',
    html: 'HTML',
    css: 'CSS',
  };
  const name = spokenLanguages[lang.toLowerCase()];
  return name ? `. (a ${name} code block) ` : '. (a code block) ';
}

function shortenPaths(text: string): string {
  return text.replace(/(?:[\w.@-]+\/){1,}([\w.-]+\.\w{1,6})\b/g, '$1');
}

const ENDS_SENTENCE = /[.!?:;]\s*$/;

/**
 * Markdown or agent analysis -> clean, speakable prose.
 */
export function speakableText(input: string): string {
  if (!input) return '';
  let text = input;

  // 1. Fenced code blocks
  text = text.replace(
    /```([^\n]*)\n[\s\S]*?(?:```|$)/g,
    (_m, fence: string) => describeCodeBlock(fence)
  );
  text = text.replace(
    /~~~([^\n]*)\n[\s\S]*?(?:~~~|$)/g,
    (_m, fence: string) => describeCodeBlock(fence)
  );

  // 2. Images before links
  text = text.replace(
    /!\[([^\]]*)\]\([^)]*\)/g,
    (_m, alt: string) => (alt ? `. (image: ${alt}) ` : '. (an image) ')
  );

  // 3. Links: [label](url) -> label; bare URLs -> ' a link '
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  text = text.replace(/<https?:\/\/[^>\s]+>/g, ' a link ');
  text = text.replace(/\bhttps?:\/\/\S+/g, ' a link ');

  // 4. Tables: strip separator lines, turn table cells into comma-separated text
  text = text.replace(/^\s*\|?[\s:-]*\|[\s|:-]*$/gm, '');
  text = text.replace(/^\s*\|(.+)\|\s*$/gm, (_m, row: string) =>
    row
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(', ')
  );

  // 5. Shorten directory-heavy file paths before evaluating inline code lengths
  text = shortenPaths(text);

  // 6. Inline code: short identifiers kept for context, long snippets simplified
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    code.length <= 45 ? code : ' that snippet '
  );

  // 7. Headings become sentences so voice pauses naturally
  text = text.replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, (_m, head: string) =>
    ENDS_SENTENCE.test(head) ? head : `${head.trim()}.`
  );

  // 8. List markers and blockquotes
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+[.)]\s+/gm, '');
  text = text.replace(/^\s*>\s?/gm, '');
  text = text.replace(/^\s*(?:[-*_]\s*){3,}$/gm, '');

  // 9. Markdown emphasis
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2');
  text = text.replace(/~~(.*?)~~/g, '$1');

  // 10. Normalize whitespace
  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');

  return text.replace(/\s+/g, ' ').trim();
}
