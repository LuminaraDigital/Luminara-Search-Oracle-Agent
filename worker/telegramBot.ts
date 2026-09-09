/**
 * Telegram bot side of Luminara Suite: /start deep-links into the Mini App,
 * Telegram Stars payments for plans, and subscription records in KV.
 */
import type { Env } from './index';

export const PLANS: Record<string, { title: string; description: string; stars: number; days: number }> = {
  starter: {
    title: 'Luminara Starter',
    description: 'AI search audits for up to 2 sites, monthly AI-visibility re-check, action plan. 30 days.',
    stars: 2500,
    days: 30,
  },
  growth: {
    title: 'Luminara Growth',
    description: '10 sites, weekly AI-visibility tracking, competitor alerts, exports. 30 days.',
    stars: 7500,
    days: 30,
  },
};

const api = async (env: Env, method: string, payload: Record<string, unknown>) => {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<{ ok: boolean; result?: any; description?: string }>;
};

const openAppKeyboard = (env: Env, startParam?: string) => ({
  inline_keyboard: [[
    { text: '🔍 Open Luminara Suite', web_app: { url: startParam ? `${env.WEBAPP_URL}?startapp=${encodeURIComponent(startParam)}` : env.WEBAPP_URL } },
  ]],
});

export async function handleTelegramUpdate(update: any, env: Env): Promise<void> {
  try {
    if (update.pre_checkout_query) {
      // Telegram requires an answer within 10 seconds; we accept every known plan.
      const q = update.pre_checkout_query;
      const plan = PLANS[String(q.invoice_payload || '').split(':')[0]];
      await api(env, 'answerPreCheckoutQuery', plan
        ? { pre_checkout_query_id: q.id, ok: true }
        : { pre_checkout_query_id: q.id, ok: false, error_message: 'Unknown plan. Please reopen the app and try again.' });
      return;
    }

    const msg = update.message;
    if (!msg) return;

    if (msg.successful_payment) {
      const payload = String(msg.successful_payment.invoice_payload || '');
      const [planId, userIdRaw] = payload.split(':');
      const plan = PLANS[planId];
      const userId = Number(userIdRaw) || msg.from?.id;
      if (plan && userId) {
        const now = Date.now();
        const existing = env.LUMINARA_KV ? ((await env.LUMINARA_KV.get(`sub:${userId}`, 'json')) as { expiresAt?: number } | null) : null;
        const base = existing?.expiresAt && existing.expiresAt > now ? existing.expiresAt : now;
        const record = {
          plan: planId,
          stars: msg.successful_payment.total_amount,
          chargeId: msg.successful_payment.telegram_payment_charge_id,
          startedAt: now,
          expiresAt: base + plan.days * 86400_000,
        };
        if (env.LUMINARA_KV) await env.LUMINARA_KV.put(`sub:${userId}`, JSON.stringify(record));
        await api(env, 'sendMessage', {
          chat_id: msg.chat.id,
          text: `✅ ${plan.title} is active until ${new Date(record.expiresAt).toUTCString()}. Open the app to run your first audit.`,
          reply_markup: openAppKeyboard(env),
        });
      }
      return;
    }

    const text: string = msg.text || '';
    const chatId = msg.chat.id;

    if (text.startsWith('/start')) {
      const startParam = text.split(' ')[1];
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Luminara Suite*\n' +
          'See how your brand shows up in Google, AI Overviews, ChatGPT and Perplexity, then get a plain-English action plan.\n\n' +
          'Tap the button to open the app.',
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env, startParam),
      });
      return;
    }

    if (text.startsWith('/plan') || text.startsWith('/subscribe')) {
      const lines = Object.entries(PLANS).map(([id, p]) => `• *${p.title}* — ${p.stars} ⭐ / ${p.days} days\n  ${p.description}\n  /buy_${id}`);
      await api(env, 'sendMessage', { chat_id: chatId, text: lines.join('\n\n'), parse_mode: 'Markdown' });
      return;
    }

    const buy = text.match(/^\/buy_([a-z]+)/);
    if (buy && PLANS[buy[1]]) {
      const plan = PLANS[buy[1]];
      await api(env, 'sendInvoice', {
        chat_id: chatId,
        title: plan.title,
        description: plan.description,
        payload: `${buy[1]}:${msg.from?.id}`,
        currency: 'XTR',
        prices: [{ label: plan.title, amount: plan.stars }],
      });
      return;
    }

    if (text.startsWith('/status')) {
      const sub = env.LUMINARA_KV ? ((await env.LUMINARA_KV.get(`sub:${msg.from?.id}`, 'json')) as { plan: string; expiresAt: number } | null) : null;
      const active = sub && sub.expiresAt > Date.now();
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text: active ? `Your ${PLANS[sub!.plan]?.title || sub!.plan} plan is active until ${new Date(sub!.expiresAt).toUTCString()}.` : 'No active plan. Use /plan to see options, or open the app for a free audit.',
        reply_markup: openAppKeyboard(env),
      });
      return;
    }

    if (text.startsWith('/help')) {
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text: '/start — open the app\n/plan — plans and prices\n/status — your subscription\n/help — this message',
        reply_markup: openAppKeyboard(env),
      });
      return;
    }

    // Anything else: nudge into the app.
    await api(env, 'sendMessage', { chat_id: chatId, text: 'Open the app to run an audit or ask Oracle Agent.', reply_markup: openAppKeyboard(env) });
  } catch (e) {
    console.error('telegram update failed', e);
  }
}

export async function createInvoiceLink(env: Env, userId: number, planId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const plan = PLANS[planId];
  if (!plan) return { ok: false, error: 'Unknown plan' };
  const r = await api(env, 'createInvoiceLink', {
    title: plan.title,
    description: plan.description,
    payload: `${planId}:${userId}`,
    currency: 'XTR',
    prices: [{ label: plan.title, amount: plan.stars }],
  });
  return r.ok ? { ok: true, url: r.result as string } : { ok: false, error: r.description || 'Telegram refused the invoice' };
}

export async function sendTelegramAlert(env: Env, chatId: number | string, text: string, buttonUrl?: string): Promise<boolean> {
  if (!env.BOT_TOKEN) return false;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
  };
  if (buttonUrl) {
    payload.reply_markup = {
      inline_keyboard: [[
        { text: '⚡ Open 1-Click Remediation', web_app: { url: buttonUrl } }
      ]]
    };
  }
  const res = await api(env, 'sendMessage', payload);
  return Boolean(res.ok);
}

