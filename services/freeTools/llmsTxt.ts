/**
 * Free llms.txt generator, following the llmstxt.org layout:
 * an H1 with the site name, a blockquote summary, optional details, then link sections.
 */
import { toHttpUrl } from './httpUrl';

export interface LlmsLink {
  title: string;
  url: string;
  note: string;
}

export interface LlmsSection {
  heading: string;
  links: LlmsLink[];
}

export interface LlmsOptions {
  siteName: string;
  summary: string;
  details: string;
  sections: LlmsSection[];
}

/** One line, no markdown control characters that would break the link syntax. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim();
}

/** Details are plain paragraphs: a leading `#` would add a heading the layout does not allow. */
function plainDetails(value: string): string {
  return value
    .split('\n')
    .map((line) => line.replace(/^\s*#+\s*/, ''))
    .join('\n')
    .trim();
}

/** `(` and `)` would end the markdown link early. */
function linkTarget(url: string): string {
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export function buildLlmsTxt(options: LlmsOptions): string {
  const name = oneLine(options.siteName) || 'Your site';
  const out: string[] = [`# ${name}`, ''];
  const summary = oneLine(options.summary);
  if (summary) out.push(`> ${summary}`, '');
  const details = plainDetails(options.details);
  if (details) out.push(details, '');

  for (const section of options.sections) {
    const rows = section.links
      .map((link) => {
        const url = toHttpUrl(link.url);
        const title = oneLine(link.title);
        if (!url || !title) return null;
        const note = oneLine(link.note);
        const target = linkTarget(url);
        return note ? `- [${title}](${target}): ${note}` : `- [${title}](${target})`;
      })
      .filter((row): row is string => row !== null);
    const heading = oneLine(section.heading);
    if (!rows.length || !heading) continue;
    out.push(`## ${heading}`, ...rows, '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
