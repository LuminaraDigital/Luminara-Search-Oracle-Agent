/**
 * One welcome email per new account, sent through Resend.
 * The D1 claim is the idempotency guard. Retries and later sign-ins claim the same null
 * column, so a second send does not start. Resend's Idempotency-Key covers a lost response.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { AsyncLocalStorage } from 'node:async_hooks';
import { BUSINESS_LOCATION, CONTACT_EMAIL, LEGAL_ABN, LEGAL_ENTITY, PUBLIC_BRAND } from '../services/legal/consumerTerms';
import { PUBLIC_PRIVACY_URL, PUBLIC_TERMS_URL } from '../services/legal/privacyCopy';

export type WelcomeEnv = {
  DB?: D1Database;
  RESEND_API_KEY?: string;
  WEBAPP_URL?: string;
  FREE_DAILY_LIMIT?: string;
};

export const WELCOME_FROM = 'Luminara Suite <hello@luminarasuite.com>';
export const WELCOME_REPLY_TO = CONTACT_EMAIL;
export const WELCOME_AUDIT_URL = 'https://www.luminarasuite.com/#instant_audit';
export const WELCOME_PRIVACY_URL = PUBLIC_PRIVACY_URL;
export const WELCOME_TERMS_URL = PUBLIC_TERMS_URL;
const WORDMARK_ICON = 'https://www.luminarasuite.com/icon-512.png';
const LEGAL_FOOTER = `${LEGAL_ENTITY}, trading as ${PUBLIC_BRAND}, ABN ${LEGAL_ABN}, ${BUSINESS_LOCATION}`;

const waitScope = new AsyncLocalStorage<{ waitUntil(task: Promise<unknown>): void }>();

export function runWithWaitUntil<T>(
  ctx: { waitUntil(task: Promise<unknown>): void },
  fn: () => T,
): T {
  return waitScope.run(ctx, fn);
}

export function scheduleWaitUntil(task: Promise<unknown>): void {
  const safe = task.catch(() => {
    console.warn(JSON.stringify({ event: 'background_task_failed' }));
  });
  const scope = waitScope.getStore();
  if (scope) scope.waitUntil(safe);
  else void safe;
}

function defer(task: Promise<unknown>): void {
  const safe = task.catch(() => {
    console.warn(JSON.stringify({ event: 'welcome_email_failed', reason: 'threw' }));
  });
  const scope = waitScope.getStore();
  if (scope) scope.waitUntil(safe);
  else void safe;
}

export function welcomeGreetingName(name: string | null | undefined, email: string): string | null {
  const trimmed = (name || '').replace(/[\r\n]+/g, ' ').trim();
  if (!trimmed || trimmed.includes('@') || trimmed.toLowerCase() === email.toLowerCase()) return null;
  const first = trimmed.split(/\s+/)[0];
  if (!first || first.length > 40) return null;
  return first;
}

export function freeChecksLine(limit: number): string {
  if (!Number.isFinite(limit) || limit <= 0) return 'Your plan has no daily cap on Instant Audit checks.';
  const count = Math.floor(limit);
  return `Free includes ${count} Instant Audit ${count === 1 ? 'check' : 'checks'} a day.`;
}

function appOrigin(env: WelcomeEnv): string {
  const raw = (env.WEBAPP_URL || 'https://www.luminarasuite.com').trim().replace(/\/$/, '');
  return raw.startsWith('https://') ? raw : 'https://www.luminarasuite.com';
}

export function unsubscribeUrl(env: WelcomeEnv, token: string): string {
  return `${appOrigin(env)}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type WelcomeCopy = {
  greetingName: string | null;
  checksLine: string;
  unsubscribeHref: string;
};

function paragraphs(copy: WelcomeCopy): [string, string, string] {
  const hello = copy.greetingName ? `Hello ${copy.greetingName},` : 'Hello,';
  return [
    `${hello} your Luminara Suite account is ready. When a buyer asks ChatGPT, Perplexity or Google which agent to call, you can check whether the answer names you.`,
    `${copy.checksLine} Anything we did not measure is marked not measured.`,
    'Run your first audit with the address of your site. You will see the one fix to ship next.',
  ];
}

/** Table layout, inline CSS, and a style block only so dark mode does not invert the card. */
export function renderWelcomeEmail(copy: WelcomeCopy): { html: string; text: string; subject: string } {
  const [first, second, third] = paragraphs(copy);
  const subject = 'Welcome to Luminara Suite';
  const unsub = esc(copy.unsubscribeHref);
  const text = [
    subject,
    '',
    first,
    '',
    second,
    '',
    third,
    '',
    `Run your first audit: ${WELCOME_AUDIT_URL}`,
    '',
    'The Luminara Suite team',
    '',
    LEGAL_FOOTER,
    '',
    `Unsubscribe: ${copy.unsubscribeHref}`,
    `Privacy: ${WELCOME_PRIVACY_URL}`,
    `Terms: ${WELCOME_TERMS_URL}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<style>
  :root { color-scheme: light dark; }
  .mail-bg { background-color: #f3efe6 !important; }
  @media (prefers-color-scheme: dark) {
    .mail-bg { background-color: #0a0a0a !important; }
  }
  [data-ogsc] .card, [data-ogsb] .card { background-color: #0a0a0a !important; }
  [data-ogsc] .ink, [data-ogsb] .ink { color: #f7f3ea !important; }
  [data-ogsc] .gold, [data-ogsb] .gold { color: #f0d78c !important; }
  [data-ogsc] .muted, [data-ogsb] .muted { color: #c8c2b4 !important; }
  [data-ogsc] .btn, [data-ogsb] .btn { background-color: #bf953f !important; color: #0a0a0a !important; }
</style>
</head>
<body class="mail-bg" bgcolor="#f3efe6" style="margin:0;padding:0;background-color:#f3efe6;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(copy.checksLine)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mail-bg" bgcolor="#f3efe6" style="background-color:#f3efe6;">
<tr>
<td align="center" style="padding-top:24px;padding-bottom:24px;padding-left:12px;padding-right:12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="card" bgcolor="#0a0a0a" style="width:100%;max-width:600px;background-color:#0a0a0a;">
<tr>
<td style="padding-top:36px;padding-bottom:0;padding-left:36px;padding-right:36px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="padding-right:12px;" valign="middle">
<img src="${WORDMARK_ICON}" width="36" height="36" alt="Luminara Suite" border="0" style="display:block;width:36px;height:36px;border:0;">
</td>
<td valign="middle" class="ink" style="font-family:Georgia,'Times New Roman',Times,serif;font-size:22px;line-height:28px;color:#f7f3ea;">
Luminara Suite
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="padding-top:28px;padding-bottom:0;padding-left:36px;padding-right:36px;">
<p class="gold" style="margin:0;font-family:Georgia,'Times New Roman',Times,serif;font-size:40px;line-height:46px;font-style:italic;color:#f0d78c;">Welcome.</p>
</td>
</tr>
<tr><td style="padding-top:16px;padding-left:36px;padding-right:36px;"><table role="presentation" width="72" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#bf953f" style="font-size:0;line-height:0;height:1px;background-color:#bf953f;">&nbsp;</td></tr></table></td></tr>
<tr>
<td class="ink" style="padding-top:24px;padding-left:36px;padding-right:36px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:26px;color:#f7f3ea;">
${esc(first)}
</td>
</tr>
<tr>
<td class="ink" style="padding-top:16px;padding-left:36px;padding-right:36px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:26px;color:#f7f3ea;">
${esc(second)}
</td>
</tr>
<tr>
<td class="ink" style="padding-top:16px;padding-left:36px;padding-right:36px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:26px;color:#f7f3ea;">
${esc(third)}
</td>
</tr>
<tr>
<td align="left" style="padding-top:28px;padding-left:36px;padding-right:36px;">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(WELCOME_AUDIT_URL)}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="8%" strokecolor="#bf953f" fillcolor="#bf953f">
<w:anchorlock/>
<center style="color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">Run your first audit</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a class="btn" href="${esc(WELCOME_AUDIT_URL)}" style="display:inline-block;background-color:#bf953f;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:20px;font-weight:bold;text-decoration:none;padding-top:14px;padding-bottom:14px;padding-left:22px;padding-right:22px;border-radius:4px;">Run your first audit</a>
<!--<![endif]-->
</td>
</tr>
<tr>
<td class="ink" style="padding-top:28px;padding-left:36px;padding-right:36px;font-family:Georgia,'Times New Roman',Times,serif;font-size:16px;line-height:24px;font-style:italic;color:#f7f3ea;">
The Luminara Suite team
</td>
</tr>
<tr>
<td style="padding-top:28px;padding-left:36px;padding-right:36px;padding-bottom:28px;">
<p class="muted" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#c8c2b4;">
${LEGAL_FOOTER}
</p>
<p class="muted" style="margin:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#c8c2b4;">
<a href="${unsub}" style="color:#f0d78c;text-decoration:underline;">Unsubscribe</a>
&nbsp;&middot;&nbsp;
<a href="${esc(WELCOME_PRIVACY_URL)}" style="color:#f0d78c;text-decoration:underline;">Privacy</a>
&nbsp;&middot;&nbsp;
<a href="${esc(WELCOME_TERMS_URL)}" style="color:#f0d78c;text-decoration:underline;">Terms</a>
</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;

  return { html, text, subject };
}

function newUnsubToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type ClaimedRow = {
  email: string;
  display_name: string | null;
  email_unsub_token: string;
};

function checksLimit(env: WelcomeEnv): number {
  const parsed = Number(env.FREE_DAILY_LIMIT ?? 3);
  return Number.isFinite(parsed) ? parsed : 3;
}

async function releaseClaim(env: WelcomeEnv, userId: string, claimedAt: number): Promise<void> {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE users SET welcome_sent_at = NULL WHERE id = ? AND welcome_sent_at = ?`,
    ).bind(userId, claimedAt).run();
  } catch {
    console.warn(JSON.stringify({ event: 'welcome_email_failed', reason: 'release' }));
  }
}

/** Claims the D1 flag, then sends. A failed send clears the flag so a later sign-in can retry. */
export async function deliverWelcome(env: WelcomeEnv, userId: string): Promise<void> {
  if (!env.DB || !env.RESEND_API_KEY) return;
  const claimedAt = Date.now();
  const token = newUnsubToken();
  let claimed: ClaimedRow | null = null;
  try {
    claimed = await env.DB.prepare(
      `UPDATE users
       SET welcome_sent_at = ?, email_unsub_token = COALESCE(email_unsub_token, ?)
       WHERE id = ? AND welcome_sent_at IS NULL AND email_opt_out_at IS NULL
         AND email IS NOT NULL AND trim(email) != ''
       RETURNING email, display_name, email_unsub_token`,
    ).bind(claimedAt, token, userId).first<ClaimedRow>();
  } catch {
    console.warn(JSON.stringify({ event: 'welcome_email_failed', reason: 'schema' }));
    return;
  }
  if (!claimed?.email || !claimed.email_unsub_token) return;

  const copy: WelcomeCopy = {
    greetingName: welcomeGreetingName(claimed.display_name, claimed.email),
    checksLine: freeChecksLine(checksLimit(env)),
    unsubscribeHref: unsubscribeUrl(env, claimed.email_unsub_token),
  };
  const rendered = renderWelcomeEmail(copy);
  const unsub = copy.unsubscribeHref;
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `welcome-${userId.replace(/[^A-Za-z0-9_-]/g, '-')}`.slice(0, 256),
      },
      body: JSON.stringify({
        from: WELCOME_FROM,
        to: [claimed.email],
        reply_to: [WELCOME_REPLY_TO],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
  } catch {
    console.warn(JSON.stringify({ event: 'welcome_email_failed', reason: 'network' }));
    await releaseClaim(env, userId, claimedAt);
    return;
  }
  if (response.ok || response.status === 409) return;
  console.warn(JSON.stringify({ event: 'welcome_email_failed', status: response.status }));
  await releaseClaim(env, userId, claimedAt);
}

export function scheduleWelcomeEmail(
  env: WelcomeEnv,
  user: { id: string; email?: string; created: boolean; welcomePending: boolean },
): void {
  if (!user.email?.trim() || (!user.created && !user.welcomePending)) return;
  if (!env.DB || !env.RESEND_API_KEY) return;
  defer(deliverWelcome(env, user.id));
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function unsubscribePage(message: string, status: number): Response {
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<title>Unsubscribe | Luminara Suite</title>
</head>
<body style="margin:0;background-color:#0a0a0a;color:#f7f3ea;font-family:Georgia,'Times New Roman',Times,serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0a">
<tr><td align="center" style="padding:48px 16px;">
<p style="font-size:28px;line-height:34px;font-style:italic;color:#f0d78c;margin:0 0 16px 0;">Luminara Suite</p>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#f7f3ea;margin:0;">${esc(message)}</p>
</td></tr>
</table>
</body>
</html>`;
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** GET is the link in the footer. POST is the one-click List-Unsubscribe action. */
export async function handleEmailUnsubscribe(request: Request, env: WelcomeEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/email/unsubscribe') return null;
  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { 'cache-control': 'no-store' } });
  }
  const token = url.searchParams.get('token') || '';
  if (!TOKEN.test(token)) return unsubscribePage('This unsubscribe link is not valid.', 400);
  if (!env.DB) {
    return unsubscribePage('Unsubscribe is unavailable right now. Write to info@luminara.digital and we will stop these emails.', 503);
  }
  try {
    const row = await env.DB.prepare(
      `UPDATE users SET email_opt_out_at = COALESCE(email_opt_out_at, ?)
       WHERE email_unsub_token = ? RETURNING id`,
    ).bind(Date.now(), token).first<{ id: string }>();
    if (!row?.id) return unsubscribePage('This unsubscribe link is not valid.', 400);
  } catch {
    console.warn(JSON.stringify({ event: 'welcome_unsubscribe_failed' }));
    return unsubscribePage('Unsubscribe is unavailable right now. Write to info@luminara.digital and we will stop these emails.', 503);
  }
  return unsubscribePage('You are unsubscribed from Luminara Suite emails.', 200);
}
