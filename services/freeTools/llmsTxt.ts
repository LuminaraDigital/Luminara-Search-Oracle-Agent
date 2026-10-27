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

export function buildLlmsTxt(options: LlmsOptions): string {
  const name = oneLine(options.siteName) || 'Your site';
  const out: string[] = [`# ${name}`, ''];
  const summary = oneLine(options.summary);
  if (summary) out.push(`> ${summary}`, '');
  const details = options.details.trim();
  if (details) out.push(details, '');

  for (const section of options.sections) {
    const rows = section.links
      .map((link) => {
        const url = toHttpUrl(link.url);
        const title = oneLine(link.title);
        if (!url || !title) return null;
        const note = oneLine(link.note);
        return note ? `- [${title}](${url}): ${note}` : `- [${title}](${url})`;
      })
      .filter((row): row is string => row !== null);
    const heading = oneLine(section.heading);
    if (!rows.length || !heading) continue;
    out.push(`## ${heading}`, ...rows, '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
