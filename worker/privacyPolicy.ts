/**
 * Static privacy document kept byte-equal with public/privacy.html.
 * Visitors to /privacy get the marketing shell, not this file.
 */
import { OPERATOR_LINE } from '../services/legal/consumerTerms';
import { PRIVACY_INTRO, PRIVACY_UPDATED } from '../services/legal/privacyCopy';
import { escapePolicyText, privacySectionsHtml } from '../services/legal/privacyCrawler';

export const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy | Luminara Suite</title>
  <meta name="description" content="Privacy policy for Luminara Suite, the Telegram Mini App, and the Telegram bot. What we collect, who else receives it, and your rights.">
  <meta name="theme-color" content="#000000">
  <meta property="og:title" content="Privacy Policy | Luminara Suite">
  <meta property="og:description" content="Privacy policy for Luminara Suite.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://luminarasuite.com/privacy">
  <meta property="og:image" content="https://www.luminarasuite.com/og-image.png">
  <link rel="canonical" href="https://www.luminarasuite.com/privacy">
  <link rel="icon" href="/favicon.ico" sizes="48x48 32x32 16x16">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
  <link rel="stylesheet" href="/static-chrome.css">
</head>
<body>
  <nav class="site-nav" aria-label="Site">
    <a class="brand" href="/">Luminara Suite</a>
    <div class="links">
      <a href="/why">Why</a>
      <a href="/how-it-works">How it works</a>
      <a href="/ai">AI</a>
      <a href="/pricing">Pricing</a>
      <a class="start" href="/">Start free</a>
    </div>
  </nav>
  <main class="static-main">
    <p class="eyebrow">Privacy</p>
    <h1>Privacy policy</h1>
    <p class="meta">Luminara Suite · Operated by ${OPERATOR_LINE} · Last updated ${PRIVACY_UPDATED}</p>
    <p>${escapePolicyText(PRIVACY_INTRO)}</p>
    ${privacySectionsHtml()}
    <p class="meta"><a href="/terms">Terms of Service</a> · <a href="/">Home</a></p>
  </main>
</body>
</html>
`;
