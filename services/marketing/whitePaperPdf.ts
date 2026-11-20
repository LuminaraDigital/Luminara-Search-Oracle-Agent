/**
 * Text PDF of the white paper, built from the same sections as the page.
 * Workers cannot run a browser, so the file is written at build time.
 */
import { isCited, WHITE_PAPER_H1, WHITE_PAPER_PRODUCT_LINKS, WHITE_PAPER_SHOTS, type Rich } from './whitePaper';
import { WHITE_PAPER_AGENCY_BRIEF, WHITE_PAPER_SECTIONS } from './whitePaperSections';
import { compareSourceIds, WHITE_PAPER_SOURCES } from './whitePaperSources';

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const BOTTOM = 54;

interface PdfLine {
  text: string;
  size: number;
  gap: number;
}

function pdfEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  const pushWord = (word: string) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
      return;
    }
    current = next;
  };
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
    } else {
      pushWord(word);
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function add(lines: PdfLine[], text: string, size: number, gap: number, width: number) {
  for (const line of wrap(text, width)) lines.push({ text: line, size, gap });
}

function richLine(parts: readonly Rich[]): string {
  return parts
    .map((part) => {
      if (!isCited(part)) return part;
      const note = part.note ? `, ${part.note}` : '';
      const body = part.text ? `${part.text} ` : '';
      return `${body}(${part.label}${note}; ${part.sources.join(' ')})`;
    })
    .join('');
}

function documentLines(): PdfLine[] {
  const lines: PdfLine[] = [];
  add(lines, 'Luminara Suite', 11, 16, 80);
  add(lines, WHITE_PAPER_H1, 18, 24, 48);
  add(lines, WHITE_PAPER_AGENCY_BRIEF.title, 14, 20, 64);
  for (const item of WHITE_PAPER_AGENCY_BRIEF.items) add(lines, richLine(item), 11, 15, 90);
  add(lines, '', 11, 10, 90);
  for (const section of WHITE_PAPER_SECTIONS) {
    add(lines, section.title, 14, 20, 64);
    for (const block of section.blocks) {
      if (block.kind === 'p') add(lines, richLine(block.parts), 11, 15, 90);
      if (block.kind === 'ul') {
        for (const item of block.items) add(lines, `- ${richLine(item)}`, 11, 15, 88);
      }
      if (block.kind === 'table') {
        add(lines, block.caption, 11, 15, 90);
        for (const row of block.rows) {
          const cells = row.map((cell, index) => `${block.columns[index]}: ${richLine([cell])}`);
          add(lines, cells.join(' | '), 10, 14, 96);
        }
      }
      if (block.kind === 'shots') {
        for (const file of block.files) add(lines, `Figure. ${WHITE_PAPER_SHOTS[file].caption}`, 10, 14, 96);
      }
      if (block.kind === 'links') {
        for (const link of WHITE_PAPER_PRODUCT_LINKS) add(lines, `${link.label}: ${link.href}`, 10, 14, 96);
      }
    }
    if (section.id === 'sources') {
      const sources = [...WHITE_PAPER_SOURCES].sort((a, b) => compareSourceIds(a.id, b.id));
      for (const source of sources) {
        add(lines, `${source.id}. ${source.title}`, 10, 14, 96);
        for (const url of source.urls) add(lines, url, 9, 12, 100);
      }
    }
    add(lines, '', 11, 8, 90);
  }
  return lines;
}

function paginate(lines: PdfLine[]): PdfLine[][] {
  const pages: PdfLine[][] = [];
  let page: PdfLine[] = [];
  let y = PAGE_H - MARGIN;
  for (const line of lines) {
    if (y - line.gap < BOTTOM) {
      pages.push(page);
      page = [];
      y = PAGE_H - MARGIN;
    }
    page.push(line);
    y -= line.gap;
  }
  if (page.length > 0) pages.push(page);
  return pages.length > 0 ? pages : [[{ text: '', size: 11, gap: 14 }]];
}

function pageStream(lines: PdfLine[]): string {
  let y = PAGE_H - MARGIN;
  const cmds = ['BT'];
  for (const line of lines) {
    cmds.push(`/F1 ${line.size} Tf`);
    cmds.push(`1 0 0 1 ${MARGIN} ${y} Tm`);
    cmds.push(`(${pdfEscape(line.text)}) Tj`);
    y -= line.gap;
  }
  cmds.push('ET');
  return cmds.join('\n');
}

/** Real text PDF. Selectable sentences, not a picture of the page. */
export function whitePaperPdfBytes(): Uint8Array {
  const pages = paginate(documentLines());
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font. Filled after page ids exist.
  objects.push('');
  objects.push('');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (const lines of pages) {
    const stream = pageStream(lines);
    const contentId = objects.length + 1;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = objects.length + 1;
    pageIds.push(pageId);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  let table = `xref\n0 ${objects.length + 1}\n`;
  table += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) table += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += table;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}
