/**
 * Soft throttle for authenticated Telegram webhook updates. Caps processing cost if the webhook
 * secret leaks. Callers must still answer 200 { ok: true } when throttled so Telegram does not retry-storm.
 */

import type { RateLimiter } from './security';

export type TelegramUpdateKind =
  | 'payment'
  | 'message'
  | 'edited_message'
  | 'channel_post'
  | 'edited_channel_post'
  | 'business_message'
  | 'edited_business_message'
  | 'callback_query'
  | 'inline_query'
  | 'chosen_inline_result'
  | 'poll'
  | 'poll_answer'
  | 'my_chat_member'
  | 'chat_member'
  | 'chat_join_request'
  | 'message_reaction'
  | 'message_reaction_count'
  | 'unknown';

export interface TelegramThrottleOptions {
  perChatPerWindow?: Partial<Record<TelegramUpdateKind, number>>;
  globalPerWindow?: Partial<Record<TelegramUpdateKind, number>>;
  windowMs?: number;
}

export type TelegramThrottleResult =
  | { allowed: true; kind: TelegramUpdateKind }
  | { allowed: false; kind: TelegramUpdateKind; key: string };

const DEFAULT_PER_CHAT: Record<TelegramUpdateKind, number> = {
  payment: Infinity,
  message: 20,
  edited_message: 20,
  channel_post: 20,
  edited_channel_post: 20,
  business_message: 20,
  edited_business_message: 20,
  callback_query: 20,
  inline_query: 10,
  chosen_inline_result: 10,
  poll: 10,
  poll_answer: 10,
  my_chat_member: 5,
  chat_member: 5,
  chat_join_request: 5,
  message_reaction: 10,
  message_reaction_count: 10,
  unknown: 10,
};

const DEFAULT_GLOBAL: Record<TelegramUpdateKind, number> = {
  payment: Infinity,
  message: 600,
  edited_message: 600,
  channel_post: 600,
  edited_channel_post: 600,
  business_message: 600,
  edited_business_message: 600,
  callback_query: 600,
  inline_query: 300,
  chosen_inline_result: 300,
  poll: 300,
  poll_answer: 300,
  my_chat_member: 120,
  chat_member: 120,
  chat_join_request: 120,
  message_reaction: 300,
  message_reaction_count: 300,
  unknown: 120,
};

const MESSAGE_LIKE = new Set<TelegramUpdateKind>([
  'message', 'edited_message', 'channel_post', 'edited_channel_post', 'business_message', 'edited_business_message',
]);

const CHAT_SCOPED = new Set<TelegramUpdateKind>([
  'my_chat_member', 'chat_member', 'chat_join_request', 'message_reaction', 'message_reaction_count',
]);

const USER_SCOPED = new Set<TelegramUpdateKind>(['callback_query', 'inline_query', 'chosen_inline_result']);

const ORDERED_KINDS = [...MESSAGE_LIKE, ...USER_SCOPED, ...CHAT_SCOPED, 'poll', 'poll_answer'] as TelegramUpdateKind[];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function idOf(v: unknown): string | null {
  const rec = asRecord(v);
  const id = rec?.id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(Math.trunc(id));
  if (typeof id === 'string' && /^-?\d{1,20}$/.test(id)) return id;
  return null;
}

export function classifyTelegramUpdate(update: unknown): { kind: TelegramUpdateKind; chatId: string | null } {
  const u = asRecord(update);
  if (!u) return { kind: 'unknown', chatId: null };
  if (u.pre_checkout_query !== undefined || u.shipping_query !== undefined) return { kind: 'payment', chatId: null };
  const message = asRecord(u.message);
  if (message && (message.successful_payment !== undefined || message.refunded_payment !== undefined)) {
    return { kind: 'payment', chatId: null };
  }

  const kind = ORDERED_KINDS.find((k) => u[k] !== undefined);
  if (!kind) return { kind: 'unknown', chatId: null };
  const body = asRecord(u[kind]);
  if (!body) return { kind, chatId: null };

  if (MESSAGE_LIKE.has(kind) || CHAT_SCOPED.has(kind)) return { kind, chatId: idOf(body.chat) ?? idOf(body.from) };
  if (USER_SCOPED.has(kind)) return { kind, chatId: idOf(body.from) };
  if (kind === 'poll_answer') return { kind, chatId: idOf(body.user) ?? idOf(body.voter_chat) };
  return { kind, chatId: null };
}

export function checkTelegramUpdateThrottle(
  update: unknown,
  limiter: RateLimiter,
  opts: TelegramThrottleOptions = {},
): TelegramThrottleResult {
  const { kind, chatId } = classifyTelegramUpdate(update);
  if (kind === 'payment') return { allowed: true, kind };

  const windowMs = opts.windowMs ?? 60_000;
  const perChat = opts.perChatPerWindow?.[kind] ?? DEFAULT_PER_CHAT[kind];
  const global = opts.globalPerWindow?.[kind] ?? DEFAULT_GLOBAL[kind];

  const chatKey = `tg:${kind}:chat:${chatId ?? 'shared'}`;
  if (!limiter.check(chatKey, perChat, windowMs).allowed) return { allowed: false, kind, key: chatKey };

  const globalKey = `tg:${kind}:global`;
  if (!limiter.check(globalKey, global, windowMs).allowed) return { allowed: false, kind, key: globalKey };

  return { allowed: true, kind };
}
