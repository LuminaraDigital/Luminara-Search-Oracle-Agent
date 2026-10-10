/**
 * Telegram bot side of Luminara Suite: /start deep-links into the Mini App,
 * Telegram Stars payments for plans, and subscription records in KV.
 */
import type { Env } from './index';
import { resolveAccountId, writeSubscriptionRecord, listAllUsers, getWorkspace } from './userStore';
import { readRetentionSnapshot } from './referrals';
import { nichePulseReply } from './ideaScout';
import { formatWeeklyMissionNudge } from '../services/referrals/rules';
import { activateLicenseKey } from './licenseService';
import { PROVIDERS } from './providerRelay';
import { claimStarsCharge, isStarsLedgerReady, releaseStarsCharge } from './paymentLedger';
import { recordAuditLogBestEffort } from './auditLog';
import {
  isStarsChargesReady,
  leaseStarsCharge,
  markStarsChargeCredited,
  markStarsChargeRefundDue,
  markStarsChargeRefundedAtTelegram,
  readStarsCharge,
  recordStarsCharge,
  releaseStarsLease,
  requestStarsRefund,
  settleStarsRefund,
  sweepStarsCharges,
  type StarsChargeHooks,
  type StarsChargeRow,
  type StarsChargeStatus,
  type StarsIncomingPayment,
  type StarsRefundOutcome,
  type StarsSweepSummary,
} from './starsCharges';

const PREMIUM_ENGINE_LABELS: Record<string, string> = {
  nim: 'NVIDIA NIM',
  ollama: 'Sovereign Ollama',
  openrouter: 'OpenRouter',
};

/** Names only the paid-tier engines that have a hosted key configured, so bot copy never over-promises. */
export function premiumEnginesPhrase(env: Env): string {
  const labels = Object.entries(PREMIUM_ENGINE_LABELS)
    .filter(([id]) => PROVIDERS[id]?.auth(env, new Headers(), {}).ok)
    .map(([, label]) => label);
  return labels.length ? labels.join(', ') : 'premium hosted AI engines';
}

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
  shareLinks: boolean;
  mcpAccess: boolean;
};

export const PLANS: Record<string, PlanMeta> = {
  starter: {
    title: 'Luminara Starter',
    description: 'Unlock premium hosted AI engines. Unlimited AI audits for up to 2 sites, monthly re-check, Brand Memory. 30 days.',
    stars: 2500,
    days: 30,
    domainLimit: 2,
    sentinelLimit: 2,
    agencyClientLimit: 0,
    scheduledReaudit: 'monthly',
    apiAccess: false,
    shareLinks: false,
    mcpAccess: false,
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
    shareLinks: true,
    mcpAccess: true,
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
    shareLinks: true,
    mcpAccess: true,
  },
  single_audit: {
    title: 'Single Autonomous Audit Run',
    description: 'On-demand 7-agent autonomous search audit. Self-reported audit, not independently checked.',
    stars: 25,
    days: 1,
    domainLimit: 1,
    sentinelLimit: 0,
    agencyClientLimit: 0,
    scheduledReaudit: 'none',
    apiAccess: false,
    shareLinks: false,
    mcpAccess: false,
  },
  multi_agent_crawl: {
    title: 'Deep Multi-Agent Crawl',
    description: 'On-demand deep crawl and competitor gap intelligence. Self-reported audit, not independently checked.',
    stars: 75,
    days: 1,
    domainLimit: 1,
    sentinelLimit: 0,
    agencyClientLimit: 0,
    scheduledReaudit: 'none',
    apiAccess: false,
    shareLinks: false,
    mcpAccess: false,
  },
};

/** Free-tier caps when no active subscription. */
export const FREE_PLAN_CAPS = {
  domainLimit: 1,
  sentinelLimit: 0,
  agencyClientLimit: 0,
  scheduledReaudit: 'none' as const,
  apiAccess: false,
  shareLinks: false,
  mcpAccess: false,
};

/**
 * What a buyer may see before signing in: the 30-day plans, with their title, description, Stars
 * price and length. No entitlement internals, and not the one-off SKUs.
 */
export function publicPlanCatalogue(): Record<string, { title: string; description: string; stars: number; days: number }> {
  const out: Record<string, { title: string; description: string; stars: number; days: number }> = {};
  for (const id of ['starter', 'growth', 'agency'] as const) {
    const p = PLANS[id];
    if (p) out[id] = { title: p.title, description: p.description, stars: p.stars, days: p.days };
  }
  return out;
}

export function normalizePlanId(planId: string | null | undefined): string {
  const id = String(planId || '').toLowerCase().trim();
  if (id === 'pro') return 'agency';
  return id;
}

export function planCapsFor(planId: string | null | undefined): {
  domainLimit: number;
  sentinelLimit: number;
  agencyClientLimit: number;
  scheduledReaudit: PlanMeta['scheduledReaudit'] | 'none';
  apiAccess: boolean;
  shareLinks: boolean;
  mcpAccess: boolean;
} {
  const id = normalizePlanId(planId);
  const plan = PLANS[id];
  if (!plan) return { ...FREE_PLAN_CAPS };
  return {
    domainLimit: plan.domainLimit,
    sentinelLimit: plan.sentinelLimit,
    agencyClientLimit: plan.agencyClientLimit,
    scheduledReaudit: plan.scheduledReaudit,
    apiAccess: plan.apiAccess,
    shareLinks: plan.shareLinks,
    mcpAccess: plan.mcpAccess,
  };
}

export const api = async (
  env: Env,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; result?: any; description?: string }> => {
  if (!env.BOT_TOKEN) return { ok: false, description: 'BOT_TOKEN is not configured' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as {
      ok: boolean;
      result?: any;
      description?: string;
    };
    return data;
  } catch (err: any) {
    console.error(`[Telegram API] ${method} failed`, err);
    return { ok: false, description: err?.message || 'Network error communicating with Telegram' };
  }
};

const openAppKeyboard = (env: Env, startParam?: string) => ({
  inline_keyboard: [[
    { text: '🔍 Open Luminara Suite', web_app: { url: startParam ? `${env.WEBAPP_URL}?startapp=${encodeURIComponent(startParam)}` : env.WEBAPP_URL } },
  ]],
});

export const TELEGRAM_ORACLE_SYSTEM_PROMPT = `Role: You are Oracle Agent for Luminara Suite in Telegram.
You help founders, marketers, and developers maximize their visibility across AI search engines (ChatGPT, Google AI Overviews, Perplexity, Gemini).

Style guidelines:
- Direct, decisive, and grounded in plain English (8th-grade reading level).
- Lead with what matters to revenue and what action to ship.
- Ground advice in search principles: Schema.org JSON-LD structured data, technical crawlability, brand citation velocity, and authoritative third-party references.
- Keep responses concise (typically 2-4 focused paragraphs or punchy bullet points) suitable for Telegram mobile reading.
- When an in-depth audit, radar chart, or competitor diff is relevant, remind them they can tap the "Open Luminara Suite" button below for the full visual suite.`;

export async function generateOracleChatResponse(
  env: Env,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Promise<string | null> {
  const groqKey = env.GROQ_API_KEY || env.GROQ_API_KEY_FALLBACK;
  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages,
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as any;
        const text = data?.choices?.[0]?.message?.content;
        if (text && typeof text === 'string' && text.trim()) return text.trim();
      }
    } catch (err) {
      console.error('[Telegram Bot] Groq chat completion failed', err);
    }
  }

  if (env.GEMINI_API_KEY) {
    try {
      const systemMsg = messages.find(m => m.role === 'system');
      const chatMsgs = messages.filter(m => m.role !== 'system');
      const body: any = {
        contents: chatMsgs.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
      };
      if (systemMsg) {
        body.systemInstruction = {
          parts: [{ text: systemMsg.content }],
        };
      }
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && typeof text === 'string' && text.trim()) return text.trim();
      }
    } catch (err) {
      console.error('[Telegram Bot] Gemini chat completion failed', err);
    }
  }

  if (env.OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': env.WEBAPP_URL || 'https://luminarasuite.com',
          'X-Title': 'Luminara Suite',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages,
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as any;
        const text = data?.choices?.[0]?.message?.content;
        if (text && typeof text === 'string' && text.trim()) return text.trim();
      }
    } catch (err) {
      console.error('[Telegram Bot] OpenRouter chat completion failed', err);
    }
  }

  return null;
}

export async function handleTelegramUpdate(update: any, env: Env): Promise<void> {
  try {
    if (isTelegramPaymentUpdate(update)) {
      // The webhook route awaits payment updates itself; this keeps direct callers working.
      await handleTelegramPaymentUpdate(update, env);
      return;
    }

    const msg = update.message;
    if (!msg) return;

    const text: string = msg.text || '';
    const chatId = msg.chat.id;

    if (text.startsWith('/start')) {
      const startParam = text.split(' ')[1];
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Luminara Suite - Native AI Oracle*\n' +
          'Empirical AI search visibility audits and enterprise intelligence. Groq Cloud is free to try; upgrade to unlock ' + premiumEnginesPhrase(env) + '.\n\n' +
          'Tap below to launch the Telegram native application.',
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env, startParam),
      });
      return;
    }

    if (text.startsWith('/plan') || text.startsWith('/subscribe')) {
      const lines = Object.entries(PLANS).map(
        ([id, p]) => `• *${p.title}* - ${p.stars.toLocaleString()} ⭐ / ${p.days} days\n  ${p.description}\n  /buy_${id}`,
      );
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          `*Luminara Suite Subscription Plans (Telegram Stars)*\n\n` +
          lines.join('\n\n') +
          `\n\nTap /buy_starter, /buy_growth, or /buy_agency to pay directly in chat, or open the app to pay with Stars in one tap.`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '⭐ Open Paywall in Mini App', web_app: { url: `${env.WEBAPP_URL}?startapp=stars` } },
          ]],
        },
      });
      return;
    }

    const buyMatch = text.match(/^\/buy(?:_|\s+)([a-z]+)/i);
    if (buyMatch) {
      const planId = normalizePlanId(buyMatch[1]);
      const plan = PLANS[planId];
      if (plan) {
        await api(env, 'sendInvoice', {
          chat_id: chatId,
          title: plan.title.slice(0, 32),
          description: plan.description.slice(0, 255),
          payload: `${planId}:${msg.from?.id}`.slice(0, 128),
          provider_token: '', // Mandatory empty string for Telegram Stars (XTR)
          currency: 'XTR',
          prices: [{ label: plan.title.slice(0, 32), amount: plan.stars }],
          start_parameter: `sub_${planId}`,
        });
        return;
      }
    }

    if (text.startsWith('/status')) {
      const loginId = String(msg.from?.id);
      const accountId = env.LUMINARA_KV ? await resolveAccountId(env, loginId) : loginId;
      let sub: { plan: string; expiresAt: number; chargeId?: string } | null = null;
      if (env.LUMINARA_KV) {
        sub = ((await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) ||
          (await env.LUMINARA_KV.get(`sub:${loginId}`, 'json'))) as { plan: string; expiresAt: number; chargeId?: string } | null;
      }
      const active = Boolean(sub && sub.expiresAt > Date.now());
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text: active
          ? `✅ Your *${PLANS[sub!.plan]?.title || sub!.plan}* plan is active until ${new Date(sub!.expiresAt).toUTCString()}.\n` +
            (sub!.chargeId ? `Receipt ID: \`${sub!.chargeId}\`\n` : '') +
            `Use /plan to extend your subscription or change tiers.`
          : 'No active subscription. Use /plan to see options, or open the app for a free audit.',
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env),
      });
      return;
    }

    if (text.startsWith('/terms')) {
      const baseUrl = env.WEBAPP_URL.replace(/\/$/, '');
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Luminara Suite Terms (purchases)*\n' +
          'By purchasing with Telegram Stars you agree to our Terms and Conditions and Privacy Policy.\n\n' +
          `• Terms: ${baseUrl}/#terms\n` +
          `• Privacy: ${baseUrl}/privacy\n\n` +
          'Digital subscriptions activate immediately after a successful Stars payment. For billing help or disputes, use /paysupport.\n' +
          'Please note: Telegram Support cannot resolve merchant purchases made through this bot.',
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📜 Privacy Policy', web_app: { url: `${env.WEBAPP_URL}?startapp=privacy#privacy` } },
              { text: '🔍 Open App', web_app: { url: env.WEBAPP_URL } },
            ],
          ],
        },
      });
      return;
    }

    if (text.startsWith('/privacy')) {
      const baseUrl = env.WEBAPP_URL.replace(/\/$/, '');
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Luminara Suite - Privacy Policy & Data Rights*\n\n' +
          'We value your privacy and transparency. Here is how personal data is handled:\n\n' +
          '• *Controller:* Luminara Digital Agency (Contact: `privacy@luminarasuite.com`)\n' +
          '• *Telegram Data:* We receive your signed Telegram user ID, username, and language to identify your session and meter usage. We never receive or store payment cards or phone numbers.\n' +
          '• *Payments:* Plans bought here are paid in Telegram Stars and processed by Telegram. No credit card information is collected.\n' +
          '• *Audits & Prompts:* Audit domains and queries are processed via configured AI models (Groq, NVIDIA NIM, Gemini, OpenRouter) to deliver search intelligence.\n' +
          '• *Data Retention & Control:* Reset your bot chat memory anytime with /reset. To request account data export or deletion, contact `privacy@luminarasuite.com`.\n\n' +
          `Full policy document: ${baseUrl}/privacy`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📜 Read in Mini App', web_app: { url: `${env.WEBAPP_URL}?startapp=privacy#privacy` } },
              { text: '🌐 View on Web', url: `${baseUrl}/privacy` },
            ],
            [
              { text: '🔍 Open Luminara Suite', web_app: { url: env.WEBAPP_URL } },
            ],
          ],
        },
      });
      return;
    }

    if (text.startsWith('/paysupport') || text.startsWith('/support')) {
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Payment & Dispute Support*\n' +
          'We handle Stars purchase issues and billing directly. Telegram Support does not resolve merchant purchases.\n\n' +
          'To request billing support or report a payment issue, reply with:\n' +
          '1. Your Telegram username (@handle)\n' +
          '2. The plan purchased (Starter, Growth, or Pro/Agency)\n' +
          '3. Date of purchase and Receipt ID from your /status message\n' +
          '4. What went wrong\n\n' +
          'Check /status to see your active plan and receipt ID.',
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env),
      });
      return;
    }

    if (text.startsWith('/license')) {
      const licMatch = text.match(/^\/license(?:\s+([a-zA-Z0-9_\-]+))?/i);
      const rawKey = licMatch ? licMatch[1] : '';
      if (!rawKey) {
        await api(env, 'sendMessage', {
          chat_id: chatId,
          text:
            '🔑 *Activate a License Key*\n\n' +
            'Send `/license YOUR-KEY` to redeem a temporary trial pass or full subscription (e.g. `/license LUM-GROWTH-3DAY`).\n\n' +
            'You can also activate keys inside the Mini App paywall modal.',
          parse_mode: 'Markdown',
          reply_markup: openAppKeyboard(env),
        });
        return;
      }
      const loginId = String(msg.from?.id || chatId);
      const res = await activateLicenseKey(env, loginId, rawKey);
      if (res.ok) {
        await api(env, 'sendMessage', {
          chat_id: chatId,
          text:
            `🎉 *License Key Activated!*\n\n` +
            `Your *${PLANS[res.plan!]?.title || res.plan}* plan is now active for ${res.durationDays} days (until ${new Date(res.expiresAt!).toUTCString()}).\n\n` +
            `Your plan now includes ${premiumEnginesPhrase(env)} and unlimited search audits.`,
          parse_mode: 'Markdown',
          reply_markup: openAppKeyboard(env),
        });
      } else {
        await api(env, 'sendMessage', {
          chat_id: chatId,
          text: `❌ *Activation Failed*\n\n${res.error || 'Invalid or expired key.'}\n\nUse /plan to view Telegram Stars subscriptions.`,
          parse_mode: 'Markdown',
          reply_markup: openAppKeyboard(env),
        });
      }
      return;
    }

    if (text.startsWith('/missions')) {
      let nudge = formatWeeklyMissionNudge();
      if (env.DB && msg.from?.id) {
        try {
          const accountId = await resolveAccountId(env, String(msg.from.id));
          const snapshot = await readRetentionSnapshot(env, accountId);
          nudge = snapshot.nudge;
        } catch {
          /* static copy is enough when progression cannot be read */
        }
      }
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text: nudge,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: 'Open this week\'s missions', web_app: { url: `${env.WEBAPP_URL}?startapp=dashboard` } },
          ]],
        },
      });
      return;
    }

    if (text.startsWith('/idea')) {
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Idea Scout*\n\n' +
          'For a product idea before you have a domain. Describe it in the Mini App and get a hypothesis card. It does not invent search share.',
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env, 'idea'),
      });
      return;
    }

    if (text.startsWith('/pulse')) {
      const arg = text.replace(/^\/pulse(?:@\S+)?/i, '').trim();
      let accountId: string | null = null;
      if (msg.from?.id) {
        try {
          accountId = await resolveAccountId(env, String(msg.from.id));
        } catch {
          accountId = null;
        }
      }
      let reply = 'Send /pulse <niche> to store a reminder, or open Idea Scout. Nothing is sent on a schedule.';
      try {
        reply = await nichePulseReply(env, accountId, arg);
      } catch {
        reply = 'Niche Pulse storage is not ready yet. Open Idea Scout in the Mini App. Nothing is sent on a schedule.';
      }
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text: reply,
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env, 'idea'),
      });
      return;
    }

    if (text.startsWith('/help')) {
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Luminara Suite - How This Bot Works*\n\n' +
          'Luminara is your AI search & visibility copilot. We diagnose how LLMs (ChatGPT, Gemini, Perplexity, Google AI Overviews) cite and recommend your brand, and give you actionable fixes.\n\n' +
          '*Available Commands:*\n' +
          '• /start - Launch the Luminara Suite Mini App\n' +
          '• /plan - View subscription plans & pricing (Telegram Stars)\n' +
          '• /status - Check your active subscription & receipt\n' +
          '• /license <key> - Activate a temporary pass or license key\n' +
          '• /terms - Review purchasing terms and policies\n' +
          '• /privacy - View privacy policy and data rights\n' +
          '• /paysupport - Get help with billing, receipts, or disputes\n' +
          '• /reset - Clear current chat session memory\n' +
          '• /missions - This week\'s audit missions (you ask; the bot does not blast)\n' +
          '• /idea - Open Idea Scout (no domain required)\n' +
          '• /pulse <niche> - Store a Niche Pulse reminder (you ask; the bot does not send it on a schedule)\n' +
          '• /help - Display this command overview\n\n' +
          '*Direct AI Chat:*\n' +
          'You can ask any question, query your competitors, or send a URL directly in this chat! Oracle Agent will answer right here.\n\n' +
          'For visual graphs, radar charts, and PDF exports, tap below to open the Mini App.',
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env),
      });
      return;
    }

    if (text.startsWith('/reset') || text.startsWith('/clear')) {
      if (env.LUMINARA_KV) {
        await env.LUMINARA_KV.delete(`tg:chat:${chatId}`);
      }
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text: '🔄 Chat session memory cleared. What would you like to explore next?',
        reply_markup: openAppKeyboard(env),
      });
      return;
    }

    if (text.startsWith('/admin')) {
      const adminIds = (env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      const isSenderAdmin = adminIds.includes(String(msg.from?.id));
      if (!isSenderAdmin) {
        await api(env, 'sendMessage', { chat_id: chatId, text: 'Unauthorized. Only configured bot administrators can access admin commands.' });
        return;
      }

      const users = await listAllUsers(env, 20);
      const lines = users.slice(0, 10).map((u, i) => {
        const sourceBadge = u.source === 'telegram' ? '📱 Telegram' : '🌐 Web/Google';
        const label = u.email || (u.name ? `${u.name} (id: ${u.id})` : `User ${u.id}`);
        const joined = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const minutesAgo = Math.max(0, Math.round((Date.now() - u.last_seen_at) / 60000));
        const activeStr = minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.round(minutesAgo / 60)}h ago`;
        return `${i + 1}. *${label}*\n   ${sourceBadge} · Joined: ${joined} · Active: ${activeStr}`;
      });

      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          `📊 *Luminara User Signups & Sign-Ins*\n\n` +
          `*Total Registered Users:* ${users.length}\n\n` +
          (lines.length ? lines.join('\n\n') : 'No registered users found yet.') +
          `\n\n_Use /refund <userId> <chargeId> to issue a Stars refund._`,
        parse_mode: 'Markdown',
      });
      return;
    }

    const refundMatch = text.match(/^\/refund\s+(\d+)\s+([a-zA-Z0-9_\-]+)/);
    if (refundMatch) {
      const adminIds = (env.TELEGRAM_ADMIN_ID || '').split(',').map(s => s.trim()).filter(Boolean);
      const isSenderAdmin = adminIds.includes(String(msg.from?.id));
      if (!isSenderAdmin) {
        await api(env, 'sendMessage', { chat_id: chatId, text: 'Unauthorized. Only configured bot administrators can issue refunds.' });
        return;
      }
      const targetUserId = Number(refundMatch[1]);
      const chargeId = refundMatch[2];
      const res = await refundStarsCharge(env, targetUserId, chargeId, 'admin_bot_refund');
      if (res.ok) {
        await api(env, 'sendMessage', {
          chat_id: chatId,
          text: `✅ Successfully refunded Stars payment \`${chargeId}\` for user \`${res.payerTgId ?? targetUserId}\`.`,
          parse_mode: 'Markdown',
        });
      } else {
        await api(env, 'sendMessage', { chat_id: chatId, text: `❌ Refund failed: ${res.error || 'Unknown error'}` });
      }
      return;
    }

    if (text.startsWith('/')) {
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Unknown command. Send /help to see all available commands, or type your question directly to chat with Oracle Agent.',
        reply_markup: openAppKeyboard(env),
      });
      return;
    }

    // Interactive conversational session with Oracle Agent (Hermes-like agentic loop)
    // 1. Send typing action so user gets immediate visual feedback
    await api(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });

    // 2. Check subscription & daily quota
    const loginId = String(msg.from?.id || chatId);
    const accountId = env.LUMINARA_KV ? await resolveAccountId(env, loginId) : loginId;
    let sub: { plan: string; expiresAt: number; chargeId?: string } | null = null;
    if (env.LUMINARA_KV) {
      sub = ((await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) ||
        (await env.LUMINARA_KV.get(`sub:${loginId}`, 'json'))) as { plan: string; expiresAt: number; chargeId?: string } | null;
    }
    const hasActiveSub = Boolean(sub && sub.expiresAt > Date.now());

    if (!hasActiveSub) {
      if (env.REQUIRE_SUBSCRIPTION === 'true') {
        await api(env, 'sendMessage', {
          chat_id: chatId,
          text:
            '⭐ *Subscription Required*\n\n' +
            'Interactive Oracle Agent messaging requires an active plan.\n\n' +
            'Use /plan to view subscription options with Telegram Stars, or open the app to get started.',
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '⭐ Open Paywall in App', web_app: { url: `${env.WEBAPP_URL}?startapp=stars` } },
              { text: '🔍 Open Luminara Suite', web_app: { url: env.WEBAPP_URL } },
            ]],
          },
        });
        return;
      }

      const limit = Number(env.FREE_DAILY_LIMIT || 0);
      if (limit > 0 && env.LUMINARA_KV) {
        const day = new Date().toISOString().slice(0, 10);
        const quotaKey = `quota:${accountId}:${day}`;
        const used = Number((await env.LUMINARA_KV.get(quotaKey)) || 0);

        if (used >= limit) {
          await api(env, 'sendMessage', {
            chat_id: chatId,
            text:
              `⚠️ *Daily Free Limit Reached*\n\n` +
              `You have used your daily allocation of ${limit} free queries. Upgrade with Telegram Stars for unlimited queries, or check back tomorrow.\n\n` +
              `Use /plan to view subscription options.`,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '⭐ Open Paywall in App', web_app: { url: `${env.WEBAPP_URL}?startapp=stars` } },
                { text: '🔍 Open Luminara Suite', web_app: { url: env.WEBAPP_URL } },
              ]],
            },
          });
          return;
        }

        await env.LUMINARA_KV.put(quotaKey, String(used + 1), { expirationTtl: 2 * 86400 });
      }
    }

    // 3. Hermes-like: Detect domain / URL intent in message
    const domainMatch = text.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/i);
    const targetDomain = domainMatch ? domainMatch[1].split('/')[0].toLowerCase() : null;

    // 4. Hermes-like: Recall persistent user Business DNA from KV workspace
    let dnaPromptAddition = '';
    if (env.LUMINARA_KV) {
      try {
        const ws = await getWorkspace(env, accountId);
        const dnaRaw = ws?.payload?.storage?.['luminara_business_dna'];
        if (dnaRaw) {
          const dna = JSON.parse(dnaRaw);
          if (dna && typeof dna === 'object') {
            dnaPromptAddition = `\n\nKnown User Business DNA Memory:\n- Company: ${dna.companyName || dna.name || 'Unknown'}\n- Primary Domain: ${dna.domain || dna.primaryDomain || 'Unknown'}\n- USP: ${dna.uniqueSellingPoint || dna.usp || 'N/A'}\n- Known Competitors: ${Array.isArray(dna.competitors) ? dna.competitors.join(', ') : 'N/A'}`;
          }
        }
      } catch {
        /* ignore */
      }
    }

    const domainPromptAddition = targetDomain
      ? `\n\nDetected Target Domain in query: "${targetDomain}". If the user is asking to inspect or audit this domain, deliver an Instant Scout diagnostic covering: AI visibility readiness, entity schema status, and 1 highest-priority ship move this week.`
      : '';

    // 5. Multi-turn session memory
    const histKey = `tg:chat:${chatId}`;
    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (env.LUMINARA_KV) {
      try {
        const stored = await env.LUMINARA_KV.get(histKey, 'json');
        if (Array.isArray(stored)) history = stored;
      } catch {
        history = [];
      }
    }

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: TELEGRAM_ORACLE_SYSTEM_PROMPT + dnaPromptAddition + domainPromptAddition },
      ...history.slice(-6),
      { role: 'user', content: text },
    ];

    // 6. Generate AI response via configured worker providers
    const aiResponse = await generateOracleChatResponse(env, messages);

    // Dynamic action keyboard (Hermes-like deep actions)
    const replyKeyboard = targetDomain
      ? {
          inline_keyboard: [
            [
              { text: `🔍 Full Visual Audit for ${targetDomain}`, web_app: { url: `${env.WEBAPP_URL}?startapp=audit_${encodeURIComponent(targetDomain)}` } },
            ],
            [
              { text: '📊 Open Luminara Suite', web_app: { url: env.WEBAPP_URL } },
            ],
          ],
        }
      : openAppKeyboard(env);

    if (!aiResponse) {
      // Graceful fallback to app prompt if AI service is not configured or fails
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text: 'Open the app to run an audit or ask Oracle Agent.',
        reply_markup: replyKeyboard,
      });
      return;
    }

    // 7. Update session memory in KV
    if (env.LUMINARA_KV) {
      try {
        const nextHist = [...history, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: aiResponse }].slice(-6);
        await env.LUMINARA_KV.put(histKey, JSON.stringify(nextHist), { expirationTtl: 86400 });
      } catch (err) {
        console.error('[Telegram Bot] Failed storing chat history in KV', err);
      }
    }

    // 8. Deliver response
    const sendResult = await api(env, 'sendMessage', {
      chat_id: chatId,
      text: aiResponse,
      parse_mode: 'Markdown',
      reply_markup: replyKeyboard,
    });

    if (!sendResult.ok) {
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text: aiResponse,
        reply_markup: replyKeyboard,
      });
    }
  } catch (e) {
    console.error('telegram update failed', e);
  }
}

export async function createInvoiceLink(
  env: Env,
  userId: number,
  planId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const normId = normalizePlanId(planId);
  const plan = PLANS[normId];
  if (!plan) return { ok: false, error: `Unknown plan "${planId}"` };
  if (!userId || typeof userId !== 'number') return { ok: false, error: 'Valid userId required' };

  const title = plan.title.slice(0, 32);
  const description = plan.description.slice(0, 255);
  const payload = `${normId}:${userId}`.slice(0, 128);

  const r = await api(env, 'createInvoiceLink', {
    title,
    description,
    payload,
    provider_token: '', // Mandatory empty string for digital goods / Telegram Stars (XTR)
    currency: 'XTR',
    prices: [{ label: title, amount: plan.stars }],
  });
  return r.ok && typeof r.result === 'string'
    ? { ok: true, url: r.result }
    : { ok: false, error: r.description || 'Telegram refused the invoice' };
}

export async function refundStarPayment(
  env: Env,
  userId: number,
  telegramPaymentChargeId: string,
): Promise<{ ok: boolean; error?: string; revoked?: boolean }> {
  if (!userId || !telegramPaymentChargeId) {
    return { ok: false, error: 'userId and telegramPaymentChargeId are required' };
  }
  const r = await api(env, 'refundStarPayment', {
    user_id: userId,
    telegram_payment_charge_id: telegramPaymentChargeId,
  });
  if (!r.ok) {
    return { ok: false, error: r.description || 'Telegram refund failed' };
  }

  // Mark the receipt refunded and take back what this charge gave.
  const revoked = await revokeStarsGrant(env, userId, telegramPaymentChargeId);
  const refundedAccountId = revoked.accountId;

  // Money event: Stars refund already issued at Telegram. Best-effort audit; a
  // logging failure here cannot un-refund, so it must not fail the response.
  await recordAuditLogBestEffort(env, {
    org_id: `org_${refundedAccountId.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    actor_id: 'admin',
    action: 'stars.refund',
    details: {
      userId,
      chargeId: telegramPaymentChargeId,
    },
  });

  return { ok: true, revoked: revoked.ok };
}

// ---------------------------------------------------------------------------
// Stars payments (Track SW, SW0a-3): a paid charge is on record before anything else happens.
// worker/starsCharges.ts holds the ledger; this section is what the ledger means for a plan.
// ---------------------------------------------------------------------------

/** Well inside Telegram's 10 seconds for answerPreCheckoutQuery. */
const PRE_CHECKOUT_BUDGET_MS = 6_000;
const DAY_MS = 86400_000;
/** How many Stars charge ids one subscription record remembers. */
const MAX_APPLIED_CHARGES = 20;

type SubscriptionRecord = Record<string, unknown> & {
  plan?: string;
  expiresAt?: number;
  chargeId?: string;
  appliedCharges?: unknown;
};

/** What the webhook must answer. 503 makes Telegram send the update again. */
export type PaymentUpdateOutcome = { status: 200 | 503; note: string };

export function isTelegramPaymentUpdate(update: any): boolean {
  return Boolean(update?.pre_checkout_query || update?.message?.successful_payment || update?.message?.refunded_payment);
}

export type StarsPayload =
  | { purpose: 'plan'; planId: string; granteeId: number | null }
  | { purpose: 'unknown'; ref: string };

/** Reads `<plan>:<telegram user id>`. Anything else is `unknown`. This cannot throw. */
export function parseStarsPayload(raw: unknown): StarsPayload {
  const payload = typeof raw === 'string' ? raw : '';
  const [rawPlanId, userIdRaw] = payload.split(':');
  const planId = normalizePlanId(rawPlanId);
  if (!Object.hasOwn(PLANS, planId)) return { purpose: 'unknown', ref: payload.slice(0, 128) || '(empty)' };
  const granteeId = Number(userIdRaw);
  return { purpose: 'plan', planId, granteeId: Number.isSafeInteger(granteeId) && granteeId > 0 ? granteeId : null };
}

function appliedChargesOf(sub: SubscriptionRecord | null | undefined): string[] {
  if (!sub) return [];
  const listed = Array.isArray(sub.appliedCharges)
    ? sub.appliedCharges.filter((c): c is string => typeof c === 'string' && c !== '')
    : [];
  // Records written before the list existed name one charge.
  if (typeof sub.chargeId === 'string' && sub.chargeId && !listed.includes(sub.chargeId)) listed.push(sub.chargeId);
  return listed;
}

/** True when this subscription record was built from the given Stars charge. */
export function subscriptionListsCharge(sub: SubscriptionRecord | null | undefined, chargeId: string): boolean {
  return Boolean(chargeId) && appliedChargesOf(sub).includes(chargeId);
}

async function raiseStarsAlert(env: Env, text: string, details: Record<string, unknown> = {}): Promise<void> {
  console.error(`[Stars] ALERT: ${text} ${JSON.stringify(details)}`);
  const adminIds = (env.TELEGRAM_ADMIN_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of adminIds) {
    await api(env, 'sendMessage', { chat_id: id, text: `Payment alert: ${text}\n${JSON.stringify(details)}`.slice(0, 3500) });
  }
}

/** Payment and refund messages are sent whatever the account's notice settings say. */
async function tellPayer(env: Env, chatId: number | string | undefined, text: string): Promise<void> {
  if (!chatId) return;
  await api(env, 'sendMessage', { chat_id: chatId, text, reply_markup: openAppKeyboard(env) });
}

function refundedText(stars: number): string {
  return `We could not activate your plan, so your ${stars.toLocaleString()} Stars have been refunded. You can try again from the app.`;
}

function refundPendingText(stars: number, chargeId: string): string {
  return (
    `We could not activate your plan, and the refund of your ${stars.toLocaleString()} Stars did not go through yet. ` +
    `We try again once a day. If you do not have them back in 3 days, send /paysupport with this receipt ID: ${chargeId}`
  );
}

/** True when the payer has their Stars back, whether or not the ledger row could be closed. */
function starsWentBack(outcome: StarsRefundOutcome): boolean {
  return outcome.settled || outcome.moneyReturned === true;
}

/** Resolves false when the check has not answered inside `ms`, or fails. */
function withinBudget(check: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    check.then(resolve, () => resolve(false)).finally(() => clearTimeout(timer));
  });
}

async function answerPreCheckout(q: any, env: Env): Promise<void> {
  // Telegram requires an answer within 10 seconds; we verify plan existence, currency, and exact Star amount.
  const parsed = parseStarsPayload(q.invoice_payload);
  const plan = parsed.purpose === 'plan' ? PLANS[parsed.planId] : null;

  let ok = true;
  let errorMessage = '';

  if (!plan) {
    ok = false;
    errorMessage = 'Unknown plan. Please reopen the app and try again.';
  } else if (q.currency && q.currency !== 'XTR') {
    ok = false;
    errorMessage = 'Invalid currency. Telegram Stars (XTR) required.';
  } else if (typeof q.total_amount === 'number' && q.total_amount !== plan.stars) {
    ok = false;
    errorMessage = `Price mismatch. Expected ${plan.stars} Stars.`;
  } else {
    // Nobody is charged unless the claim table and the charge ledger can both take a write. A
    // probe that has not answered inside the budget counts as no.
    const ready = await withinBudget(
      Promise.all([isStarsLedgerReady(env), isStarsChargesReady(env)]).then(([claims, charges]) => claims && charges),
      PRE_CHECKOUT_BUDGET_MS,
    );
    if (!ready) {
      ok = false;
      errorMessage = 'Payments are temporarily unavailable. Please try again in a few minutes.';
    }
  }

  await api(env, 'answerPreCheckoutQuery', ok
    ? { pre_checkout_query_id: q.id, ok: true }
    : { pre_checkout_query_id: q.id, ok: false, error_message: errorMessage });
}

type PlanGrantTrace = { expiresAt: number; hasReceipt: boolean };

/**
 * What is true about a plan charge: has it been granted? The receipt written at the end of a grant
 * says so, and so does a subscription record that lists the charge, because the subscription is
 * two KV writes and the first can land before the second fails. The claim row is not the test: it
 * is written before the grant, so a crash between the two leaves a claim with nothing behind it.
 */
async function readPlanGrantTrace(
  env: Env,
  chargeId: string,
  accountKeys: Array<string | null | undefined>,
): Promise<PlanGrantTrace | null> {
  const kv = env.LUMINARA_KV;
  if (!kv) return null;
  const receipt = (await kv.get(`stars:charge:${chargeId}`, 'json')) as { refunded?: boolean; expiresAt?: number } | null;
  if (receipt?.refunded) return null;
  if (receipt) return { expiresAt: Number(receipt.expiresAt) || 0, hasReceipt: true };
  for (const key of new Set(accountKeys.filter((k): k is string => Boolean(k) && k !== '0'))) {
    const sub = (await kv.get(`sub:${key}`, 'json')) as SubscriptionRecord | null;
    if (subscriptionListsCharge(sub, chargeId)) return { expiresAt: Number(sub?.expiresAt) || 0, hasReceipt: false };
  }
  return null;
}

type PlanChargeInput = {
  chargeId: string;
  planId: string;
  loginId: string;
  accountId: string;
  payerTgId: number;
  stars: number;
  providerChargeId?: string;
  /** What the subscription record said before this charge, when it was still active. */
  previousPlan?: string;
  now: number;
};

function starsReceipt(input: PlanChargeInput, expiresAt: number): string {
  return JSON.stringify({
    userId: Number(input.loginId) || input.payerTgId,
    payerTgId: input.payerTgId,
    loginId: input.loginId,
    accountId: input.accountId,
    plan: input.planId,
    previousPlan: input.previousPlan,
    stars: input.stars,
    chargeId: input.chargeId,
    providerPaymentChargeId: input.providerChargeId,
    paidAt: input.now,
    expiresAt,
  });
}

/**
 * Step 4: the grant. Throws when it could not be finished. The caller then decides by what is
 * true, because a throw does not mean nothing was written.
 */
async function grantPlanForCharge(env: Env, input: PlanChargeInput): Promise<{ expiresAt: number; alreadyTold: boolean }> {
  const kv = env.LUMINARA_KV;
  if (!kv) throw new Error('LUMINARA_KV is not bound, so a plan cannot be stored');
  const plan = PLANS[input.planId];
  const chargeKey = `stars:charge:${input.chargeId}`;

  // A receipt means an earlier delivery finished this grant. One written before this ledger
  // existed names no payer, and its buyer was told long ago. One written by this ledger means an
  // earlier delivery stopped after the receipt and may not have sent the message, so the buyer is
  // told now.
  const receipt = (await kv.get(chargeKey, 'json')) as { refunded?: boolean; expiresAt?: number; payerTgId?: number } | null;
  if (receipt?.refunded) throw new Error('the receipt says this charge was refunded');
  if (receipt) return { expiresAt: Number(receipt.expiresAt) || 0, alreadyTold: receipt.payerTgId === undefined };

  const claim = await claimStarsCharge(env, input.chargeId, input.accountId);
  if (!claim.ok && claim.reason !== 'duplicate') throw new Error(`the charge could not be claimed (${claim.reason})`);

  const existing = (await kv.get(`sub:${input.accountId}`, 'json')) as SubscriptionRecord | null;
  let expiresAt: number;
  let previousPlan: string | undefined;
  if (subscriptionListsCharge(existing, input.chargeId)) {
    // An earlier attempt wrote the subscription and stopped before the receipt. The days are
    // already there; adding them again would give the plan twice.
    expiresAt = Number(existing?.expiresAt) || input.now;
    previousPlan = typeof existing?.previousPlan === 'string' ? existing.previousPlan : undefined;
  } else if (!claim.ok) {
    // Claimed by an attempt that left no grant behind. The claim alone is not a grant.
    throw new Error('the charge was claimed earlier and no grant is in place');
  } else {
    const active = typeof existing?.expiresAt === 'number' && existing.expiresAt > input.now;
    expiresAt = (active ? Number(existing?.expiresAt) : input.now) + plan.days * DAY_MS;
    const earlier = active ? appliedChargesOf(existing).filter((c) => c !== input.chargeId) : [];
    previousPlan = active && typeof existing?.plan === 'string' ? existing.plan : undefined;
    await writeSubscriptionRecord(env, input.loginId, {
      plan: input.planId,
      // What the record said before this charge, so a refund of this charge can put it back.
      previousPlan,
      stars: input.stars,
      chargeId: input.chargeId,
      providerPaymentChargeId: input.providerChargeId,
      paymentMethod: 'stars',
      startedAt: input.now,
      expiresAt,
      // Every Stars charge this record was built from. The sweep and refunds read it.
      appliedCharges: [...earlier, input.chargeId].slice(-MAX_APPLIED_CHARGES),
    });
  }

  await kv.put(chargeKey, starsReceipt({ ...input, previousPlan }, expiresAt));
  return { expiresAt, alreadyTold: false };
}

async function sendPlanActiveMessage(
  env: Env,
  chatId: number | string | undefined,
  plan: PlanMeta,
  row: StarsChargeRow,
  expiresAt: number,
): Promise<void> {
  if (!chatId) return;
  await api(env, 'sendMessage', {
    chat_id: chatId,
    text:
      `✅ *${plan.title}* is active until ${new Date(expiresAt).toUTCString()}.\n\n` +
      `⭐ Paid: ${row.stars.toLocaleString()} Stars\n` +
      `🧾 Receipt ID: \`${row.charge_id}\`\n\n` +
      `Open the app to run your audits and access frontier intelligence.`,
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(env),
  });
}

type ReceivedChargeContext = {
  row: StarsChargeRow;
  loginId: string;
  accountId: string | null;
  chatId: number | string | undefined;
  providerChargeId?: string;
};

/** Steps 3 to 5 for a plan charge that is on record as `received`. */
async function settleReceivedPlanCharge(env: Env, ctx: ReceivedChargeContext): Promise<string> {
  const { row } = ctx;
  const chargeId = row.charge_id;
  const lease = await leaseStarsCharge(env, chargeId, 'received');
  // Another delivery of this update, or the sweep, holds the charge and will decide it.
  if (lease === null) return 'held_elsewhere';

  const planId = row.ref_id;
  const plan = Object.hasOwn(PLANS, planId) ? PLANS[planId] : null;
  let grant: { expiresAt: number; alreadyTold: boolean } | null = null;
  let failure = '';
  const input: PlanChargeInput = {
    chargeId,
    planId,
    loginId: ctx.loginId,
    accountId: ctx.accountId || '',
    payerTgId: row.payer_tg_id,
    stars: row.stars,
    providerChargeId: ctx.providerChargeId,
    now: Date.now(),
  };
  try {
    if (!plan) throw new Error(`plan "${planId}" is not in the catalogue`);
    if (!ctx.accountId) throw new Error('the account could not be resolved');
    grant = await grantPlanForCharge(env, input);
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    console.error(`[Stars] Grant for charge ${chargeId} did not complete: ${failure}`);
  }

  if (!grant) {
    // Step 5. "It threw" does not mean "nothing was granted". Decide by what is true, exactly as
    // the sweep does.
    let trace: PlanGrantTrace | null;
    try {
      trace = await readPlanGrantTrace(env, chargeId, [ctx.accountId, row.account_id, ctx.loginId]);
    } catch (err) {
      // Nothing can be read, so nothing is decided here: hand the row back for the sweep.
      console.error(`[Stars] Could not read what charge ${chargeId} granted; leaving it for the sweep.`, err);
      await releaseStarsLease(env, chargeId, lease);
      await tellPayer(
        env,
        ctx.chatId,
        `Your payment was received, but we could not confirm your plan yet. We check once a day: it will either be ` +
          `activated or your ${row.stars.toLocaleString()} Stars will be refunded. If neither has happened in 3 days, ` +
          `send /paysupport with this receipt ID: ${chargeId}`,
      );
      return 'undecided';
    }
    if (trace) {
      grant = { expiresAt: trace.expiresAt, alreadyTold: false };
      if (!trace.hasReceipt && input.accountId) {
        // The subscription is there and its receipt is not. Write it if that works now, so a later
        // purchase that replaces the record cannot hide this grant.
        await env.LUMINARA_KV?.put(`stars:charge:${chargeId}`, starsReceipt(input, trace.expiresAt)).catch(() => undefined);
      }
    }
  }

  if (grant) {
    let credited = true;
    try {
      credited = await markStarsChargeCredited(env, chargeId, lease);
    } catch (err) {
      // The plan is in place; the sweep will find it and close the row.
      console.error(`[Stars] Charge ${chargeId} was granted and could not be marked credited; the sweep will close it.`, err);
    }
    if (credited && !grant.alreadyTold && plan) await sendPlanActiveMessage(env, ctx.chatId, plan, row, grant.expiresAt);
    return credited ? 'credited' : 'lease_lost';
  }

  await releaseStarsCharge(env, chargeId);
  // The ledger keeps a code. The error text is in the log line above.
  if (!(await markStarsChargeRefundDue(env, chargeId, lease, 'grant_failed'))) return 'lease_lost';
  const outcome = await settleStarsRefund(env, starsChargeHooks(env), chargeId);
  await tellPayer(env, ctx.chatId, starsWentBack(outcome) ? refundedText(row.stars) : refundPendingText(row.stars, chargeId));
  return outcome.settled ? 'refunded' : 'refund_due';
}

async function handleSuccessfulPayment(msg: any, env: Env): Promise<PaymentUpdateOutcome> {
  const sp = msg.successful_payment || {};
  const chargeId = String(sp.telegram_payment_charge_id || '').trim();
  const payerTgId = Number(msg.from?.id) || 0;
  const stars = Number(sp.total_amount);
  const chatId: number | string | undefined = msg.chat?.id ?? (payerTgId || undefined);

  // An update that cannot be put on record will not become recordable by being sent again:
  // answer 200 and alert, or Telegram would redeliver it forever.
  if (!chargeId || !payerTgId || !Number.isSafeInteger(stars) || stars <= 0) {
    await raiseStarsAlert(env, 'A paid Stars update arrived without a charge id, a payer or an amount, and could not be recorded.', {
      chargeId: chargeId || null,
      payerTgId: payerTgId || null,
      totalAmount: sp.total_amount ?? null,
    });
    if (chargeId && payerTgId) {
      const refund = await refundStarPayment(env, payerTgId, chargeId);
      await tellPayer(
        env,
        chatId,
        refund.ok
          ? 'We could not record your payment, so your Stars have been refunded. You can try again from the app.'
          : `We could not record your payment. Send /paysupport with this receipt ID and we will sort it out: ${chargeId}`,
      );
    }
    return { status: 200, note: 'malformed' };
  }

  const parsed = parseStarsPayload(sp.invoice_payload);
  // The plan goes to the user named in the invoice. A refund only ever goes to the payer.
  const loginId = String(parsed.purpose === 'plan' ? (parsed.granteeId ?? payerTgId) : payerTgId);
  let accountId: string | null = null;
  try {
    accountId = env.LUMINARA_KV ? await resolveAccountId(env, loginId) : loginId;
  } catch (err) {
    console.error(`[Stars] Could not resolve the account for charge ${chargeId}; recording it without one.`, err);
  }

  // Step 1: the charge row is the first write.
  const recorded = await recordStarsCharge(
    env,
    parsed.purpose === 'plan'
      ? { chargeId, payerTgId, accountId, purpose: 'plan', refId: parsed.planId, stars }
      : { chargeId, payerTgId, accountId, purpose: 'unknown', refId: parsed.ref, stars, status: 'refund_due', refundReason: 'unknown_payload' },
  );
  if (!recorded.ok) {
    // The one case that asks Telegram to send the update again.
    if (recorded.retryable) return { status: 503, note: 'charge_not_recorded' };
    await raiseStarsAlert(env, 'A paid Stars charge was rejected by the ledger and will not be retried.', {
      chargeId,
      payerTgId,
      stars,
      error: recorded.error,
    });
    return { status: 200, note: 'charge_rejected' };
  }

  // The charge is on record. Whatever happens next, the row and the sweep own the outcome.
  try {
    const { row } = recorded;
    if (row.status === 'refund_due' && recorded.created) {
      const outcome = await settleStarsRefund(env, starsChargeHooks(env), chargeId);
      await tellPayer(
        env,
        chatId,
        starsWentBack(outcome)
          ? `We received a payment we could not match to a plan, so your ${stars.toLocaleString()} Stars have been refunded.`
          : refundPendingText(stars, chargeId),
      );
      return { status: 200, note: 'unknown_payload' };
    }
    // Step 2: any status but `received` was decided by an earlier delivery, or belongs to the sweep.
    if (row.status !== 'received' || row.purpose !== 'plan') return { status: 200, note: `already_${row.status}` };
    const note = await settleReceivedPlanCharge(env, {
      row,
      loginId,
      accountId,
      chatId,
      providerChargeId: sp.provider_payment_charge_id,
    });
    return { status: 200, note };
  } catch (err) {
    console.error(`[Stars] Charge ${chargeId} is on record and was not settled here; the sweep will finish it.`, err);
    return { status: 200, note: 'left_for_sweep' };
  }
}

/** Telegram's own notice that Stars went back. Keeps the ledger and the plan in step with it. */
async function handleRefundedPayment(msg: any, env: Env): Promise<PaymentUpdateOutcome> {
  const chargeId = String(msg.refunded_payment?.telegram_payment_charge_id || '').trim();
  const payerTgId = Number(msg.chat?.id ?? msg.from?.id) || 0;
  if (!chargeId) return { status: 200, note: 'refund_notice_without_charge' };
  try {
    await markStarsChargeRefundedAtTelegram(env, chargeId);
  } catch (err) {
    console.error(`[Stars] The refund notice for charge ${chargeId} could not be written to the ledger.`, err);
  }
  await revokeStarsGrant(env, payerTgId, chargeId);
  return { status: 200, note: 'refund_notice' };
}

/**
 * Handles pre_checkout_query, successful_payment and refunded_payment. The webhook route awaits
 * this before it answers, because Telegram does not send an update again once it has a 200.
 * It never throws. It asks for a redelivery (503) in exactly one case: a paid charge could not be
 * put on record.
 */
export async function handleTelegramPaymentUpdate(update: any, env: Env): Promise<PaymentUpdateOutcome> {
  const msg = update?.message;
  try {
    if (update?.pre_checkout_query) {
      await answerPreCheckout(update.pre_checkout_query, env);
      return { status: 200, note: 'pre_checkout' };
    }
    if (msg?.successful_payment) return await handleSuccessfulPayment(msg, env);
    if (msg?.refunded_payment) return await handleRefundedPayment(msg, env);
    return { status: 200, note: 'not_a_payment' };
  } catch (err) {
    console.error('[Stars] payment update failed', err);
    // Everything after the charge row is guarded, so a throw that reaches here came before it.
    return msg?.successful_payment ? { status: 503, note: 'charge_not_recorded' } : { status: 200, note: 'error' };
  }
}

/** The plan a Stars charge bought, from its receipt or its ledger row. */
async function planOfStarsCharge(env: Env, chargeId: string | undefined): Promise<string | null> {
  if (!chargeId) return null;
  const receipt = (await env.LUMINARA_KV?.get(`stars:charge:${chargeId}`, 'json')) as { plan?: string } | null | undefined;
  if (typeof receipt?.plan === 'string' && Object.hasOwn(PLANS, receipt.plan)) return receipt.plan;
  try {
    const row = await readStarsCharge(env, chargeId);
    if (row?.purpose === 'plan' && Object.hasOwn(PLANS, row.ref_id)) return row.ref_id;
  } catch {
    // No ledger row to read.
  }
  return null;
}

/**
 * Marks the receipt refunded and takes back only what this charge gave. A charge is found by its
 * receipt or by the subscription record that lists it, so a grant that stopped half way is taken
 * back too. When time is left that this charge did not pay for, its days come off and, if it was
 * the last thing applied to the record, the plan goes back to what the record said before it.
 * Otherwise the record goes. `ok` is false when the record could not be read or written, so the
 * caller can try again: the Stars are back with the payer and the plan must follow.
 */
async function revokeStarsGrant(env: Env, userId: number, chargeId: string): Promise<{ accountId: string; ok: boolean }> {
  let accountId = String(userId);
  const kv = env.LUMINARA_KV;
  if (!kv) return { accountId, ok: true };
  try {
    const chargeKey = `stars:charge:${chargeId}`;
    const receipt = (await kv.get(chargeKey, 'json')) as Record<string, unknown> | null;
    let row: StarsChargeRow | null = null;
    try {
      row = await readStarsCharge(env, chargeId);
    } catch {
      // No ledger row to read (a charge older than the table, or the table is not there yet).
    }
    if (receipt) accountId = String(receipt.accountId || receipt.loginId || userId);
    else if (row?.account_id) accountId = row.account_id;

    const planId = String(receipt?.plan || (row?.purpose === 'plan' ? row.ref_id : ''));
    const days = Object.hasOwn(PLANS, planId) ? PLANS[planId].days : 0;
    const keys = new Set(
      [accountId, receipt?.loginId, row?.account_id, userId].map((k) => (k ? String(k) : '')).filter((k) => k && k !== '0'),
    );
    for (const key of keys) {
      const sub = (await kv.get(`sub:${key}`, 'json')) as SubscriptionRecord | null;
      if (!sub || !subscriptionListsCharge(sub, chargeId)) continue;
      const remaining = appliedChargesOf(sub).filter((c) => c !== chargeId);
      const shortened = days > 0 ? Number(sub.expiresAt) - days * DAY_MS : 0;
      if (shortened <= Date.now()) {
        await kv.delete(`sub:${key}`);
        continue;
      }
      // Time is left that this charge did not pay for (it was added to days already there).
      const next: SubscriptionRecord = { ...sub, expiresAt: shortened, appliedCharges: remaining };
      if (sub.chargeId === chargeId) {
        // This charge was the last thing applied to the record, so the plan name is its doing.
        const before =
          (typeof sub.previousPlan === 'string' && sub.previousPlan) ||
          (typeof receipt?.previousPlan === 'string' && receipt.previousPlan) ||
          (await planOfStarsCharge(env, remaining[remaining.length - 1]));
        if (before) next.plan = before;
        next.chargeId = remaining[remaining.length - 1];
        delete next.previousPlan;
      }
      await kv.put(`sub:${key}`, JSON.stringify(next));
    }
    // Last, so a failure above leaves the receipt unmarked and a retry starts from the same facts.
    if (receipt) await kv.put(chargeKey, JSON.stringify({ ...receipt, refunded: true, refundedAt: Date.now() }));
    return { accountId, ok: true };
  } catch (err) {
    console.error('[Stars] Error updating KV after refund', err);
    return { accountId, ok: false };
  }
}

const STAR_TXN_PAGE = 100;
/** Bounds the calls one comparison may make, whatever the list looks like. */
const STAR_TXN_MAX_CALLS = 60;

/**
 * Telegram's own record of Stars paid to this bot by invoice since `sinceMs`. Read only.
 * The Bot API pages the list by offset "in chronological order" and does not say which end comes
 * first, so this reads the newest end either way: straight from offset 0 when the newest come
 * first, and by finding the end of the list when the oldest do. It throws when it could not
 * cover the window, so the sweep can say the comparison did not run.
 */
async function listIncomingStarPayments(env: Env, sinceMs: number): Promise<StarsIncomingPayment[]> {
  let calls = 0;
  const pages = new Map<number, any[]>();
  const page = async (offset: number): Promise<any[]> => {
    const seen = pages.get(offset);
    if (seen) return seen;
    calls += 1;
    if (calls > STAR_TXN_MAX_CALLS) throw new Error('the transaction list is too long to compare in one run');
    const r = await api(env, 'getStarTransactions', { offset, limit: STAR_TXN_PAGE });
    if (!r.ok) throw new Error(r.description || 'getStarTransactions failed');
    const list: any[] = Array.isArray(r.result?.transactions) ? r.result.transactions : [];
    pages.set(offset, list);
    return list;
  };
  const paidAt = (t: any) => (Number(t?.date) || 0) * 1000;

  const first = await page(0);
  if (first.length === STAR_TXN_PAGE) {
    if (paidAt(first[0]) > paidAt(first[first.length - 1])) {
      // Newest first: read on until a page ends before the window.
      let last = first;
      for (let offset = STAR_TXN_PAGE; last.length === STAR_TXN_PAGE && paidAt(last[last.length - 1]) >= sinceMs; offset += STAR_TXN_PAGE) {
        last = await page(offset);
      }
    } else {
      // Oldest first: find where the list ends (double the offset until a page comes back short,
      // then halve the gap), and read back from there until a page starts before the window.
      let full = 0;
      let short = STAR_TXN_PAGE;
      while ((await page(short)).length === STAR_TXN_PAGE) {
        full = short;
        short *= 2;
      }
      while (short - full > STAR_TXN_PAGE) {
        const mid = full + Math.floor((short - full) / (2 * STAR_TXN_PAGE)) * STAR_TXN_PAGE;
        if ((await page(mid)).length === STAR_TXN_PAGE) full = mid;
        else short = mid;
      }
      for (let offset = short; offset >= 0; offset -= STAR_TXN_PAGE) {
        const p = await page(offset);
        if (p.length > 0 && paidAt(p[0]) < sinceMs) break;
      }
    }
  }

  const out = new Map<string, StarsIncomingPayment>();
  for (const list of pages.values()) {
    for (const t of list) {
      const source = t?.source;
      // A payment in has a paying user and no receiver; a refund out has a receiver.
      if (!source || source.type !== 'user' || t.receiver) continue;
      if (source.transaction_type && source.transaction_type !== 'invoice_payment') continue;
      if (typeof t.id !== 'string' || !t.id || paidAt(t) < sinceMs) continue;
      out.set(t.id, { chargeId: t.id, payerTgId: Number(source.user?.id) || 0, stars: Number(t.amount) || 0, paidAt: paidAt(t) });
    }
  }
  return [...out.values()];
}

function starsChargeHooks(env: Env): StarsChargeHooks {
  const planStayed = 'the Stars went back to the payer, and the plan could not be taken back yet';
  return {
    isGranted: async (row) =>
      row.purpose === 'plan' && (await readPlanGrantTrace(env, row.charge_id, [row.account_id, String(row.payer_tg_id)])) !== null,
    releaseClaim: (row) => releaseStarsCharge(env, row.charge_id),
    refund: async (row) => {
      const res = await refundStarPayment(env, row.payer_tg_id, row.charge_id);
      // Refunded, but the plan is still there: not finished, so the sweep comes back to it.
      if (res.ok) return res.revoked === false ? { ok: false, moneyReturned: true, error: planStayed } : { ok: true };
      if (!/CHARGE_ALREADY_REFUNDED/i.test(res.error || '')) return res;
      // The Stars are already back with the payer. Make sure the grant went with them.
      const revoked = await revokeStarsGrant(env, row.payer_tg_id, row.charge_id);
      return revoked.ok ? { ok: true } : { ok: false, moneyReturned: true, error: planStayed };
    },
    alert: (text, details) => raiseStarsAlert(env, text, details),
    onSwept: async (row, outcome) => {
      // A refund a person asked for needs no explanation; one the sweep made after a failed grant does.
      if (outcome === 'refunded' && !/^admin_|^manual_/.test(row.refund_reason || '')) {
        await tellPayer(env, row.payer_tg_id, refundedText(row.stars));
      }
    },
    // Without a bot token there is no list to read.
    ...(env.BOT_TOKEN ? { listIncoming: (sinceMs: number) => listIncomingStarPayments(env, sinceMs) } : {}),
  };
}

/** Cron entry: settles Stars charges a webhook left undecided, retries refunds, and compares with Telegram's list. */
export async function runStarsChargeSweep(env: Env): Promise<StarsSweepSummary | null> {
  try {
    const summary = await sweepStarsCharges(env, starsChargeHooks(env), { reconcile: true });
    console.log(`[Stars] charge sweep: ${JSON.stringify(summary)}`);
    return summary;
  } catch (err) {
    console.error('[Stars] charge sweep failed', err);
    return null;
  }
}

async function recordRefundOutsideLedger(env: Env, payerTgId: number, chargeId: string, reason: string): Promise<void> {
  if (!env.DB) return;
  try {
    const receipt = env.LUMINARA_KV
      ? ((await env.LUMINARA_KV.get(`stars:charge:${chargeId}`, 'json')) as { stars?: number; plan?: string; accountId?: string } | null)
      : null;
    const stars = Number(receipt?.stars);
    if (Number.isSafeInteger(stars) && stars > 0) {
      await recordStarsCharge(env, {
        chargeId,
        payerTgId,
        accountId: receipt?.accountId ? String(receipt.accountId) : null,
        purpose: 'plan',
        refId: String(receipt?.plan || 'legacy'),
        stars,
        status: 'refunded',
        refundReason: reason,
      });
    }
    // A row that was there after all must not go on saying credited.
    await markStarsChargeRefundedAtTelegram(env, chargeId);
  } catch (err) {
    console.error(`[Stars] Charge ${chargeId} was refunded outside the ledger and could not be recorded.`, err);
  }
}

export type StarsRefundResult = { ok: boolean; error?: string; status?: StarsChargeStatus; payerTgId?: number };

/**
 * A refund a person asked for (the bot's /refund, POST /telegram/refund). It goes through the
 * ledger, so the ledger never says `credited` for Stars that went back, and it goes to the account
 * that paid, whatever user id was typed. A charge older than the ledger is refunded directly, as
 * before, and recorded as refunded.
 */
export async function refundStarsCharge(
  env: Env,
  userIdHint: number,
  chargeId: string,
  reason: string = 'manual_refund',
): Promise<StarsRefundResult> {
  const id = String(chargeId || '').trim();
  if (!id) return { ok: false, error: 'chargeId is required' };

  let row: StarsChargeRow | null = null;
  try {
    row = await readStarsCharge(env, id);
  } catch (err) {
    // A database that is there and did not answer is not the same as "no row": refunding now
    // could send Stars to a typed id and leave the row saying credited. Only a missing table
    // (a database from before the ledger) means the charge is older than the ledger.
    if (!/no such table/i.test(err instanceof Error ? err.message : String(err))) {
      console.error(`[Stars] Could not read the ledger row for charge ${id}; nothing was refunded.`, err);
      return { ok: false, error: 'The payment ledger could not be read. Nothing was refunded. Try again in a few minutes.' };
    }
  }
  if (!row) {
    const res = await refundStarPayment(env, userIdHint, id);
    if (res.ok) await recordRefundOutsideLedger(env, userIdHint, id, reason);
    return { ...res, payerTgId: userIdHint };
  }

  const payerTgId = row.payer_tg_id;
  if (row.status === 'refunded') return { ok: true, status: 'refunded', payerTgId };
  try {
    const now = Date.now();
    if (row.status === 'received') {
      const lease = await leaseStarsCharge(env, id, 'received', now);
      if (lease === null || !(await markStarsChargeRefundDue(env, id, lease, reason, now))) {
        return { ok: false, status: 'received', payerTgId, error: 'This charge is still being processed. Try again in a few minutes.' };
      }
    } else if (row.status !== 'refund_due' && !(await requestStarsRefund(env, id, reason, now))) {
      return { ok: false, status: row.status, payerTgId, error: 'The charge changed while the refund was being requested. Try again.' };
    }
    const outcome = await settleStarsRefund(env, starsChargeHooks(env), id, now);
    if (outcome.settled) return { ok: true, status: 'refunded', payerTgId };
    if (outcome.reason === 'busy') {
      return { ok: false, status: 'refund_due', payerTgId, error: 'A refund for this charge is already in progress.' };
    }
    return {
      ok: false,
      status: outcome.status ?? 'refund_due',
      payerTgId,
      error: `${outcome.error || 'Telegram refused the refund'}. The charge is marked refund due and will be retried.`,
    };
  } catch (err) {
    console.error(`[Stars] Manual refund of charge ${id} failed`, err);
    return { ok: false, status: row.status, payerTgId, error: 'The payment ledger could not be updated. Try again in a few minutes.' };
  }
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

