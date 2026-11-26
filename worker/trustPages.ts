/**
 * Public security page (/security) and subprocessor list (/legal/subprocessors).
 * Every statement here is checked against the code on this branch. Keep it that way:
 * no certifications, no locations, and no claims a reviewer cannot trace to a file.
 * Legal wording needs the owner's sign-off before it ships.
 */
import { OPERATOR_LINE } from '../services/legal/consumerTerms';
import { escapePolicyText } from '../services/legal/privacyCrawler';

export const TRUST_PAGES_UPDATED = '26 November 2026';

export interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
}

/** Same vendors as the privacy policy, in the same words. */
export const SUBPROCESSORS: Subprocessor[] = [
  { name: 'Cloudflare', purpose: 'Hosting, the Worker, D1 database, KV, R2, Durable Objects, request logs, and the Workers AI backup model.', data: 'All account and workspace data we store, and request logs.' },
  { name: 'Google Firebase', purpose: 'Sign-in with email and password or Google.', data: 'Email, display name, and sign-in credentials.' },
  { name: 'Stripe', purpose: 'Card payments.', data: 'Card payment details. We keep only the plan id, expiry, and checkout session id.' },
  { name: 'Telegram', purpose: 'Mini App identity, Stars payments, and bot alerts.', data: 'Telegram user id, name, username, language, and Stars charge ids.' },
  { name: 'Resend', purpose: 'Account email: the welcome email, and the weekly report if you turn it on.', data: 'Email address, the name used in the greeting, and the email content.' },
  { name: 'Sentry', purpose: 'Error reports, when error reporting is switched on.', data: 'Error details, with sign-in headers, cookies, email, username, and IP address removed first.' },
  { name: 'Groq, NVIDIA NIM, Google Gemini, OpenRouter', purpose: 'AI models for audits and chat.', data: 'Prompts, URLs, page text, and the linked business profile.' },
  { name: 'Typesafe', purpose: 'Checking some answers.', data: 'Search result snippets and business names. Not your prompt.' },
  { name: 'Tavily, Exa, Firecrawl', purpose: 'Search and crawl evidence.', data: 'Search queries, URLs, and page text from the check you run.' },
  { name: 'DataForSEO', purpose: 'Keyword, search result, domain, and backlink research.', data: 'The keywords and domains you ask about.' },
  { name: 'Google PageSpeed Insights', purpose: 'Page speed checks.', data: 'The URL being checked.' },
  { name: 'The Open Network and Toncenter', purpose: 'Checking an on-chain payment, only when you pay with TON.', data: 'The payment amount, memo, and transaction hash.' },
];

/** Tools that only run when you configure them yourself. */
export const OPTIONAL_TOOLS = 'LanguageTool and Umami run only if you turn them on. Ollama runs on a machine you choose.';

export const SECURITY_POINTS: Array<{ title: string; text: string }> = [
  { title: 'Hosting', text: 'Luminara Suite runs on Cloudflare Workers. Data is stored in Cloudflare D1, KV, R2, and Durable Objects.' },
  { title: 'In transit', text: 'The site is served over HTTPS with HTTP Strict Transport Security and a Content Security Policy.' },
  { title: 'Sign-in', text: 'Website accounts use Firebase Authentication with email and password or Google. Telegram accounts are checked against the signed launch data Telegram sends (HMAC-SHA256). Hosted model keys are only used for signed-in accounts.' },
  { title: 'Your API keys', text: 'Keys you paste stay on your device. When workspace sync uploads them, they are encrypted in your browser first with AES-256-GCM, using a key derived with PBKDF2-SHA-256 (100,000 iterations) from a secret kept in that browser. If that encryption fails, the keys are not uploaded. Other workspace content is stored as you saved it, without that encryption.' },
  { title: 'Payments', text: 'Stripe processes card payments. We do not store card numbers.' },
  { title: 'Connected AI assistants', text: 'Assistants connect with OAuth and your Allow. We store hashes of their access and refresh tokens, never the tokens. A connection lapses after 90 days without use, and you can disconnect it in Settings.' },
  { title: 'Audit log', text: 'Selected actions, such as admin actions, payment credits, workspace sync and deletion, domain verification, and assistant tool decisions, are written to a hash-chained audit log. Changing a row, or removing any row except the newest, breaks the chain and can be detected.' },
  { title: 'Roles', text: 'Organization roles exist today for viewing the audit log. Other actions are limited to the signed-in account, not to a role.' },
  { title: 'Error reports', text: 'When error reporting is switched on, sign-in headers, cookies, email, username, and IP address are removed before a report is sent to Sentry.' },
  { title: 'Your data', text: 'Signed-in users can download an export of their data and delete their account from Settings. Cloudflare D1 Time Travel can restore the database for 30 days. A deleted account is not restored from it unless the law requires it.' },
  { title: 'Certifications', text: 'This page does not claim any third-party security certification.' },
];

function staticPage(opts: { title: string; description: string; path: string; eyebrow: string; heading: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${opts.title} | Luminara Suite</title>
  <meta name="description" content="${escapePolicyText(opts.description)}">
  <meta name="theme-color" content="#000000">
  <link rel="canonical" href="https://www.luminarasuite.com${opts.path}">
  <link rel="icon" href="/favicon.ico" sizes="48x48 32x32 16x16">
  <link rel="stylesheet" href="/static-chrome.css">
</head>
<body>
  <nav class="site-nav" aria-label="Site">
    <a class="brand" href="/">Luminara Suite</a>
    <div class="links">
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/security">Security</a>
      <a href="/legal/subprocessors">Subprocessors</a>
    </div>
  </nav>
  <main class="static-main">
    <p class="eyebrow">${opts.eyebrow}</p>
    <h1>${opts.heading}</h1>
    <p class="meta">Luminara Suite · Operated by ${OPERATOR_LINE} · Founded 2025 · Last updated ${TRUST_PAGES_UPDATED}</p>
${opts.body}
  </main>
</body>
</html>
`;
}

export function buildSecurityHtml(): string {
  const points = SECURITY_POINTS.map(
    (point) => `    <section>\n      <h2>${escapePolicyText(point.title)}</h2>\n      <p>${escapePolicyText(point.text)}</p>\n    </section>`,
  ).join('\n');
  const body = `    <p>How Luminara Suite protects your account and data, in plain words. The full detail is in the <a href="/privacy">privacy policy</a>.</p>
    <section>
      <h2>Report a vulnerability</h2>
      <p>Email <a href="mailto:security@luminarasuite.com">security@luminarasuite.com</a> with a description, steps to reproduce, and the impact. We acknowledge reports within 3 business days. Please give us a reasonable window to fix the issue before you disclose it, and do not open a public GitHub issue.</p>
    </section>
${points}
    <section>
      <h2>Who else handles data</h2>
      <p>See the <a href="/legal/subprocessors">subprocessor list</a>.</p>
    </section>`;
  return staticPage({
    title: 'Security',
    description: 'How Luminara Suite protects accounts and data, and how to report a vulnerability.',
    path: '/security',
    eyebrow: 'Security',
    heading: 'Security',
    body,
  });
}

export function buildSubprocessorsHtml(): string {
  const rows = SUBPROCESSORS.map(
    (s) => `<tr><th scope="row">${escapePolicyText(s.name)}</th><td>${escapePolicyText(s.purpose)}</td><td>${escapePolicyText(s.data)}</td></tr>`,
  ).join('\n');
  const body = `    <p>These companies process personal information for us so the product can work. They match the list in the <a href="/privacy">privacy policy</a>. Some are outside Australia. We send each one only what its step needs.</p>
    <table class="policy-table">
<caption>Subprocessors</caption>
<thead><tr><th scope="col">Company</th><th scope="col">What for</th><th scope="col">Data it receives</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
    <p>${escapePolicyText(OPTIONAL_TOOLS)}</p>
    <p>Questions: <a href="mailto:privacy@luminarasuite.com">privacy@luminarasuite.com</a>.</p>`;
  return staticPage({
    title: 'Subprocessors',
    description: 'The companies that process personal information for Luminara Suite, and what each receives.',
    path: '/legal/subprocessors',
    eyebrow: 'Legal',
    heading: 'Subprocessors',
    body,
  });
}

export const SECURITY_HTML = buildSecurityHtml();
export const SUBPROCESSORS_HTML = buildSubprocessorsHtml();

const SECURITY_PATHS = new Set(['/security', '/security/']);
const SUBPROCESSOR_PATHS = new Set(['/legal/subprocessors', '/legal/subprocessors/', '/subprocessors']);

/** Returns the page for a trust path, or null. */
export function trustPageResponse(pathname: string): Response | null {
  const html = SECURITY_PATHS.has(pathname) ? SECURITY_HTML : SUBPROCESSOR_PATHS.has(pathname) ? SUBPROCESSORS_HTML : null;
  if (!html) return null;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
