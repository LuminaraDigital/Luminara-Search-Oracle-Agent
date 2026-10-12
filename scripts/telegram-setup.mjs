#!/usr/bin/env node
/**
 * One-time Telegram bot wiring. Run after `npm run deploy`:
 *
 *   ALLOW_PRODUCTION_WEBHOOK=yes EXPECT_BOT_USERNAME=LuminaraSuiteBot BOT_TOKEN=123:abc TELEGRAM_WEBHOOK_SECRET=long-random WEBAPP_URL=https://luminarasuite.com/ node scripts/telegram-setup.mjs
 *
 * Sets the webhook (with secret token), the chat menu button that opens the Mini App,
 * the command list, and prints the direct link.
 * Still done by hand in @BotFather: /newapp (Main Mini App), bot name, description, avatar.
 *
 * Pending updates are kept. One of them can be a paid Stars update waiting to be delivered again,
 * and dropping it would lose the payment. Set DROP_PENDING_UPDATES=true only when you know the
 * queue holds nothing you need.
 */
const { BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, WEBAPP_URL = 'https://luminarasuite.com/' } = process.env;
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}
const origin = new URL(WEBAPP_URL).origin;

async function call(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  console.log(`${method}: ${data.ok ? 'ok' : `FAILED ${data.description}`}`);
  return data;
}

// Name the bot before anything is changed. A token pasted for the wrong bot would otherwise move
// that bot's webhook. EXPECT_BOT_USERNAME is the bot you mean, with or without the leading @.
const expectedBot = String(process.env.EXPECT_BOT_USERNAME || '').trim().replace(/^@/, '').toLowerCase();
if (!expectedBot) {
  console.error('EXPECT_BOT_USERNAME is required: the username of the bot this token should belong to. Nothing was changed.');
  process.exit(1);
}
// A webhook set with no secret is one the Worker refuses: every update then arrives without the
// secret the Worker checks, and is answered 401. Stop here rather than set one.
if (!String(TELEGRAM_WEBHOOK_SECRET || '').trim()) {
  console.error('TELEGRAM_WEBHOOK_SECRET is required: a webhook set without it has no secret, and the Worker refuses every update. Nothing was changed.');
  process.exit(1);
}
const me = await call('getMe', {});
const botUsername = me.ok && typeof me.result?.username === 'string' ? me.result.username : '';
if (!botUsername || botUsername.toLowerCase() !== expectedBot) {
  console.error(
    `This token belongs to ${botUsername ? `@${botUsername}` : 'no bot Telegram could name'}, not to @${expectedBot}. Nothing was changed.`,
  );
  process.exit(1);
}
console.log(`Matched bot: @${botUsername}`);

// The production bot goes with the production site, and no other bot does. A WEBAPP_URL left in
// the shell from another environment would otherwise point one environment's bot at the other's
// Worker. The site is read with new URL(), never matched by a prefix. The production bot needs
// the exact production origin. Any other bot is refused every spelling of a production host: a
// trailing dot, another port or another case still reaches the production Worker.
const PRODUCTION_BOT = 'luminarasuitebot';
const PRODUCTION_HOST = 'luminarasuite.com';
const PRODUCTION_ORIGIN = 'https://luminarasuite.com';
const productionBot = botUsername.toLowerCase() === PRODUCTION_BOT;
const siteHost = new URL(WEBAPP_URL).hostname.replace(/\.+$/, '').toLowerCase();
const productionHost = siteHost === PRODUCTION_HOST || siteHost === `www.${PRODUCTION_HOST}`;
const paired = productionBot ? origin === PRODUCTION_ORIGIN : !productionHost;
if (!paired) {
  console.error(
    productionBot
      ? `@${botUsername} is the production bot and ${origin} is not exactly ${PRODUCTION_ORIGIN}. Nothing was changed.`
      : `@${botUsername} is not the production bot and ${origin} is a production host. Nothing was changed.`,
  );
  process.exit(1);
}

// Changing the production bot takes one more deliberate step. Without it, say what would be done
// and stop.
if (productionBot && process.env.ALLOW_PRODUCTION_WEBHOOK !== 'yes') {
  console.error(
    `This would change the PRODUCTION bot @${botUsername}: set its webhook to ${origin}/api/telegram/webhook with the secret in this shell, ` +
      `${process.env.DROP_PENDING_UPDATES === 'true' ? 'drop' : 'keep'} its pending updates, point its menu button at ${WEBAPP_URL} and set its command list. ` +
      'Set ALLOW_PRODUCTION_WEBHOOK=yes to do that. Nothing was changed.',
  );
  process.exit(1);
}
console.log(`About to point @${botUsername} at ${origin}`);

await call('setWebhook', {
  url: `${origin}/api/telegram/webhook`,
  secret_token: TELEGRAM_WEBHOOK_SECRET || undefined,
  allowed_updates: ['message', 'pre_checkout_query', 'callback_query'],
  drop_pending_updates: process.env.DROP_PENDING_UPDATES === 'true',
});

await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'Open Luminara', web_app: { url: WEBAPP_URL } },
});

await call('setMyCommands', {
  commands: [
    { command: 'start', description: 'Open Luminara Suite' },
    { command: 'plan', description: 'Plans and prices (Telegram Stars)' },
    { command: 'status', description: 'Your subscription' },
    { command: 'terms', description: 'Purchase terms' },
    { command: 'privacy', description: 'Privacy policy & data protection' },
    { command: 'paysupport', description: 'Billing and payment help' },
    { command: 'help', description: 'How this bot works' },
  ],
});

console.log(`\nDirect link: https://t.me/${botUsername}`);
console.log(`Mini App link (after /newapp in BotFather): https://t.me/${botUsername}/app`);
