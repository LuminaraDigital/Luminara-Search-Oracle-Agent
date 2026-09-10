import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createInvoiceLink,
  handleTelegramUpdate,
  refundStarPayment,
  normalizePlanId,
  PLANS,
} from '../worker/telegramBot';
import type { Env } from '../worker/index';

// Mock in-memory KV
class MockKV {
  private store = new Map<string, string>();

  async get(key: string, type?: string) {
    const val = this.store.get(key);
    if (!val) return null;
    if (type === 'json') {
      try {
        return JSON.parse(val);
      } catch {
        return null;
      }
    }
    return val;
  }

  async put(key: string, value: string) {
    this.store.set(key, value);
  }

  async delete(key: string) {
    this.store.delete(key);
  }
}

describe('Telegram Stars Bot Payments (core.telegram.org/bots/payments-stars)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockKv: MockKV;
  let env: Env;

  beforeEach(() => {
    mockKv = new MockKV();
    mockFetch = vi.fn();
    (globalThis as any).fetch = mockFetch;

    env = {
      ASSETS: {} as any,
      BOT_TOKEN: '123456:MOCK_TOKEN',
      WEBAPP_URL: 'https://luminarasuite.com',
      TELEGRAM_WEBHOOK_SECRET: 'test-secret',
      TELEGRAM_ADMIN_ID: '999999',
      LUMINARA_KV: mockKv as any,
    };
  });

  describe('Plan Normalization & Pricing Consistency', () => {
    it('maps plans and aliases correctly', () => {
      expect(normalizePlanId('starter')).toBe('starter');
      expect(normalizePlanId('growth')).toBe('growth');
      expect(normalizePlanId('agency')).toBe('agency');
      expect(normalizePlanId('pro')).toBe('agency');
      expect(normalizePlanId('PRO')).toBe('agency');
      expect(normalizePlanId('  starter  ')).toBe('starter');
    });

    it('defines prices and days matching documented tiers', () => {
      expect(PLANS.starter.stars).toBe(2500);
      expect(PLANS.starter.days).toBe(30);

      expect(PLANS.growth.stars).toBe(7500);
      expect(PLANS.growth.days).toBe(30);

      expect(PLANS.agency.stars).toBe(18000);
      expect(PLANS.agency.days).toBe(30);
    });
  });

  describe('createInvoiceLink (Telegram Stars)', () => {
    it('calls createInvoiceLink with XTR currency and empty provider_token', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ ok: true, result: 'https://t.me/$testInvoiceLink' }),
      });

      const res = await createInvoiceLink(env, 12345, 'starter');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.url).toBe('https://t.me/$testInvoiceLink');
      }

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [callUrl, callOpts] = mockFetch.mock.calls[0];
      expect(callUrl).toBe('https://api.telegram.org/bot123456:MOCK_TOKEN/createInvoiceLink');

      const body = JSON.parse(callOpts.body);
      expect(body.currency).toBe('XTR');
      expect(body.provider_token).toBe('');
      expect(body.prices).toEqual([{ label: PLANS.starter.title, amount: 2500 }]);
      expect(body.payload).toBe('starter:12345');
      expect(body.title.length).toBeLessThanOrEqual(32);
      expect(body.description.length).toBeLessThanOrEqual(255);
    });

    it('normalizes "pro" to "agency" in createInvoiceLink', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ ok: true, result: 'https://t.me/$agencyLink' }),
      });

      const res = await createInvoiceLink(env, 67890, 'pro');
      expect(res.ok).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.payload).toBe('agency:67890');
      expect(body.prices[0].amount).toBe(18000);
    });

    it('rejects unknown plan names', async () => {
      const res = await createInvoiceLink(env, 12345, 'nonexistent_tier');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain('Unknown plan');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects invalid user IDs', async () => {
      const res = await createInvoiceLink(env, 0, 'starter');
      expect(res.ok).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('handleTelegramUpdate: pre_checkout_query', () => {
    it('answers preCheckoutQuery with ok: true when plan, currency, and amount match', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ ok: true }),
      });

      const update = {
        pre_checkout_query: {
          id: 'query_111',
          currency: 'XTR',
          total_amount: 2500,
          invoice_payload: 'starter:12345',
        },
      };

      await handleTelegramUpdate(update, env);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('answerPreCheckoutQuery');
      const body = JSON.parse(opts.body);
      expect(body.pre_checkout_query_id).toBe('query_111');
      expect(body.ok).toBe(true);
    });

    it('rejects preCheckoutQuery with price mismatch', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ ok: true }),
      });

      const update = {
        pre_checkout_query: {
          id: 'query_tampered',
          currency: 'XTR',
          total_amount: 10, // Tampered price: expected 2500
          invoice_payload: 'starter:12345',
        },
      };

      await handleTelegramUpdate(update, env);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.ok).toBe(false);
      expect(body.error_message).toContain('Price mismatch');
    });

    it('rejects preCheckoutQuery with invalid currency', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ ok: true }),
      });

      const update = {
        pre_checkout_query: {
          id: 'query_bad_curr',
          currency: 'USD',
          total_amount: 2500,
          invoice_payload: 'starter:12345',
        },
      };

      await handleTelegramUpdate(update, env);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.ok).toBe(false);
      expect(body.error_message).toContain('Invalid currency');
    });

    it('rejects preCheckoutQuery for unknown plan', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ ok: true }),
      });

      const update = {
        pre_checkout_query: {
          id: 'query_unknown',
          currency: 'XTR',
          total_amount: 2500,
          invoice_payload: 'invalid_plan:12345',
        },
      };

      await handleTelegramUpdate(update, env);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.ok).toBe(false);
      expect(body.error_message).toContain('Unknown plan');
    });
  });

  describe('handleTelegramUpdate: successful_payment', () => {
    it('records subscription and stores receipt by charge ID idempotently', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ ok: true }),
      });

      const chargeId = 'tg_charge_xyz_123';
      const update = {
        message: {
          chat: { id: 777 },
          from: { id: 777 },
          successful_payment: {
            currency: 'XTR',
            total_amount: 2500,
            invoice_payload: 'starter:777',
            telegram_payment_charge_id: chargeId,
            provider_payment_charge_id: 'prov_charge_999',
          },
        },
      };

      await handleTelegramUpdate(update, env);

      // Verify sub record written in KV
      const sub = (await mockKv.get('sub:777', 'json')) as any;
      expect(sub).toBeTruthy();
      expect(sub.plan).toBe('starter');
      expect(sub.stars).toBe(2500);
      expect(sub.chargeId).toBe(chargeId);
      expect(sub.expiresAt).toBeGreaterThan(Date.now());

      // Verify receipt record written in KV
      const charge = (await mockKv.get(`stars:charge:${chargeId}`, 'json')) as any;
      expect(charge).toBeTruthy();
      expect(charge.userId).toBe(777);
      expect(charge.plan).toBe('starter');
      expect(charge.chargeId).toBe(chargeId);

      // Verify confirmation message sent
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const msgBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(msgBody.chat_id).toBe(777);
      expect(msgBody.text).toContain('Luminara Starter');
      expect(msgBody.text).toContain(chargeId);
      expect(msgBody.text).toContain('2,500 Stars');
    });

    it('prevents double-crediting if duplicate webhook is delivered', async () => {
      const chargeId = 'tg_charge_duplicate';
      // Pre-seed the charge
      await mockKv.put(
        `stars:charge:${chargeId}`,
        JSON.stringify({ chargeId, plan: 'starter', expiresAt: Date.now() + 30 * 86400_000 }),
      );

      const update = {
        message: {
          chat: { id: 888 },
          from: { id: 888 },
          successful_payment: {
            currency: 'XTR',
            total_amount: 2500,
            invoice_payload: 'starter:888',
            telegram_payment_charge_id: chargeId,
          },
        },
      };

      await handleTelegramUpdate(update, env);

      // Should not call Telegram API or overwrite subscription
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('refundStarPayment (Telegram Bot API)', () => {
    it('calls Telegram API refundStarPayment and updates KV state', async () => {
      const chargeId = 'tg_charge_refund_me';
      await mockKv.put(
        `stars:charge:${chargeId}`,
        JSON.stringify({ userId: 555, loginId: '555', accountId: '555', plan: 'starter', chargeId }),
      );
      await mockKv.put(
        'sub:555',
        JSON.stringify({ plan: 'starter', chargeId, expiresAt: Date.now() + 100000 }),
      );

      mockFetch.mockResolvedValueOnce({
        json: async () => ({ ok: true, result: true }),
      });

      const res = await refundStarPayment(env, 555, chargeId);
      expect(res.ok).toBe(true);

      // Verify API was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('refundStarPayment');
      const body = JSON.parse(opts.body);
      expect(body.user_id).toBe(555);
      expect(body.telegram_payment_charge_id).toBe(chargeId);

      // Verify charge marked as refunded
      const updatedCharge = (await mockKv.get(`stars:charge:${chargeId}`, 'json')) as any;
      expect(updatedCharge.refunded).toBe(true);
      expect(updatedCharge.refundedAt).toBeTypeOf('number');

      // Verify active subscription revoked
      const sub = await mockKv.get('sub:555');
      expect(sub).toBeNull();
    });

    it('handles Telegram refund API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ ok: false, description: 'CHARGE_ALREADY_REFUNDED' }),
      });

      const res = await refundStarPayment(env, 555, 'bad_charge');
      expect(res.ok).toBe(false);
      expect(res.error).toBe('CHARGE_ALREADY_REFUNDED');
    });
  });

  describe('Telegram Bot Commands', () => {
    it('handles /buy commands with variations and aliases', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ ok: true, result: true }),
      });

      // Test /buy_growth
      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: '/buy_growth' } },
        env,
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      let body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.currency).toBe('XTR');
      expect(body.provider_token).toBe('');
      expect(body.prices[0].amount).toBe(7500);
      expect(body.start_parameter).toBe('sub_growth');

      // Test /buy starter (with space)
      mockFetch.mockClear();
      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: '/buy starter' } },
        env,
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prices[0].amount).toBe(2500);

      // Test /buy_pro (alias for agency)
      mockFetch.mockClear();
      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: '/buy_pro' } },
        env,
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prices[0].amount).toBe(18000);
    });

    it('presents plans with Mini App web_app button on /plan', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ ok: true }),
      });

      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: '/plan' } },
        env,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Luminara Starter');
      expect(body.text).toContain('2,500 ⭐');
      expect(body.reply_markup.inline_keyboard[0][0].web_app.url).toContain('startapp=stars');
    });

    it('responds with terms and paysupport guidance on /terms and /paysupport', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ ok: true }),
      });

      // /terms
      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: '/terms' } },
        env,
      );
      let body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Terms and Conditions');
      expect(body.text).toContain('/paysupport');

      // /paysupport
      mockFetch.mockClear();
      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: '/paysupport' } },
        env,
      );
      body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Payment & Dispute Support');
      expect(body.text).toContain('Telegram Support does not resolve merchant purchases');
    });

    it('enforces admin authorization on /refund command', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ ok: true, result: true }),
      });

      // Non-admin attempt
      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: '/refund 123 charge_abc' } },
        env,
      );
      let body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Unauthorized');

      // Admin attempt
      mockFetch.mockClear();
      await handleTelegramUpdate(
        { message: { chat: { id: 999999 }, from: { id: 999999 }, text: '/refund 123 charge_abc' } },
        env,
      );
      expect(mockFetch).toHaveBeenCalledTimes(2); // 1: refundStarPayment, 2: confirmation message
      const refundCall = mockFetch.mock.calls.find(c => c[0].includes('refundStarPayment'));
      expect(refundCall).toBeTruthy();
    });

    it('responds with comprehensive guide on /help', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ ok: true }),
      });

      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: '/help' } },
        env,
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Luminara Suite — How This Bot Works');
      expect(body.text).toContain('/start');
      expect(body.text).toContain('/plan');
      expect(body.text).toContain('/status');
      expect(body.text).toContain('/terms');
      expect(body.text).toContain('/paysupport');
      expect(body.text).toContain('/help');
      expect(body.text).toContain('Direct AI Chat');
      expect(body.reply_markup.inline_keyboard[0][0].text).toContain('Open Luminara Suite');
    });

    it('clears chat session memory on /reset or /clear', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ ok: true }),
      });

      await mockKv.put('tg:chat:100', JSON.stringify([{ role: 'user', content: 'hello' }]));
      expect(await mockKv.get('tg:chat:100')).toBeTruthy();

      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: '/reset' } },
        env,
      );

      expect(await mockKv.get('tg:chat:100')).toBeNull();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toContain('Chat session memory cleared');
    });

    it('conducts an interactive chat session with typing action and LLM response', async () => {
      env.GROQ_API_KEY = 'gsk_mock_key';

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('api.groq.com')) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: 'To rank in AI search overviews, ensure your brand has clear entity definition in Schema.org JSON-LD.',
                  },
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ ok: true, result: {} }),
        };
      });

      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: 'How do I optimize for Perplexity AI search?' } },
        env,
      );

      // Verify typing chat action was dispatched
      const typingCall = mockFetch.mock.calls.find(c => c[0].includes('sendChatAction'));
      expect(typingCall).toBeTruthy();
      const typingBody = JSON.parse(typingCall[1].body);
      expect(typingBody.chat_id).toBe(100);
      expect(typingBody.action).toBe('typing');

      // Verify response delivery
      const sendMsgCall = mockFetch.mock.calls.find(c => c[0].includes('sendMessage'));
      expect(sendMsgCall).toBeTruthy();
      const sendBody = JSON.parse(sendMsgCall[1].body);
      expect(sendBody.text).toContain('Schema.org JSON-LD');
      expect(sendBody.reply_markup.inline_keyboard[0][0].text).toContain('Open Luminara Suite');

      // Verify conversation history stored in KV
      const savedHistory = await mockKv.get('tg:chat:100', 'json');
      expect(savedHistory).toHaveLength(2);
      expect(savedHistory[0].role).toBe('user');
      expect(savedHistory[0].content).toBe('How do I optimize for Perplexity AI search?');
      expect(savedHistory[1].role).toBe('assistant');
      expect(savedHistory[1].content).toContain('Schema.org JSON-LD');
    });

    it('enforces daily free quota on interactive messages', async () => {
      env.FREE_DAILY_LIMIT = '1';
      const today = new Date().toISOString().slice(0, 10);
      await mockKv.put('quota:100:' + today, '1');

      mockFetch.mockResolvedValue({
        json: async () => ({ ok: true }),
      });

      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: 'Can you check my site?' } },
        env,
      );

      const sendCall = mockFetch.mock.calls.find(c => c[0].includes('sendMessage'));
      expect(sendCall).toBeTruthy();
      const body = JSON.parse(sendCall[1].body);
      expect(body.text).toContain('Daily Free Limit Reached');
      expect(body.text).toContain('/plan');
    });

    it('enforces subscription requirement when REQUIRE_SUBSCRIPTION is enabled', async () => {
      env.REQUIRE_SUBSCRIPTION = 'true';

      mockFetch.mockResolvedValue({
        json: async () => ({ ok: true }),
      });

      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: 'Audit apple.com' } },
        env,
      );

      const sendCall = mockFetch.mock.calls.find(c => c[0].includes('sendMessage'));
      expect(sendCall).toBeTruthy();
      const body = JSON.parse(sendCall[1].body);
      expect(body.text).toContain('Subscription Required');
      expect(body.text).toContain('/plan');
    });

    it('handles /privacy command and sends privacy policy summary with links', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ ok: true }),
      });

      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: '/privacy' } },
        env,
      );

      const sendCall = mockFetch.mock.calls.find(c => c[0].includes('sendMessage'));
      expect(sendCall).toBeTruthy();
      const body = JSON.parse(sendCall[1].body);
      expect(body.text).toContain('Privacy Policy');
      expect(body.text).toContain('privacy@luminarasuite.com');
      expect(body.reply_markup.inline_keyboard).toBeTruthy();
      const flatButtons = body.reply_markup.inline_keyboard.flat();
      expect(flatButtons.some((b: any) => b.text.includes('Mini App') && b.web_app?.url.includes('privacy'))).toBe(true);
      expect(flatButtons.some((b: any) => b.text.includes('Web') && b.url.includes('/privacy'))).toBe(true);
    });

    it('falls back gracefully to app prompt when no AI provider is configured', async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ ok: true }),
      });

      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: 'Hello' } },
        env,
      );

      const sendCall = mockFetch.mock.calls.find(c => c[0].includes('sendMessage'));
      expect(sendCall).toBeTruthy();
      const body = JSON.parse(sendCall[1].body);
      expect(body.text).toBe('Open the app to run an audit or ask Oracle Agent.');
    });

    it('allows administrators to view registered users with /admin', async () => {
      await mockKv.put('user:fb:1', JSON.stringify({
        id: 'fb:1',
        source: 'firebase',
        email: 'founder@example.com',
        created_at: Date.now() - 100_000,
        last_seen_at: Date.now() - 20_000,
      }));
      await mockKv.put('users:index', JSON.stringify(['fb:1']));

      mockFetch.mockResolvedValue({
        json: async () => ({ ok: true }),
      });

      // Sender is admin (env.TELEGRAM_ADMIN_ID is '999999')
      await handleTelegramUpdate(
        { message: { chat: { id: 999999 }, from: { id: 999999 }, text: '/admin users' } },
        env,
      );

      const sendCall = mockFetch.mock.calls.find(c => c[0].includes('sendMessage'));
      expect(sendCall).toBeTruthy();
      const body = JSON.parse(sendCall[1].body);
      expect(body.text).toContain('Luminara User Signups & Sign-Ins');
      expect(body.text).toContain('founder@example.com');
      expect(body.text).toContain('Web/Google');
    });

    it('Hermes-like: auto-detects domain in message and provides targeted action buttons', async () => {
      env.GROQ_API_KEY = 'gsk_mock_key';

      let promptSent = '';
      mockFetch.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('api.groq.com')) {
          const body = JSON.parse(opts.body);
          promptSent = JSON.stringify(body.messages);
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { content: 'Instant scout for stripe.com: high entity authority, excellent Schema.' } }],
            }),
          };
        }
        return { ok: true, json: async () => ({ ok: true, result: {} }) };
      });

      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: 'Can you check stripe.com visibility?' } },
        env,
      );

      // Verify domain was detected and added to prompt
      expect(promptSent).toContain('stripe.com');
      expect(promptSent).toContain('Detected Target Domain in query');

      // Verify custom action button was generated for the domain
      const sendMsgCall = mockFetch.mock.calls.find(c => c[0].includes('sendMessage'));
      expect(sendMsgCall).toBeTruthy();
      const sendBody = JSON.parse(sendMsgCall[1].body);
      expect(sendBody.reply_markup.inline_keyboard[0][0].text).toContain('stripe.com');
      expect(sendBody.reply_markup.inline_keyboard[0][0].web_app.url).toContain('audit_stripe.com');
    });

    it('Hermes-like: injects user Business DNA memory from KV into Oracle Agent prompt', async () => {
      env.GROQ_API_KEY = 'gsk_mock_key';

      // Store Business DNA in user's workspace
      await mockKv.put('workspace:100', JSON.stringify({
        accountId: '100',
        updatedAt: Date.now(),
        payload: {
          storage: {
            luminara_business_dna: JSON.stringify({
              companyName: 'Acme SaaS',
              domain: 'acme.io',
              usp: 'Fastest B2B invoice reconciliation',
              competitors: ['Rival Corp', 'OldSchool ERP'],
            }),
          },
        },
      }));

      let systemPromptSent = '';
      mockFetch.mockImplementation(async (url: string, opts: any) => {
        if (url.includes('api.groq.com')) {
          const body = JSON.parse(opts.body);
          systemPromptSent = body.messages[0].content;
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { content: 'For Acme SaaS, focus on your USP vs Rival Corp.' } }],
            }),
          };
        }
        return { ok: true, json: async () => ({ ok: true, result: {} }) };
      });

      await handleTelegramUpdate(
        { message: { chat: { id: 100 }, from: { id: 100 }, text: 'How do I win against competitors?' } },
        env,
      );

      expect(systemPromptSent).toContain('Acme SaaS');
      expect(systemPromptSent).toContain('Fastest B2B invoice reconciliation');
      expect(systemPromptSent).toContain('Rival Corp');
    });
  });
});
