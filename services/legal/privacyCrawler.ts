import { OPERATOR_LINE } from './consumerTerms';
import { PRIVACY_INTRO, PRIVACY_SECTIONS } from './privacyCopy';

export function escapePolicyText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function privacySectionsHtml(): string {
  return PRIVACY_SECTIONS.map((section) => {
    const paragraphs = (section.paragraphs || []).map((paragraph) => `<p>${escapePolicyText(paragraph)}</p>`).join('\n');
    const bullets = section.bullets?.length
      ? `<ul>\n${section.bullets.map((item) => `<li>${escapePolicyText(item)}</li>`).join('\n')}\n</ul>`
      : '';
    return `<section>\n<h2>${escapePolicyText(section.title)}</h2>\n${paragraphs}\n${bullets}\n</section>`;
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
