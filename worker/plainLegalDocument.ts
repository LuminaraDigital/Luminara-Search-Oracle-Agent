import { ANDROID_LEGAL_LINKS } from '../services/legal/playClient';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Nav for Play-distributed pages. No Pricing link. */
export function androidLegalNavHtml(): string {
  const links = ANDROID_LEGAL_LINKS.map((link) => `<a href="${esc(link.href)}">${esc(link.label)}</a>`).join('\n    ');
  return `<nav>\n    ${links}\n  </nav>`;
}

/** Self-contained legal HTML. Callers pass already-safe body markup. */
export function plainLegalDocument(input: {
  title: string;
  description: string;
  canonicalPath: string;
  main: string;
  footer: string;
}): string {
  const title = esc(input.title);
  const description = esc(input.description);
  const canonical = esc(`https://www.luminarasuite.com${input.canonicalPath}`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Luminara Suite</title>
  <meta name="description" content="${description}">
  <meta name="theme-color" content="#0a0a0a">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.ico" sizes="48x48 32x32 16x16">
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #e2e8f0; line-height: 1.65; max-width: 42rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    a { color: #BF953F; }
    h1 { font-size: 1.75rem; margin: 0 0 0.5rem; color: #FCF6BA; }
    h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.12em; color: #BF953F; margin: 1.75rem 0 0.5rem; }
    p, li { margin: 0 0 0.75rem; color: #cbd5e1; font-size: 0.95rem; }
    nav a { margin-right: 1rem; font-size: 0.8rem; text-decoration: none; }
    footer { margin-top: 2.5rem; font-size: 0.75rem; color: #64748b; }
    label { display: block; margin-bottom: 0.25rem; }
    input, textarea { width: 100%; box-sizing: border-box; margin-bottom: 0.75rem; padding: 0.6rem 0.7rem; background: #000; color: #e2e8f0; border: 1px solid #BF953F33; border-radius: 0.75rem; }
    button { min-height: 2.75rem; padding: 0.5rem 1rem; border: 0; border-radius: 999px; background: #BF953F; color: #0a0a0a; font-weight: 600; }
  </style>
</head>
<body>
  ${androidLegalNavHtml()}
  <h1>${title}</h1>
  <main>
    ${input.main}
  </main>
  <footer>&copy; 2026 ${esc(input.footer)}</footer>
</body>
</html>
`;
}
