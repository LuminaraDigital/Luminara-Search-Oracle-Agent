/**
 * Telegram bot side of Luminara Suite: /start deep-links into the Mini App,
 * Telegram Stars payments for plans, and subscription records in KV.
 */
import type { Env } from './index';
import { resolveAccountId, writeSubscriptionRecord, listAllUsers, getWorkspace } from './userStore';

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
          model: 'llama-3.3-70b-versatile',
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
          model: 'meta-llama/llama-3.3-70b-instruct',
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
    if (update.pre_checkout_query) {
      // Telegram requires an answer within 10 seconds; we verify plan existence, currency, and exact Star amount.
      const q = update.pre_checkout_query;
      const rawPlanId = String(q.invoice_payload || '').split(':')[0];
      const planId = normalizePlanId(rawPlanId);
      const plan = PLANS[planId];

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
      }

      await api(env, 'answerPreCheckoutQuery', ok
        ? { pre_checkout_query_id: q.id, ok: true }
        : { pre_checkout_query_id: q.id, ok: false, error_message: errorMessage });
      return;
    }

    const msg = update.message;
    if (!msg) return;

    if (msg.successful_payment) {
      const sp = msg.successful_payment;
      const payload = String(sp.invoice_payload || '');
      const [rawPlanId, userIdRaw] = payload.split(':');
      const planId = normalizePlanId(rawPlanId);
      const plan = PLANS[planId];
      const userId = Number(userIdRaw) || msg.from?.id;

      if (plan && userId) {
        const chargeId = String(sp.telegram_payment_charge_id || '');
        const chargeKey = chargeId ? `stars:charge:${chargeId}` : '';

        // Idempotency check: avoid double-crediting if Telegram retries webhook delivery
        if (chargeKey && env.LUMINARA_KV) {
          const alreadyProcessed = await env.LUMINARA_KV.get(chargeKey, 'json');
          if (alreadyProcessed) {
            console.warn(`[Stars] Duplicate payment webhook for charge ${chargeId}, skipping duplicate credit`);
            return;
          }
        }

        const now = Date.now();
        const loginId = String(userId);
        const accountId = env.LUMINARA_KV ? await resolveAccountId(env, loginId) : loginId;
        const existing = env.LUMINARA_KV
          ? ((await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as { expiresAt?: number } | null)
          : null;
        const base = existing?.expiresAt && existing.expiresAt > now ? existing.expiresAt : now;
        const record = {
          plan: planId,
          stars: sp.total_amount,
          chargeId,
          providerPaymentChargeId: sp.provider_payment_charge_id,
          paymentMethod: 'stars',
          startedAt: now,
          expiresAt: base + plan.days * 86400_000,
        };

        if (env.LUMINARA_KV) {
          await writeSubscriptionRecord(env, loginId, record);
          if (chargeKey) {
            await env.LUMINARA_KV.put(
              chargeKey,
              JSON.stringify({
                userId,
                loginId,
                accountId,
                plan: planId,
                stars: sp.total_amount,
                chargeId,
                providerPaymentChargeId: sp.provider_payment_charge_id,
                paidAt: now,
                expiresAt: record.expiresAt,
              }),
            );
          }
        }

        if (msg.chat?.id) {
          await api(env, 'sendMessage', {
            chat_id: msg.chat.id,
            text:
              `✅ *${plan.title}* is active until ${new Date(record.expiresAt).toUTCString()}.\n\n` +
              `⭐ Paid: ${sp.total_amount.toLocaleString()} Stars\n` +
              (chargeId ? `🧾 Receipt ID: \`${chargeId}\`\n\n` : '\n') +
              `Open the app to run your audits and access frontier intelligence.`,
            parse_mode: 'Markdown',
            reply_markup: openAppKeyboard(env),
          });
        }
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
      const lines = Object.entries(PLANS).map(
        ([id, p]) => `• *${p.title}* - ${p.stars.toLocaleString()} ⭐ / ${p.days} days\n  ${p.description}\n  /buy_${id}`,
      );
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          `*Luminara Suite Subscription Plans (Telegram Stars)*\n\n` +
          lines.join('\n\n') +
          `\n\nTap /buy_starter, /buy_growth, or /buy_agency to pay directly in chat, or open the app to subscribe with Stars or TON.`,
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
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Luminara Suite Terms (purchases)*\n' +
          'By purchasing with Telegram Stars you agree to our Terms and Conditions and Privacy Policy.\n\n' +
          `• Terms: ${env.WEBAPP_URL.replace(/\/$/, '')}/#terms\n` +
          `• Privacy: ${env.WEBAPP_URL.replace(/\/$/, '')}/#privacy\n\n` +
          'Digital subscriptions activate immediately after a successful Stars payment. For billing help or disputes, use /paysupport.\n' +
          'Please note: Telegram Support cannot resolve merchant purchases made through this bot.',
        parse_mode: 'Markdown',
        reply_markup: openAppKeyboard(env),
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

    if (text.startsWith('/help')) {
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text:
          '*Luminara Suite — How This Bot Works*\n\n' +
          'Luminara is your AI search & visibility copilot. We diagnose how LLMs (ChatGPT, Gemini, Perplexity, Google AI Overviews) cite and recommend your brand, and give you actionable fixes.\n\n' +
          '*Available Commands:*\n' +
          '• /start - Launch the Luminara Suite Mini App\n' +
          '• /plan - View subscription plans & pricing (Telegram Stars)\n' +
          '• /status - Check your active subscription & receipt\n' +
          '• /terms - Review purchasing terms and policies\n' +
          '• /paysupport - Get help with billing, receipts, or disputes\n' +
          '• /reset - Clear current chat session memory\n' +
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
      const res = await refundStarPayment(env, targetUserId, chargeId);
      await api(env, 'sendMessage', {
        chat_id: chatId,
        text: res.ok
          ? `✅ Successfully refunded Stars payment \`${chargeId}\` for user \`${targetUserId}\`.`
          : `❌ Refund failed: ${res.error || 'Unknown error'}`,
        parse_mode: 'Markdown',
      });
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
): Promise<{ ok: boolean; error?: string }> {
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

  // Update KV state: mark charge as refunded and revoke subscription if it was active
  if (env.LUMINARA_KV) {
    try {
      const chargeKey = `stars:charge:${telegramPaymentChargeId}`;
      const existing = (await env.LUMINARA_KV.get(chargeKey, 'json')) as Record<string, unknown> | null;
      if (existing) {
        await env.LUMINARA_KV.put(
          chargeKey,
          JSON.stringify({ ...existing, refunded: true, refundedAt: Date.now() }),
        );
        const accountId = String(existing.accountId || existing.loginId || userId);
        const sub = (await env.LUMINARA_KV.get(`sub:${accountId}`, 'json')) as { chargeId?: string } | null;
        if (sub && sub.chargeId === telegramPaymentChargeId) {
          await env.LUMINARA_KV.delete(`sub:${accountId}`);
          if (existing.loginId) await env.LUMINARA_KV.delete(`sub:${existing.loginId}`);
        }
      }
    } catch (err) {
      console.error('[Stars] Error updating KV after refund', err);
    }
  }

  return { ok: true };
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

