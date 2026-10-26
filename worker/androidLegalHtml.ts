/**
 * Play-distributed legal pages. Static HTML so the response has no Pricing nav
 * even when JavaScript does not run.
 */
import { CONTACT_EMAIL, OPERATOR_LINE } from '../services/legal/consumerTerms';
import {
  DELETE_ACCOUNT_INTRO,
  DELETE_ACCOUNT_OPERATOR,
  DELETE_ACCOUNT_RETENTION,
  DELETE_ACCOUNT_STEPS,
  SUPPORT_EMAIL,
} from '../services/legal/deleteAccountCopy';
import { PRIVACY_INTRO, PRIVACY_UPDATED } from '../services/legal/privacyCopy';
import { escapePolicyText, privacySectionsHtml } from '../services/legal/privacyCrawler';
import { isAndroidPlayClientSearch } from '../services/legal/playClient';
import { marketingShellKey } from '../services/marketing/pageMeta';
import { plainLegalDocument } from './plainLegalDocument';

const PLAY_SAFE_FOOTER = `${OPERATOR_LINE}. Founded 2025.`;

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export function buildAndroidPrivacyHtml(): string {
  return plainLegalDocument({
    title: 'Privacy policy',
    description: 'Privacy policy for Luminara Suite. No prices and no checkout on this page.',
    canonicalPath: '/privacy',
    footer: `${PLAY_SAFE_FOOTER} Last updated ${PRIVACY_UPDATED}.`,
    main: `<p>${escapePolicyText(PRIVACY_INTRO)}</p>
    ${privacySectionsHtml()}`,
  });
}

export function buildAndroidContactHtml(): string {
  return plainLegalDocument({
    title: 'Contact',
    description: `Email ${CONTACT_EMAIL}. There is no phone line. This page does not list prices or take payment.`,
    canonicalPath: '/contact',
    footer: PLAY_SAFE_FOOTER,
    main: `<p>Email <a href="mailto:${escapePolicyText(CONTACT_EMAIL)}">${escapePolicyText(CONTACT_EMAIL)}</a>. There is no phone line.</p>
    <p>Support: <a href="mailto:${escapePolicyText(SUPPORT_EMAIL)}">${escapePolicyText(SUPPORT_EMAIL)}</a>.</p>
    <p>This page does not list prices and does not take payment.</p>
    <form action="mailto:${escapePolicyText(CONTACT_EMAIL)}" method="post" enctype="text/plain">
      <p><label>Your email<br><input name="email" type="email" required autocomplete="email"></label></p>
      <p><label>Message<br><textarea name="message" required rows="6"></textarea></label></p>
      <p><button type="submit">Email support</button></p>
    </form>`,
  });
}

export function buildDeleteAccountHtml(): string {
  const steps = DELETE_ACCOUNT_STEPS.map((step) => {
    const paragraphs = step.paragraphs.map((paragraph) => `<p>${escapePolicyText(paragraph)}</p>`).join('\n    ');
    return `<h2>${escapePolicyText(step.title)}</h2>\n    ${paragraphs}`;
  }).join('\n    ');
  return plainLegalDocument({
    title: 'Delete account',
    description: 'How to delete a Luminara Suite account from the Android app, the website, or by email.',
    canonicalPath: '/delete-account',
    footer: DELETE_ACCOUNT_OPERATOR,
    main: `<p>${escapePolicyText(DELETE_ACCOUNT_INTRO)}</p>
    ${steps}
    <p>${escapePolicyText(DELETE_ACCOUNT_RETENTION)}</p>`,
  });
}

export const DELETE_ACCOUNT_HTML = buildDeleteAccountHtml();

/** Privacy and contact when opened with ?client=android. Null for every other request. */
export function maybeServeAndroidLegalHtml(url: URL, method: string): Response | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (!isAndroidPlayClientSearch(url.search)) return null;
  const key = marketingShellKey(url.pathname);
  const html = key === '/privacy' ? buildAndroidPrivacyHtml() : key === '/contact' ? buildAndroidContactHtml() : '';
  if (!html) return null;
  if (method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
  return htmlResponse(html);
}
