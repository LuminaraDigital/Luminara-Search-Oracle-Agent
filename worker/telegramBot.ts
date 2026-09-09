/**
 * Telegram bot side of Luminara Suite: /start deep-links into the Mini App,
 * Telegram Stars payments for plans, and subscription records in KV.
 */
import type { Env } from './index';
import { resolveAccountId, writeSubscriptionRecord } from './userStore';

export type PlanMeta = {
  title: string;
  description: string;
  stars: number;
  days: number;
  domainLimit: number;
  sentinelLimit: number;
  agencyClientLimit: number;
  scheduledReaudit: 'none' | 'monthly' | 'weekly' | 'daily';
  apiAccess: boolean;
};

export const PLANS: Record<string, PlanMeta> = {
  starter: {
    title: 'Luminara Starter',
    description: 'Unlock NVIDIA NIM, Sovereign Ollama & OpenRouter. Unlimited AI audits for up to 2 sites, monthly re-check, Brand Memory. 30 days.',
    stars: 2500,
    days: 30,
    domainLimit: 2,
    sentinelLimit: 2,
    agencyClientLimit: 0,
    scheduledReaudit: 'monthly',
    apiAccess: false,
  },
  growth: {
    title: 'Luminara Growth',
    description: '10 sites, weekly re-audits, competitor watchlist, citation deltas, 24/7 Drift Sentinel. 30 days.',
    stars: 7500,
    days: 30,
    domainLimit: 10,
    sentinelLimit: 10,
    agencyClientLimit: 0,
    scheduledReaudit: 'weekly',
    apiAccess: false,
  },
  agency: {
    title: 'Luminara Pro / Agency',
    description: '25+ domains, audit memory timeline, competitor citation deltas, 10 client workspaces, white-label PDF, API access, daily Sentinel. 30 days.',
    stars: 18000,
    days: 30,
    domainLimit: 25,
    sentinelLimit: 25,
    agencyClientLimit: 10,
    scheduledReaudit: 'daily',
    apiAccess: true,
  },
};

/** Free-tier caps when no active subscription. */
export const FREE_PLAN_CAPS = {
  domainLimit: 1,
  sentinelLimit: 0,
  agencyClientLimit: 0,
  scheduledReaudit: 'none' as const,
  apiAccess: false,
};

export function planCapsFor(planId: string | null | undefined): {
  domainLimit: number;
  sentinelLimit: number;
  agencyClientLimit: number;
  scheduledReaudit: PlanMeta['scheduledReaudit'] | 'none';
  apiAccess: boolean;
} {
  const id = String(planId || '').toLowerCase();
  const plan = PLANS[id === 'pro' ? 'agency' : id];
  if (!plan) return { ...FREE_PLAN_CAPS };
  return {
    domainLimit: plan.domainLimit,
    sentinelLimit: plan.sentinelLimit,
    agencyClientLimit: plan.agencyClientLimit,
    scheduledReaudit: plan.scheduledReaudit,
    apiAccess: plan.apiAccess,
  };
}

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
        const loginId = String(userId);
        const accountId = env.LUMINARA_KV ? await resolveAccountId(env, loginId) : loginId;
        const existing = env.LUMINARA_KV
          ? ((await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as { expiresAt?: number } | null)
          : null;
        const base = existing?.expiresAt && existing.expiresAt > now ? existing.expiresAt : now;
        const record = {
          plan: planId,
          stars: msg.successful_payment.total_amount,
          chargeId: msg.successful_payment.telegram_payment_charge_id,
          paymentMethod: 'stars',
          startedAt: now,
          expiresAt: base + plan.days * 86400_000,
        };
        if (env.LUMINARA_KV) await writeSubscriptionRecord(env, loginId, record);
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
          '*Luminara Suite - Native AI Oracle*\n' +
          'Empirical AI search visibility audits and enterprise intelligence. Groq Cloud is free to try; upgrade to unlock NVIDIA NIM, Sovereign Ollama, and OpenRouter frontier models.\n\n' +
          'Tap below to launch the Telegram native application.',
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env, startParam),
      });
      return;
    }

    if (text.startsWith('/plan') || text.startsWith('/subscribe')) {
      const lines = Object.entries(PLANS).map(([id, p]) => `• *${p.title}* - ${p.stars} ⭐ / ${p.days} days\n  ${p.description}\n  /buy_${id}`);
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

    if (text.startsWith('/terms')) {
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Luminara Suite Terms (purchases)*\n' +
          'By buying with Telegram Stars you agree to our Terms and Privacy Policy.\n\n' +
          `Terms: ${env.WEBAPP_URL.replace(/\/$/, '')}/#terms\n` +
          `Privacy: ${env.WEBAPP_URL.replace(/\/$/, '')}/#privacy\n\n` +
          'Digital subscriptions activate after a successful Stars payment. For billing help use /paysupport.\n' +
          'Telegram Support cannot help with purchases made through this bot.',
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env),
      });
      return;
    }

    if (text.startsWith('/paysupport') || text.startsWith('/support')) {
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Payment support*\n' +
          'Reply here with your Telegram username, the plan you bought (Starter/Growth), approx. date, and what went wrong.\n\n' +
          'We handle Stars purchase issues for this bot. Telegram Support will not resolve merchant purchases.\n' +
          'Check /status for your current plan. Open the app if the subscription is active but features look locked.',
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env),
      });
      return;
    }

    if (text.startsWith('/help')) {
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '/start - open the app\n' +
          '/plan - plans and prices (Telegram Stars)\n' +
          '/status - your subscription\n' +
          '/terms - purchase terms\n' +
          '/paysupport - billing help\n' +
          '/help - this message',
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

