#!/usr/bin/env node
/**
 * One-time Telegram bot wiring. Run after `npm run deploy`:
 *
 *   BOT_TOKEN=123:abc TELEGRAM_WEBHOOK_SECRET=long-random WEBAPP_URL=https://luminarasuite.com/ node scripts/telegram-setup.mjs
 *
 * Sets the webhook (with secret token), the chat menu button that opens the Mini App,
 * the command list, and prints the direct link.
 * Still done by hand in @BotFather: /newapp (Main Mini App), bot name, description, avatar.
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

await call('setWebhook', {
  url: `${origin}/api/telegram/webhook`,
  secret_token: TELEGRAM_WEBHOOK_SECRET || undefined,
  allowed_updates: ['message', 'pre_checkout_query'],
  drop_pending_updates: true,
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
    { command: 'paysupport', description: 'Billing and payment help' },
    { command: 'help', description: 'How this bot works' },
  ],
});

const me = await call('getMe', {});
if (me.ok) {
  console.log(`\nDirect link: https://t.me/${me.result.username}`);
  console.log(`Mini App link (after /newapp in BotFather): https://t.me/${me.result.username}/app`);
}
