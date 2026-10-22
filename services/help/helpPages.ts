import { CONTACT_EMAIL } from '../legal/consumerTerms';
import { MARKETING_FAQ } from '../marketing/marketingFaqContent';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const REFUND = 'A paid plan lasts 30 days and does not renew, so there is nothing to cancel. For a refund, email info@luminara.digital. Australian Consumer Law still applies.';
const HOW = 'You run Instant Audit on your agency site. Luminara checks the site and live web results, then gives a verdict and one fix. Each result is Measured, Estimated, or Not measured.';

function page(title: string, path: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <title>${esc(title)} | Luminara Suite</title>
  <meta name="description" content="${esc(title)}. Email ${esc(CONTACT_EMAIL)}.">
  <link rel="canonical" href="https://www.luminarasuite.com${path}">
</head>
<body>
  <main>
    <h1>${esc(title)}</h1>
    ${body}
    <p><a href="/faq">FAQ</a> · <a href="/contact">Contact</a> · <a href="/how-it-works">How Luminara works</a> · <a href="/pricing">Pricing</a></p>
  </main>
</body>
</html>
`;
}

const faqItems = MARKETING_FAQ.map((item) => `<h3>${esc(item.question)}</h3><p>${esc(item.answer)}</p>`).join('\n');

export const FAQ_HTML = page('Help', '/faq', `
    <h2>FAQ</h2>
    ${faqItems}
    <h2>How Luminara works</h2>
    <p>${esc(HOW)}</p>
    <h2>Refunds and cancellation</h2>
    <p>${esc(REFUND)}</p>
`);

export const CONTACT_HTML = page('Contact', '/contact', `
    <p>Email <a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>. There is no phone line.</p>
    <form action="mailto:${esc(CONTACT_EMAIL)}" method="post" enctype="text/plain">
      <p><label>Your email<br><input name="email" type="email" required autocomplete="email"></label></p>
      <p><label>Message<br><textarea name="message" required rows="6"></textarea></label></p>
      <p><button type="submit">Email support</button></p>
    </form>
    <h2>Refunds and cancellation</h2>
    <p>${esc(REFUND)}</p>
`);

export const REFUND_LINE = REFUND;
