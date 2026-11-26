import { OPERATOR_LINE } from './consumerTerms';
import { PRIVACY_INTRO, PRIVACY_SECTIONS, type PrivacyTable } from './privacyCopy';

export function escapePolicyText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function privacyTableHtml(table: PrivacyTable): string {
  const head = table.head.map((cell) => `<th scope="col">${escapePolicyText(cell)}</th>`).join('');
  const rows = table.rows
    .map(([label, value]) => `<tr><th scope="row">${escapePolicyText(label)}</th><td>${escapePolicyText(value)}</td></tr>`)
    .join('\n');
  return `<table class="policy-table">\n<caption>${escapePolicyText(table.caption)}</caption>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`;
}

export function privacySectionsHtml(): string {
  return PRIVACY_SECTIONS.map((section) => {
    const paragraphs = (section.paragraphs || []).map((paragraph) => `<p>${escapePolicyText(paragraph)}</p>`).join('\n');
    const bullets = section.bullets?.length
      ? `<ul>\n${section.bullets.map((item) => `<li>${escapePolicyText(item)}</li>`).join('\n')}\n</ul>`
      : '';
    const table = section.table ? privacyTableHtml(section.table) : '';
    return `<section>\n<h2>${escapePolicyText(section.title)}</h2>\n${paragraphs}\n${bullets}${table ? `\n${table}` : ''}\n</section>`;
  }).join('\n');
}

/** Noscript body for /privacy. Same words as the in-app policy. */
export function privacyCrawlerBody(): string {
  return `<section>
  <h1>Privacy Policy</h1>
  <p>${escapePolicyText(OPERATOR_LINE)}</p>
  <p>${escapePolicyText(PRIVACY_INTRO)}</p>
  ${privacySectionsHtml()}
</section>`;
}
