import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateHtml } from '../worker/agentReportService';

describe('M-25 agent report HTML validation hardening', () => {
  it('allows clean HTML reports with headings, tables, lists, inline CSS, safe meta, and https links', () => {
    const clean = [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      '  <title>Quarterly Audit</title>',
      '  <style>body{font-family:system-ui,sans-serif;color:#111}table{border-collapse:collapse}</style>',
      '</head>',
      '<body>',
      '  <h1>Visibility Audit</h1>',
      '  <p style="color:#333">Online = true, one = 1.</p>',
      '  <table><thead><tr><th>Query</th><th>Cited</th></tr></thead><tbody><tr><td>seo</td><td>Yes</td></tr></tbody></table>',
      '  <ul><li><a href="https://example.com/guide?online=true&on_sale=1">Read guide</a></li></ul>',
      '</body>',
      '</html>',
    ].join('\n');
    expect(validateHtml(clean)).toBeNull();
  });

  it('rejects active and dangerous HTML elements', () => {
    const forbidden = [
      '<html><body><svg onload="alert(1)"></svg></body></html>',
      '<html><body><svg><animate onbegin="alert(1)"></animate></svg></body></html>',
      '<html><body><math><mtext></mtext></math></body></html>',
      '<html><head><meta http-equiv="refresh" content="0;url=https://evil.com"></head><body></body></html>',
      '<html><head><meta charset="utf-7"></head><body></body></html>',
      '<html><head><meta name="referrer" content="unsafe-url"></head><body></body></html>',
      '<html><head><base href="https://evil.com/"></head><body></body></html>',
      '<html><body><form action="https://evil.com"><button>Submit</button></form></body></html>',
      '<html><head><link rel="stylesheet" href="https://evil.com/x.css"></head><body></body></html>',
      '<html><body><script/src="https://evil.com/x.js"></script></body></html>',
      '<html><body><iframe/src="https://evil.com"></iframe></body></html>',
      '<html><body><object data="https://evil.com/x.swf"></object></body></html>',
      '<html><body><embed src="https://evil.com/x.swf"></body></html>',
      '<html><body><applet code="Evil.class"></applet></body></html>',
    ];
    for (const payload of forbidden) {
      expect(validateHtml(payload), payload).not.toBeNull();
    }
  });

  it('rejects HTML-entity-encoded javascript, vbscript, and data URI schemes', () => {
    const encoded = [
      '<html><body><a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">x</a></body></html>',
      '<html><body><a href="&#0000000000106&#97&#118&#97&#115&#99&#114&#105&#112&#116&#58alert(1)">x</a></body></html>',
      '<html><body><a href="&#x6a;avascript&#x3a;alert(1)">x</a></body></html>',
      '<html><body><a href="javascript&colon;alert(1)">x</a></body></html>',
      '<html><body><a href="java&#x09;script:alert(1)">x</a></body></html>',
      '<html><body><a href="j&#x0a;avascript:alert(1)">x</a></body></html>',
      '<html><body><a href="&amp;#106;avascript:alert(1)">x</a></body></html>',
      '<html><body><a href="vbscript:msgbox(1)">x</a></body></html>',
      '<html><body><a href="&#x76;bscript&colon;msgbox(1)">x</a></body></html>',
      '<html><body><a href="data:text/html,<script>alert(1)</script>">x</a></body></html>',
      '<html><body><img src="data&#58;image/svg+xml;base64,PHN2Zz4="></body></html>',
      '<html><body><div style="background:url(javascript:alert(1))">x</div></body></html>',
      '<html><body><div style="background:u\\rl(\\6a avascript:alert(1))">x</div></body></html>',
      '<html><body><div style="background:u\\rl(ja\\vascript:alert(1))">x</div></body></html>',
      '<html><body><div style="width:e\\xpression(alert(1))">x</div></body></html>',
      '<html><head><style>@import url(https://evil.com/a.css);</style></head><body></body></html>',
      '<html><head><style>@\\import u\\rl(https://evil.com/a.css);</style></head><body></body></html>',
    ];
    for (const payload of encoded) {
      expect(validateHtml(payload), payload).not.toBeNull();
    }
  });

  it('rejects event-handler bypasses using /, whitespace, quotes, or control chars', () => {
    const handlers = [
      '<html><body><img/onerror=alert(1)></body></html>',
      '<html><body><img src=x/onerror=alert(1)></body></html>',
      '<html><body><img src="x"onerror="alert(1)"></body></html>',
      '<html><body><img src="x"/onerror="alert(1)"></body></html>',
      '<html><body><img\tonerror="alert(1)"></body></html>',
      '<html><body><img\nonerror="alert(1)"></body></html>',
      '<html><body><img\fonerror="alert(1)"></body></html>',
      '<html><body><img\x00onerror="alert(1)"></body></html>',
      '<html><body><div onclick\t\n = "alert(1)">x</div></body></html>',
    ];
    for (const payload of handlers) {
      expect(validateHtml(payload), payload).toMatch(/inline event handlers/i);
    }
  });

  it('AgentReportView iframe sandbox omits allow-popups-to-escape-sandbox', () => {
    const src = readFileSync('components/audit/AgentReportView.tsx', 'utf8');
    expect(src).toContain('sandbox="allow-popups"');
    expect(src).not.toContain('allow-popups-to-escape-sandbox');
  });
});
