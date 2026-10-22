import { CONTACT_EMAIL, OPERATOR_LINE } from '../legal/consumerTerms';
import { MARKETING_FAQ } from '../marketing/marketingFaqContent';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const HOW_LINE = 'You run Instant Audit on your agency site. Luminara checks the site and live web results, then gives a verdict and one fix. Each result is Measured, Estimated, or Not measured.';

export const REFUND_LINE = 'A paid plan lasts 30 days and does not renew, so there is nothing to cancel. For a refund, email info@luminara.digital. Australian Consumer Law still applies.';

const faqItems = MARKETING_FAQ.map((item) => `<h3>${esc(item.question)}</h3><p>${esc(item.answer)}</p>`).join('\n');

/** Noscript body for /faq. The React page renders the same sentences. */
export const FAQ_CRAWLER = `<section>
  <h1>Help</h1>
  <h2>FAQ</h2>
  ${faqItems}
  <h2>How Luminara works</h2>
  <p>${esc(HOW_LINE)}</p>
  <h2>Refunds and cancellation</h2>
  <p>${esc(REFUND_LINE)}</p>
  <p>${esc(OPERATOR_LINE)}</p>
</section>`;

/** Noscript body for /contact. Email only. */
export const CONTACT_CRAWLER = `<section>
  <h1>Contact</h1>
  <p>Email <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>. There is no phone line.</p>
  <form action="mailto:${esc(CONTACT_EMAIL)}" method="post" enctype="text/plain">
    <p><label>Your email<br><input name="email" type="email" required autocomplete="email"></label></p>
    <p><label>Message<br><textarea name="message" required rows="6"></textarea></label></p>
    <p><button type="submit">Email support</button></p>
  </form>
  <h2>Refunds and cancellation</h2>
  <p>${esc(REFUND_LINE)}</p>
  <p>${esc(OPERATOR_LINE)}</p>
</section>`;
