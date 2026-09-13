import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../worker/security';
import { checkTelegramUpdateThrottle, classifyTelegramUpdate, type TelegramThrottleOptions } from '../worker/webhookThrottle';

const msg = (chatId: number, extra: Record<string, unknown> = {}) => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type: 'private' }, from: { id: chatId }, text: 'hi', ...extra },
});

function exhaust(limiter: RateLimiter, update: unknown, n: number, opts?: TelegramThrottleOptions) {
  let last = checkTelegramUpdateThrottle(update, limiter, opts);
  for (let i = 1; i < n; i++) last = checkTelegramUpdateThrottle(update, limiter, opts);
  return last;
}

describe('checkTelegramUpdateThrottle', () => {
  it('trips the per-chat message limit', () => {
    const limiter = new RateLimiter(() => 1_000);
    const opts = { perChatPerWindow: { message: 3 } };
    for (let i = 0; i < 3; i++) expect(checkTelegramUpdateThrottle(msg(42), limiter, opts).allowed).toBe(true);
    const res = checkTelegramUpdateThrottle(msg(42), limiter, opts);
    expect(res).toEqual({ allowed: false, kind: 'message', key: 'tg:message:chat:42' });
  });

  it('never throttles payment updates, even after limits are exhausted', () => {
    const limiter = new RateLimiter(() => 1_000);
    const opts = { perChatPerWindow: { message: 1, unknown: 1 }, globalPerWindow: { message: 1, unknown: 1 } };
    expect(exhaust(limiter, msg(7), 5, opts).allowed).toBe(false);

    const payments = [
      { update_id: 2, pre_checkout_query: { id: 'q1', from: { id: 7 }, currency: 'XTR', total_amount: 100 } },
      msg(7, { successful_payment: { currency: 'XTR', total_amount: 100, invoice_payload: 'pro:7' } }),
      msg(7, { refunded_payment: { currency: 'XTR', total_amount: 100, invoice_payload: 'pro:7' } }),
    ];
    for (let i = 0; i < 50; i++) {
      for (const p of payments) expect(checkTelegramUpdateThrottle(p, limiter, opts).allowed).toBe(true);
    }
  });

  it('keeps different chats independent', () => {
    const limiter = new RateLimiter(() => 1_000);
    const opts = { perChatPerWindow: { message: 2 } };
    expect(exhaust(limiter, msg(1), 3, opts).allowed).toBe(false);
    expect(checkTelegramUpdateThrottle(msg(2), limiter, opts).allowed).toBe(true);
  });

  it('trips the global per-type ceiling across many chats', () => {
    const limiter = new RateLimiter(() => 1_000);
    const opts = { perChatPerWindow: { callback_query: 5 }, globalPerWindow: { callback_query: 10 } };
    const cb = (id: number) => ({ update_id: id, callback_query: { id: String(id), from: { id }, data: 'x' } });
    for (let i = 0; i < 10; i++) expect(checkTelegramUpdateThrottle(cb(i), limiter, opts).allowed).toBe(true);
    expect(checkTelegramUpdateThrottle(cb(999), limiter, opts)).toEqual({
      allowed: false,
      kind: 'callback_query',
      key: 'tg:callback_query:global',
    });
  });

  it('resets after the window elapses', () => {
    let now = 1_000;
    const limiter = new RateLimiter(() => now);
    const opts = { perChatPerWindow: { message: 1 } };
    checkTelegramUpdateThrottle(msg(5), limiter, opts);
    expect(checkTelegramUpdateThrottle(msg(5), limiter, opts).allowed).toBe(false);
    now += 60_001;
    expect(checkTelegramUpdateThrottle(msg(5), limiter, opts).allowed).toBe(true);
  });

  it('classifies update types and extracts chat or user ids', () => {
    expect(classifyTelegramUpdate({ inline_query: { id: 'a', from: { id: 9 } } })).toEqual({ kind: 'inline_query', chatId: '9' });
    expect(classifyTelegramUpdate({ my_chat_member: { chat: { id: -100123 }, from: { id: 3 } } })).toEqual({ kind: 'my_chat_member', chatId: '-100123' });
    expect(classifyTelegramUpdate({ edited_message: { chat: { id: 4 } } })).toEqual({ kind: 'edited_message', chatId: '4' });
    expect(classifyTelegramUpdate({ poll: { id: 'p' } })).toEqual({ kind: 'poll', chatId: null });
  });

  it('does not throw on malformed updates and puts them in a shared bucket', () => {
    const limiter = new RateLimiter(() => 1_000);
    const inputs: unknown[] = [
      null, undefined, 0, 'x', [], [1, 2], {}, { message: null }, { message: 'nope' },
      { message: { chat: { id: { nested: true } } } }, { callback_query: { from: null } }, { weird_update: {} },
    ];
    for (const input of inputs) {
      expect(() => checkTelegramUpdateThrottle(input, limiter)).not.toThrow();
    }
    const res = exhaust(limiter, { message: { chat: {} } }, 25);
    expect(res).toEqual({ allowed: false, kind: 'message', key: 'tg:message:chat:shared' });
  });
});
