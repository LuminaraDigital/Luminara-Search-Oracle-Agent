import {
  isCited,
  WHITE_PAPER_PRODUCT_LINKS,
  WHITE_PAPER_SHOTS,
  type Cited,
  type Rich,
} from './whitePaper';
import { WHITE_PAPER_SECTIONS } from './whitePaperSections';
import { compareSourceIds, whitePaperSource, WHITE_PAPER_SOURCES } from './whitePaperSources';

function visitPart(
  part: Rich,
  visit: (text: string, cited: Cited | null, where: string) => void,
  where: string,
) {
  if (isCited(part)) visit(part.text, part, where);
  else visit(part, null, where);
}

/** Walks reader-facing copy. Source notes are excluded: each note sits on its own link. */
export function visitCopy(visit: (text: string, cited: Cited | null, where: string) => void): void {
  for (const section of WHITE_PAPER_SECTIONS) {
    visit(section.title, null, `${section.id}.title`);
    visit(section.nav, null, `${section.id}.nav`);
    section.blocks.forEach((block, index) => {
      const where = `${section.id}.${block.kind}.${index}`;
      if (block.kind === 'p') {
        block.parts.forEach((part, partIndex) => visitPart(part, visit, `${where}.${partIndex}`));
      }
      if (block.kind === 'ul') {
        block.items.forEach((item, itemIndex) => {
          item.forEach((part, partIndex) => visitPart(part, visit, `${where}.${itemIndex}.${partIndex}`));
        });
      }
      if (block.kind === 'table') {
        visit(block.caption, null, `${where}.caption`);
        block.columns.forEach((column, columnIndex) => visit(column, null, `${where}.column.${columnIndex}`));
        block.rows.forEach((row, rowIndex) => {
          row.forEach((part, cellIndex) => visitPart(part, visit, `${where}.cell.${rowIndex}.${cellIndex}`));
        });
      }
      if (block.kind === 'shots') {
        block.files.forEach((file) => {
          const shot = WHITE_PAPER_SHOTS[file];
          visit(shot.alt, null, `${where}.${file}.alt`);
          visit(shot.caption, null, `${where}.${file}.caption`);
        });
      }
    });
  }
  for (const link of WHITE_PAPER_PRODUCT_LINKS) {
    visit(link.label, null, `link.${link.label}`);
  }
}

export function uncitedDigitSpans(): string[] {
  const found: string[] = [];
  visitCopy((text, cited, where) => {
    if (!/\d/.test(text)) return;
    if (!cited || cited.sources.length === 0) found.push(`${where}: ${text}`);
  });
  return found;
}

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function citedHtml(part: Cited): string {
  const chip = `${esc(part.label)}${part.note ? `, ${esc(part.note)}` : ''}`;
  const links = part.sources
    .map((id) => {
      const source = whitePaperSource(id);
      return `<a href="${esc(source.urls[0])}">${esc(id)}</a>`;
    })
    .join(' ');
  const body = part.text ? `${esc(part.text)} ` : '';
  return `${body}<span>${chip}</span> ${links}`;
}

function richHtml(parts: readonly Rich[]): string {
  return parts.map((part) => (isCited(part) ? citedHtml(part) : esc(part))).join('');
}

/** Noscript body. Same sentences as the page, with source links. */
export function whitePaperCrawlerHtml(): string {
  const chunks: string[] = ['<article>', '<h1>White paper</h1>'];
  for (const section of WHITE_PAPER_SECTIONS) {
    chunks.push(`<section id="${esc(section.id)}">`);
    chunks.push(`<h2>${esc(section.title)}</h2>`);
    for (const block of section.blocks) {
      if (block.kind === 'p') chunks.push(`<p>${richHtml(block.parts)}</p>`);
      if (block.kind === 'ul') {
        chunks.push(`<ul>${block.items.map((item) => `<li>${richHtml(item)}</li>`).join('')}</ul>`);
      }
      if (block.kind === 'table') {
        const head = block.columns.map((column) => `<th>${esc(column)}</th>`).join('');
        const body = block.rows
          .map((row) => `<tr>${row.map((cell) => `<td>${richHtml([cell])}</td>`).join('')}</tr>`)
          .join('');
        chunks.push(`<table><caption>${esc(block.caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      }
      if (block.kind === 'shots') {
        for (const file of block.files) {
          const shot = WHITE_PAPER_SHOTS[file];
          chunks.push(
            `<figure><img src="/marketing/white-paper/${esc(file)}" alt="${esc(shot.alt)}" /><figcaption>${esc(shot.caption)}</figcaption></figure>`,
          );
        }
      }
      if (block.kind === 'links') {
        chunks.push(
          `<ul>${WHITE_PAPER_PRODUCT_LINKS.map((link) => `<li><a href="${esc(link.href)}">${esc(link.label)}</a></li>`).join('')}</ul>`,
        );
      }
    }
    if (section.id === 'sources') {
      const sources = [...WHITE_PAPER_SOURCES].sort((a, b) => compareSourceIds(a.id, b.id));
      chunks.push('<ul>');
      for (const source of sources) {
        const links = source.urls.map((url) => `<a href="${esc(url)}">${esc(url)}</a>`).join(' ');
        chunks.push(
          `<li id="src-${esc(source.id)}"><strong>${esc(source.id)}</strong> ${esc(source.title)}. ${links} Accessed 2 November 2026. ${esc(source.notes)}</li>`,
        );
      }
      chunks.push('</ul>');
    }
    chunks.push('</section>');
  }
  chunks.push('</article>');
  return chunks.join('\n');
}
