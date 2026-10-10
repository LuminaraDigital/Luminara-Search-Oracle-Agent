import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { handleTelegramUpdate, runPaymentSupportSweep } from '../worker/telegramBot';
import {
  SUPPORT_MAX_FOLLOW_UPS,
  SUPPORT_MAX_OPEN_PER_PAYER,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_REMIND_AFTER_MS,
  SUPPORT_REPLY_WINDOW_MS,
  SUPPORT_RETENTION_MS,
  SUPPORT_WINDOW_MS,
  openSupportWindow,
  takeSupportMessage,
} from '../worker/paymentSupport';
import { recordStarsCharge } from '../worker/starsCharges';
import { linkTelegramAndFirebase } from '../worker/userStore';
import { createPrivacyJob } from '../worker/privacyService';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';

/**
 * Track SW, SW0a-16: payment support reaches a person.
 * /paysupport used to send one canned message, and the buyer's reply went to the model chat.
 * Each test below is one line of the task's acceptance, or a rule its design depends on.
 */

const MINUTE = 60_000;
const BUYER = 777;
const ADMIN_A = 999001;
const ADMIN_B = 999002;
const STRANGER = 555;

class MockKV {
  store = new Map<string, string>();
  async get(key: string, type?: string) {
    const val = this.store.get(key);
    if (val === undefined) return null;
    return type === 'json' ? JSON.parse(val) : val;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  json(key: string): any {
    const val = this.store.get(key);
    return val === undefined ? null : JSON.parse(val);
  }
}

/** Lets a test make chosen statements fail, the way a database that stops answering would. */
function faultyDb(db: SqliteD1, failure: (sql: string) => string | false): D1Database {
  const guard = (sql: string) => {
    const message = failure(sql);
    if (message) throw new Error(message);
  };
  const wrap = (stmt: any, sql: string): any => ({
    bind: (...args: unknown[]) => wrap(stmt.bind(...args), sql),
    execute: () => stmt.execute(),
    first: async (...args: unknown[]) => {
      guard(sql);
      return stmt.first(...args);
    },
    all: async () => {
      guard(sql);
      return stmt.all();
    },
    run: async () => {
      guard(sql);
      return stmt.run();
    },
  });
  return {
    prepare: (sql: string) => wrap(db.prepare(sql), sql),
    batch: async (list: any[]) => {
      guard('BATCH payment_support_requests');
      return db.batch(list);
    },
  } as unknown as D1Database;
}

type TelegramCall = { method: string; body: any };
type ModelCall = { url: string; body: any };

/**
 * Stands in for the network. Telegram calls are recorded and answered. Anything else is a model
 * call: it is recorded and answered with a completion, so a message that reached the chat shows
 * up here. That is the model spy.
 */
function installNetwork() {
  const telegram: TelegramCall[] = [];
  const model: ModelCall[] = [];
  const replies: Record<string, (body: any) => unknown> = {};
  (globalThis as any).fetch = vi.fn(async (url: unknown, init?: { body?: string }) => {
    const href = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (href.startsWith('https://api.telegram.org/')) {
      const method = href.split('/').pop() || '';
      telegram.push({ method, body });
      const answer = replies[method] ? replies[method](body) : { ok: true, result: { message_id: 1 } };
      return { ok: true, status: 200, json: async () => answer };
    }
    model.push({ url: href, body });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'MODEL ANSWER' } }] }) };
  });
  return {
    telegram,
    model,
    replies,
    of: (method: string) => telegram.filter((c) => c.method === method),
    textsTo: (chatId: number): string[] =>
      telegram.filter((c) => c.method === 'sendMessage' && Number(c.body.chat_id) === chatId).map((c) => String(c.body.text)),
  };
}

function makeEnv(overrides: Partial<Record<keyof Env, unknown>> = {}) {
  const kv = new MockKV();
  const db = createSqliteD1();
  const env = {
    ASSETS: {} as any,
    BOT_TOKEN: '123456:MOCK_TOKEN',
    WEBAPP_URL: 'https://luminarasuite.com',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    TELEGRAM_ADMIN_ID: `${ADMIN_A}, ${ADMIN_B}`,
    ADMIN_SECRET: 'admin-secret-for-tests',
    // With a key present the chat really calls a model, so the spy can see it.
    GROQ_API_KEY: 'test-model-key',
    LUMINARA_KV: kv as any,
    DB: db as D1Database,
    ...overrides,
  } as unknown as Env;
  return { env, kv, db };
}

let messageId = 100;
/** One message from a user in their private chat with the bot. */
const say = (env: Env, text: string, from: number = BUYER, extra: Record<string, unknown> = {}) =>
  handleTelegramUpdate(
    {
      message: {
        message_id: (messageId += 1),
        chat: { id: from },
        from: { id: from, username: `user${from}`, first_name: 'Bo', last_name: 'Buyer' },
        text,
        ...extra,
      },
    },
    env,
  );

const rows = (db: SqliteD1): any[] => db.sqlite.prepare('SELECT * FROM payment_support_requests ORDER BY created_at, id').all();

/** /paysupport, then the message: the id of the request that results. */
async function openRequest(env: Env, db: SqliteD1, text = 'I paid 2500 Stars and my plan did not start', from: number = BUYER): Promise<string> {
  await say(env, '/paysupport', from);
  await say(env, text, from);
  const row = db.sqlite.prepare("SELECT id FROM payment_support_requests WHERE payer_tg_id = ? AND status = 'open' ORDER BY created_at DESC, updated_at DESC LIMIT 1").get(from);
  if (!row) throw new Error('no open request was created');
  return String(row.id);
}

/** Moves the clock forward without touching the event loop the sqlite stand-in relies on. */
let realStart = 0;
let travelled = 0;
function travel(ms: number) {
  if (travelled === 0) realStart = Date.now();
  travelled += ms;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(realStart + travelled);
}

let net: ReturnType<typeof installNetwork>;
let errSpy: ReturnType<typeof vi.spyOn>;

/** handleTelegramUpdate swallows what it throws; a test of a good path must not have hidden one. */
const handlerErrors = () => errSpy.mock.calls.filter((c) => String(c[0]).includes('telegram update failed'));

beforeEach(() => {
  net = installNetwork();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  travelled = 0;
  vi.restoreAllMocks();
});

describe('the acceptance of the task', () => {
  it('a message sent after /paysupport creates one row and no model call, and each admin receives it', async () => {
    const { env, kv, db } = makeEnv();

    await say(env, '/paysupport');
    expect(net.textsTo(BUYER)[0]).toContain('It goes to a person, not to the assistant');
    expect(rows(db)).toMatchObject([{ payer_tg_id: BUYER, account_id: String(BUYER), status: 'awaiting', message: null }]);

    await say(env, 'I paid 2500 Stars and my plan did not start');
    const all = rows(db);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ payer_tg_id: BUYER, status: 'open', message: 'I paid 2500 Stars and my plan did not start' });

    // No model was called, and nothing was kept for a later prompt.
    expect(net.model).toHaveLength(0);
    expect(kv.store.has(`tg:chat:${BUYER}`)).toBe(false);
    expect(net.of('sendChatAction')).toHaveLength(0);

    for (const admin of [ADMIN_A, ADMIN_B]) {
      const got = net.textsTo(admin);
      expect(got).toHaveLength(1);
      expect(got[0]).toContain(`Payment support request ${all[0].id}`);
      expect(got[0]).toContain(`Telegram id ${BUYER} (@user${BUYER}, Bo Buyer)`);
      expect(got[0]).toContain('I paid 2500 Stars and my plan did not start');
      expect(got[0]).toContain(`/reply ${all[0].id} your answer`);
    }

    const ack = net.textsTo(BUYER)[1];
    expect(ack).toContain('Received. A person will answer here');
    expect(ack).toContain(all[0].id);
    expect(handlerErrors()).toEqual([]);
  });

  it('a message sent 11 minutes later goes to chat as today', async () => {
    const { env, kv, db } = makeEnv();
    await say(env, '/paysupport');
    travel(11 * MINUTE);

    await say(env, 'what is schema markup');
    // The spy sees it: this is what a message that reaches the chat looks like.
    expect(net.model).toHaveLength(1);
    expect(net.model[0].url).toContain('api.groq.com');
    expect(net.model[0].body.messages.at(-1)).toEqual({ role: 'user', content: 'what is schema markup' });
    expect(net.textsTo(BUYER).at(-1)).toBe('MODEL ANSWER');
    expect(kv.json(`tg:chat:${BUYER}`)).toHaveLength(2);

    // The unused window never became a request, and no admin heard of it.
    expect(rows(db)).toMatchObject([{ status: 'awaiting', message: null }]);
    expect(net.textsTo(ADMIN_A)).toEqual([]);
    expect(handlerErrors()).toEqual([]);
  });

  it('/reply from an admin reaches the buyer and marks the request answered', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db);
    const before = net.textsTo(BUYER).length;

    await say(env, `/reply ${id} We refunded the charge.\nIt can take a minute to show.`, ADMIN_A);

    const toBuyer = net.textsTo(BUYER).slice(before);
    expect(toBuyer).toHaveLength(1);
    expect(toBuyer[0]).toContain(`Luminara support, about your request ${id}`);
    expect(toBuyer[0]).toContain('We refunded the charge.\nIt can take a minute to show.');
    expect(toBuyer[0]).toContain('Your next message here, within 3 days, goes back to support.');
    expect(rows(db)[0]).toMatchObject({ id, status: 'answered' });
    expect(net.textsTo(ADMIN_A).at(-1)).toContain(`Sent to the buyer. Request ${id} is marked answered.`);
    expect(net.model).toHaveLength(0);
    expect(db.sqlite.prepare("SELECT actor_id, details FROM org_audit_logs WHERE action = 'support.reply'").all()).toEqual([
      expect.objectContaining({ actor_id: `tg:${ADMIN_A}` }),
    ]);
    expect(handlerErrors()).toEqual([]);
  });

  it.each([
    ['a stranger', STRANGER],
    ['the buyer', BUYER],
  ])('/reply from %s is refused', async (_who, sender) => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db);
    const toBuyerBefore = net.textsTo(BUYER).length;

    await say(env, `/reply ${id} your refund is on its way`, sender);

    expect(net.textsTo(sender).at(-1)).toBe('Unauthorized. Only configured bot administrators can answer support requests.');
    expect(rows(db)[0]).toMatchObject({ id, status: 'open' });
    // Nothing was relayed to the buyer as if it came from support.
    const relayed = net.textsTo(BUYER).slice(toBuyerBefore).filter((t) => t.includes('Luminara support'));
    expect(relayed).toEqual([]);
    expect(net.model).toHaveLength(0);
  });

  it('export and delete cover the table', async () => {
    const { env, kv, db } = makeEnv();
    const id = await openRequest(env, db, 'my receipt is ch_abc');
    const user = { id: String(BUYER), accountId: String(BUYER), source: 'telegram' } as HostedIdentity;

    const exported = await createPrivacyJob(env, user, 'export');
    const { jobId } = (await exported.json()) as { jobId: string };
    const body = JSON.parse((await kv.get(`privacy:export:${jobId}`)) as string);
    expect(body.processors).toContain('payment_support_requests');
    expect(body.paymentSupportRequests).toEqual([expect.objectContaining({ id, message: 'my receipt is ch_abc', status: 'open' })]);

    const deleted = await createPrivacyJob(env, user, 'delete');
    expect(deleted.status).toBe(200);
    expect(rows(db)).toEqual([]);
  });
});

describe("the buyer's words never reach a model", () => {
  it('not in a later prompt either: the request is not in the chat history, and neither is the answer', async () => {
    const { env, kv, db } = makeEnv();
    const id = await openRequest(env, db, 'SECRET-BILLING-DETAIL card ending 4242');
    await say(env, `/reply ${id} SUPPORT-ANSWER-TEXT`, ADMIN_A);
    expect(net.model).toHaveLength(0);

    // The first thing the buyer sends after an answer goes back to support (see below), so the
    // chat is reached by the message after it.
    travel(SUPPORT_WINDOW_MS + MINUTE);
    await say(env, 'thanks, that fixed it');
    expect(net.model).toHaveLength(0);
    await say(env, 'how do I get cited by ChatGPT');
    expect(net.model).toHaveLength(1);
    const prompt = JSON.stringify(net.model[0].body);
    expect(prompt).not.toContain('SECRET-BILLING-DETAIL');
    expect(prompt).not.toContain('SUPPORT-ANSWER-TEXT');
    expect(JSON.stringify(kv.json(`tg:chat:${BUYER}`))).not.toContain('SECRET-BILLING-DETAIL');
  });

  it('more messages in the next 10 minutes are added to the same request and forwarded, then chat is chat again', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db, 'my plan did not start');
    travel(2 * MINUTE);
    await say(env, 'the receipt id is ch_123');

    expect(net.model).toHaveLength(0);
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0].message).toBe('my plan did not start\nthe receipt id is ch_123');
    expect(net.textsTo(BUYER).at(-1)).toBe(`Added to request ${id}.`);
    const followUp = net.textsTo(ADMIN_B).at(-1)!;
    expect(followUp).toContain(`More on payment support request ${id}`);
    expect(followUp).toContain('the receipt id is ch_123');
    expect(followUp).not.toContain('my plan did not start');

    travel(SUPPORT_WINDOW_MS);
    await say(env, 'thanks, and what is GEO');
    expect(net.model).toHaveLength(1);
    expect(rows(db)[0].message).toBe('my plan did not start\nthe receipt id is ch_123');
  });

  it('two messages arriving together make one request, and neither goes to a model', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport');
    await Promise.all([say(env, 'first half'), say(env, 'second half')]);

    const all = rows(db);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('open');
    expect(String(all[0].message).split('\n').sort()).toEqual(['first half', 'second half']);
    expect(net.model).toHaveLength(0);
    const acks = net.textsTo(BUYER).slice(1);
    expect(acks.filter((t) => t.startsWith('Received.'))).toHaveLength(1);
    expect(acks.filter((t) => t.startsWith('Added to request'))).toHaveLength(1);
  });

  it('when it cannot be told whether a window is open, the message is not read at all, and the buyer is asked to send it again', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport');
    env.DB = faultyDb(db, (sql) => (/FROM payment_support_requests/.test(sql) ? 'D1_ERROR: Network connection lost.' : false));

    await say(env, 'I was charged twice');
    expect(net.model).toHaveLength(0);
    expect(net.textsTo(BUYER).at(-1)).toContain('this message was not read. Please send it again in a minute.');
    expect(rows(db)).toMatchObject([{ status: 'awaiting', message: null }]);

    // The database answers again: the same message is now the request.
    env.DB = db as D1Database;
    await say(env, 'I was charged twice');
    expect(rows(db)).toMatchObject([{ status: 'open', message: 'I was charged twice' }]);
    expect(net.model).toHaveLength(0);
  });

  it('the window check sits above the chat in the handler, and support messages carry no formatting mode', () => {
    const source = readFileSync(resolve(__dirname, '..', 'worker', 'telegramBot.ts'), 'utf8');
    const handler = source.slice(source.indexOf('export async function handleTelegramUpdate'), source.indexOf('export async function createInvoiceLink'));
    const check = handler.indexOf('await receiveSupportMessage(env, msg,');
    const chat = handler.indexOf('await generateOracleChatResponse(env, messages)');
    const history = handler.indexOf('const histKey = `tg:chat:${chatId}`');
    expect(check).toBeGreaterThan(0);
    expect(chat).toBeGreaterThan(check);
    expect(history).toBeGreaterThan(check);

    const section = source.slice(source.indexOf('// Payment support (Track SW, SW0a-16)'), source.indexOf('// Stars payments (Track SW, SW0a-3)'));
    expect(section.length).toBeGreaterThan(1000);
    expect(section).not.toContain('parse_mode');
    expect(section).not.toContain('generateOracleChatResponse');
  });

  it('a database from before the migration changes nothing: chat works, and /paysupport gives the address to write to', async () => {
    const { env } = makeEnv();
    const old = createSqliteD1({ skipMigrations: ['0026'] });
    env.DB = old as D1Database;

    await say(env, '/paysupport');
    expect(net.textsTo(BUYER).at(-1)).toContain('We could not open a support request just now');
    expect(net.textsTo(BUYER).at(-1)).toContain('support@luminarasuite.com');

    await say(env, 'what is schema markup');
    expect(net.model).toHaveLength(1);
    expect(net.textsTo(BUYER).at(-1)).toBe('MODEL ANSWER');
    expect(handlerErrors()).toEqual([]);
  });
});

describe('after an admin has answered', () => {
  /** The support answer as Telegram hands it back when the buyer replies to it. */
  const answerFrom = (id: string) => ({ from: { id: 123456, is_bot: true }, text: `Luminara support, about your request ${id}:\n\nWe refunded it.` });

  it('a buyer who simply types back reaches support again, not the model; the message after that is chat', async () => {
    const { env, kv, db } = makeEnv();
    const id = await openRequest(env, db, 'my plan did not start');
    await say(env, `/reply ${id} We refunded it.`, ADMIN_A);
    expect(rows(db)[0]).toMatchObject({ status: 'answered', follow_ups: 0 });

    travel(2 * 60 * MINUTE);
    await say(env, 'it still does not work');
    expect(net.model).toHaveLength(0);
    expect(kv.store.has(`tg:chat:${BUYER}`)).toBe(false);
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ id, status: 'open', message: 'my plan did not start\nit still does not work' });
    expect(net.textsTo(ADMIN_B).at(-1)).toContain(`More on payment support request ${id}`);
    expect(net.textsTo(ADMIN_B).at(-1)).toContain('it still does not work');
    expect(net.textsTo(BUYER).at(-1)).toContain(`Sent to support as a follow-up to request ${id}`);
    expect(net.textsTo(BUYER).at(-1)).toContain('Anything else you send now goes to the assistant.');

    // And it does: one message returned to support, not every message from then on.
    await say(env, 'what is schema markup');
    expect(net.model).toHaveLength(1);
    expect(net.model[0].body.messages.at(-1).content).toBe('what is schema markup');
    expect(JSON.stringify(net.model[0].body)).not.toContain('it still does not work');
  });

  it('after three days a message is chat again, and the request stays answered', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db);
    await say(env, 'one more thing');
    expect(rows(db)[0].follow_ups).toBe(1);
    await say(env, `/reply ${id} done`, ADMIN_A);
    // An answer starts the count again, so the buyer can write back.
    expect(rows(db)[0].follow_ups).toBe(0);

    travel(SUPPORT_REPLY_WINDOW_MS + MINUTE);
    await say(env, 'what is GEO');
    expect(net.model).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ id, status: 'answered' });
  });

  it("answering with Telegram's own reply returns to that request at any time, and only for the buyer it belongs to", async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db, 'first message');
    await say(env, `/reply ${id} We refunded it.`, ADMIN_A);
    travel(SUPPORT_REPLY_WINDOW_MS + 24 * 60 * MINUTE);

    // Somebody else pointing at this request gets the chat, and the request is untouched.
    await say(env, 'let me in', STRANGER, { reply_to_message: answerFrom(id) });
    expect(net.model).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ status: 'answered', message: 'first message' });

    // A message that only quotes those words, without being a reply to the bot, is chat too.
    await say(env, 'quoting', BUYER, { reply_to_message: { from: { id: BUYER, is_bot: false }, text: answerFrom(id).text } });
    expect(net.model).toHaveLength(2);

    await say(env, 'the refund has not arrived', BUYER, { reply_to_message: answerFrom(id) });
    expect(net.model).toHaveLength(2);
    expect(rows(db)[0]).toMatchObject({ status: 'open', message: 'first message\nthe refund has not arrived' });
    expect(net.textsTo(ADMIN_A).at(-1)).toContain('the refund has not arrived');
  });

  it('a closed request takes nothing more, by window or by reply', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db, 'spam');
    await say(env, `/reply ${id} noted`, ADMIN_A);
    await say(env, `/close ${id}`, ADMIN_A);

    await say(env, 'hello again');
    await say(env, 'and again', BUYER, { reply_to_message: answerFrom(id) });
    expect(net.model).toHaveLength(2);
    expect(rows(db)[0]).toMatchObject({ status: 'closed', message: 'spam' });
  });
});

describe('what the second review asked for', () => {
  const fromBot = (text: string) => ({ from: { id: 123456, is_bot: true }, text });

  it("a Telegram reply to the bot's own acknowledgement reaches the request after the 10 minutes, for its sender only", async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db, 'first');
    const ack = fromBot(`Received. A person will answer here. Your request id is ${id}. Anything else you send in the next 10 minutes is added to it.`);
    travel(SUPPORT_WINDOW_MS + 5 * MINUTE);

    await say(env, 'not mine', STRANGER, { reply_to_message: ack });
    expect(net.model).toHaveLength(1);
    expect(rows(db)[0].message).toBe('first');

    await say(env, 'forgot the receipt: ch_9', BUYER, { reply_to_message: ack });
    expect(net.model).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({ id, status: 'open', message: 'first\nforgot the receipt: ch_9', follow_ups: 1 });
    expect(net.textsTo(ADMIN_A).at(-1)).toContain('forgot the receipt: ch_9');
  });

  it('with two answered requests, a typed reply goes to the one answered last, and the other stops waiting for one', async () => {
    const { env, db } = makeEnv();
    const first = await openRequest(env, db, 'request A');
    travel(SUPPORT_WINDOW_MS + MINUTE);
    const second = await openRequest(env, db, 'request B');
    const byId = (id: string) => rows(db).find((r) => r.id === id);

    await say(env, `/reply ${second} answer to B`, ADMIN_A);
    travel(MINUTE);
    await say(env, `/reply ${first} answer to A`, ADMIN_A);
    travel(MINUTE);

    // A was answered last, although B was opened last.
    await say(env, 'thanks, about A');
    expect(byId(first)).toMatchObject({ status: 'open', message: 'request A\nthanks, about A' });
    expect(byId(second)).toMatchObject({ status: 'answered', message: 'request B' });
    expect(net.model).toHaveLength(0);

    // The buyer was told the next message goes to the assistant, and it does.
    await say(env, 'what is GEO');
    expect(net.model).toHaveLength(1);
    expect(byId(second)).toMatchObject({ status: 'answered', message: 'request B' });

    // B can still be reached by pointing at its answer.
    await say(env, 'and about B', BUYER, { reply_to_message: fromBot(`Luminara support, about your request ${second}:\n\nanswer to B`) });
    expect(byId(second)).toMatchObject({ status: 'open', message: 'request B\nand about B' });
    expect(net.model).toHaveLength(1);
  });

  it('closing an answered request tells the buyer, who had been told their next message would come back', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db);
    await say(env, `/reply ${id} done`, ADMIN_A);
    await say(env, `/close ${id}`, ADMIN_A);

    expect(net.textsTo(BUYER).at(-1)).toBe(`Your payment support request ${id} is now closed. To write to us again, send /paysupport.`);
    expect(net.textsTo(ADMIN_A).at(-1)).toBe(`Request ${id} is closed. The buyer was told, because their next message would have come back here.`);
    expect(rows(db)[0].status).toBe('closed');
  });

  it('closing a request nobody answered sends the buyer nothing', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db);
    const before = net.textsTo(BUYER).length;
    await say(env, `/close ${id}`, ADMIN_A);
    expect(net.textsTo(BUYER)).toHaveLength(before);
    expect(net.textsTo(ADMIN_A).at(-1)).toBe(`Request ${id} is closed. The buyer was not messaged.`);
  });

  it('a message of a thousand short lines still arrives with the lines that say how to answer it', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport');
    await say(env, Array(1000).fill('a').join('\n'));
    const id = rows(db)[0].id;
    const notice = net.textsTo(ADMIN_A)[0];

    expect(notice.length).toBeLessThanOrEqual(4000);
    expect(notice.endsWith(`Answer: /reply ${id} your answer\nClose without answering: /close ${id}`)).toBe(true);
    expect(notice).toContain('(shortened here to fit one message; the stored request has the rest)');
    // What is stored is whole.
    expect(rows(db)[0].message).toHaveLength(1999);
  });

  it('a request waits from its last message: one the buyer reopened a moment ago is not overdue', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db);
    await say(env, `/reply ${id} done`, ADMIN_A);
    travel(SUPPORT_REMIND_AFTER_MS + 60 * MINUTE);
    await say(env, 'it happened again');
    expect(rows(db)[0].status).toBe('open');

    expect(await runPaymentSupportSweep(env)).toMatchObject({ open: 1, overdue: 0 });
    travel(SUPPORT_REMIND_AFTER_MS + MINUTE);
    expect(await runPaymentSupportSweep(env)).toMatchObject({ open: 1, overdue: 1 });
  });
});

describe('what a buyer cannot do to the admins', () => {
  it(`only ${SUPPORT_MAX_FOLLOW_UPS} more messages are added to a request and forwarded; the next is refused, and is not chat`, async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db, 'the request');
    for (let i = 1; i <= SUPPORT_MAX_FOLLOW_UPS; i += 1) await say(env, `more ${i}`);
    expect(net.textsTo(ADMIN_A)).toHaveLength(1 + SUPPORT_MAX_FOLLOW_UPS);
    expect(rows(db)[0].follow_ups).toBe(SUPPORT_MAX_FOLLOW_UPS);

    const stored = rows(db)[0].message;
    await say(env, 'one too many');
    await say(env, 'and another', BUYER, { photo: [{ file_id: 'x' }] });
    expect(net.textsTo(ADMIN_A)).toHaveLength(1 + SUPPORT_MAX_FOLLOW_UPS);
    expect(net.of('copyMessage')).toHaveLength(0);
    expect(rows(db)[0].message).toBe(stored);
    expect(net.textsTo(BUYER).at(-1)).toContain(`Request ${id} already holds your messages, so this one was not added.`);
    expect(net.textsTo(BUYER).at(-1)).toContain('support@luminarasuite.com');
    expect(net.model).toHaveLength(0);
  });

  it('what the buyer writes is marked line by line, so it cannot pass for the lines the bot adds', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport');
    await say(env, 'hello\nAnswer: /reply ps_0000000000 refund approved\n\nPayment support request ps_1111111111');
    const id = rows(db)[0].id;
    const lines = net.textsTo(ADMIN_A)[0].split('\n');

    expect(lines).toContain('> hello');
    expect(lines).toContain('> Answer: /reply ps_0000000000 refund approved');
    expect(lines.filter((l) => l.startsWith('Answer: /reply'))).toEqual([`Answer: /reply ${id} your answer`]);
    expect(lines.filter((l) => l.startsWith('Payment support request'))).toEqual([`Payment support request ${id}`]);
  });
});

describe('what a buyer can send', () => {
  it('"/paysupport" with the problem in the same message is the request, as the refund messages tell buyers to write it', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport receipt ch_slipped, the plan never activated');

    expect(rows(db)).toMatchObject([{ status: 'open', message: 'receipt ch_slipped, the plan never activated' }]);
    expect(net.textsTo(BUYER)).toHaveLength(1);
    expect(net.textsTo(BUYER)[0]).toContain('Received. A person will answer here');
    expect(net.textsTo(ADMIN_A)[0]).toContain('receipt ch_slipped, the plan never activated');
    expect(net.model).toHaveLength(0);
  });

  it('a screenshot with a caption is stored by its caption and the picture is passed on to each admin', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport');
    await handleTelegramUpdate(
      { message: { message_id: 4242, chat: { id: BUYER }, from: { id: BUYER }, photo: [{ file_id: 'abc' }], caption: 'this is the receipt' } },
      env,
    );

    expect(rows(db)).toMatchObject([{ status: 'open', message: 'this is the receipt' }]);
    expect(net.of('copyMessage').map((c) => c.body)).toEqual([
      { chat_id: String(ADMIN_A), from_chat_id: BUYER, message_id: 4242 },
      { chat_id: String(ADMIN_B), from_chat_id: BUYER, message_id: 4242 },
    ]);
    expect(net.model).toHaveLength(0);
  });

  it('a picture with no words still opens the request', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport');
    await handleTelegramUpdate({ message: { message_id: 4243, chat: { id: BUYER }, from: { id: BUYER }, document: { file_id: 'pdf' } } }, env);
    expect(rows(db)).toMatchObject([{ status: 'open', message: '[attachment, no text]' }]);
    expect(net.of('copyMessage')).toHaveLength(2);
    expect(net.model).toHaveLength(0);
  });

  it('a contact or a location sent inside the window opens the request too, and is passed on', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport');
    await handleTelegramUpdate({ message: { message_id: 4250, chat: { id: BUYER }, from: { id: BUYER }, location: { latitude: 1, longitude: 2 } } }, env);
    expect(rows(db)).toMatchObject([{ status: 'open', message: '[attachment, no text]' }]);
    expect(net.of('copyMessage')).toHaveLength(2);
    expect(net.model).toHaveLength(0);
  });

  it('when the attachment cannot be copied to anyone, both sides are told; the words still count', async () => {
    const { env, db } = makeEnv();
    net.replies.copyMessage = () => ({ ok: false, description: 'Bad Request: message to copy not found' });
    await say(env, '/paysupport');
    await handleTelegramUpdate(
      { message: { message_id: 4251, chat: { id: BUYER }, from: { id: BUYER }, photo: [{ file_id: 'abc' }], caption: 'see the receipt' } },
      env,
    );

    expect(rows(db)).toMatchObject([{ status: 'open', message: 'see the receipt' }]);
    for (const admin of [ADMIN_A, ADMIN_B]) {
      expect(net.textsTo(admin)).toHaveLength(2);
      expect(net.textsTo(admin)[1]).toBe('An attachment came with that message and could not be copied here.');
    }
    const ack = net.textsTo(BUYER).at(-1)!;
    expect(ack).toContain('Received. A person will answer here');
    expect(ack).toContain('Your attachment did not come through');
  });

  it('a message longer than the column holds is cut there, and the admins read that it was', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport');
    await say(env, 'x'.repeat(SUPPORT_MESSAGE_MAX + 500));

    expect(rows(db)[0].message).toHaveLength(SUPPORT_MESSAGE_MAX);
    expect(net.textsTo(ADMIN_A)[0]).toContain('Longer than 2,000 characters');
    expect(net.model).toHaveLength(0);
  });

  it('a command inside the window is still a command, and the window stays open for the message after it', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport');
    await say(env, '/status');
    expect(rows(db)).toMatchObject([{ status: 'awaiting' }]);
    expect(net.textsTo(BUYER).at(-1)).toContain('No active subscription');

    await say(env, 'my plan is missing');
    expect(rows(db)).toMatchObject([{ status: 'open', message: 'my plan is missing' }]);
    expect(net.model).toHaveLength(0);
  });

  it('/paysupport twice leaves one window, not two', async () => {
    const { env, db } = makeEnv();
    await say(env, '/paysupport');
    travel(MINUTE);
    await say(env, '/paysupport');
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0].status).toBe('awaiting');
  });

  it('the request names the most recent Stars charge of the payer, or the one on an older subscription record', async () => {
    const { env, kv, db } = makeEnv();
    await recordStarsCharge(env, { chargeId: 'ch_old', payerTgId: BUYER, accountId: String(BUYER), purpose: 'plan', refId: 'starter', stars: 2500, status: 'credited' });
    travel(MINUTE);
    await recordStarsCharge(env, { chargeId: 'ch_new', payerTgId: BUYER, accountId: String(BUYER), purpose: 'plan', refId: 'starter', stars: 2500, status: 'refund_due' });
    await openRequest(env, db);
    expect(rows(db)[0].charge_id).toBe('ch_new');
    expect(net.textsTo(ADMIN_A)[0]).toContain('Most recent Stars charge: ch_new');

    // A purchase from before the ledger existed.
    await kv.put(`sub:${STRANGER}`, JSON.stringify({ plan: 'starter', expiresAt: Date.now() + 86400_000, chargeId: 'ch_before_ledger' }));
    await openRequest(env, db, 'help', STRANGER);
    expect(db.sqlite.prepare('SELECT charge_id FROM payment_support_requests WHERE payer_tg_id = ?').get(STRANGER).charge_id).toBe('ch_before_ledger');
  });

  it('with no charge on record the request says so instead of leaving a gap', async () => {
    const { env, db } = makeEnv();
    await openRequest(env, db);
    expect(rows(db)[0].charge_id).toBeNull();
    expect(net.textsTo(ADMIN_A)[0]).toContain('Most recent Stars charge: none on record');
  });
});

describe('limits and places', () => {
  it(`one Telegram account can have ${SUPPORT_MAX_OPEN_PER_PAYER} unanswered requests; the next /paysupport is told where else to write`, async () => {
    const { env, db } = makeEnv();
    for (let i = 0; i < SUPPORT_MAX_OPEN_PER_PAYER; i += 1) {
      travel(SUPPORT_WINDOW_MS + MINUTE);
      await openRequest(env, db, `request number ${i}`);
    }
    expect(rows(db)).toHaveLength(SUPPORT_MAX_OPEN_PER_PAYER);

    travel(SUPPORT_WINDOW_MS + MINUTE);
    await say(env, '/paysupport');
    expect(net.textsTo(BUYER).at(-1)).toContain('Your earlier requests are saved and waiting for a person');
    expect(net.textsTo(BUYER).at(-1)).toContain('support@luminarasuite.com');
    expect(rows(db)).toHaveLength(SUPPORT_MAX_OPEN_PER_PAYER);

    // Once one is answered there is room again.
    await say(env, `/reply ${rows(db)[0].id} done`, ADMIN_A);
    await say(env, '/paysupport');
    expect(rows(db).filter((r) => r.status === 'awaiting')).toHaveLength(1);
  });

  it('in a group, /paysupport points to the private chat, and a window opened in private does not take a group message', async () => {
    const { env, db } = makeEnv();
    const group = -1001234;
    await handleTelegramUpdate({ message: { message_id: 1, chat: { id: group, type: 'supergroup' }, from: { id: BUYER }, text: '/paysupport' } }, env);
    expect(net.textsTo(group).at(-1)).toBe('Billing help is private. Open a chat with this bot and send /paysupport there.');
    expect(rows(db)).toEqual([]);

    await say(env, '/paysupport');
    await handleTelegramUpdate({ message: { message_id: 2, chat: { id: group, type: 'supergroup' }, from: { id: BUYER }, text: 'hello everyone' } }, env);
    expect(rows(db)).toMatchObject([{ status: 'awaiting', message: null }]);
    expect(net.textsTo(ADMIN_A)).toEqual([]);
  });

  it('when no admin can be told, the request is still saved and the buyer is told to write to the address as well', async () => {
    const { env, db } = makeEnv({ TELEGRAM_ADMIN_ID: '' });
    await say(env, '/paysupport');
    await say(env, 'charged and no plan');

    expect(rows(db)).toMatchObject([{ status: 'open', message: 'charged and no plan' }]);
    const ack = net.textsTo(BUYER).at(-1)!;
    expect(ack).toContain(`Received and saved as request ${rows(db)[0].id}`);
    expect(ack).toContain('support@luminarasuite.com');
    expect(ack).not.toContain('A person will answer here');
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('[Support] ALERT'))).toBe(true);
    expect(net.model).toHaveLength(0);
  });

  it('the same when Telegram refuses every message to the admins', async () => {
    const { env, db } = makeEnv();
    net.replies.sendMessage = (body) =>
      [ADMIN_A, ADMIN_B].includes(Number(body.chat_id)) ? { ok: false, description: 'Forbidden: bot was blocked by the user' } : { ok: true, result: {} };
    await say(env, '/paysupport');
    await say(env, 'charged and no plan');
    expect(rows(db)[0].status).toBe('open');
    expect(net.textsTo(BUYER).at(-1)).toContain('We could not alert our team just now');
  });
});

describe('what an admin can do', () => {
  it('/reply needs an id that exists, a request that has a message, and one that is not closed', async () => {
    const { env, db } = makeEnv();
    await say(env, '/reply', ADMIN_A);
    expect(net.textsTo(ADMIN_A).at(-1)).toBe('Use: /reply <request id> <your answer>');
    await say(env, '/reply ps_0000000000 hello', ADMIN_A);
    expect(net.textsTo(ADMIN_A).at(-1)).toBe('No support request with the id ps_0000000000.');

    // A window nobody has written into is not a request.
    await say(env, '/paysupport');
    const awaiting = rows(db)[0].id;
    await say(env, `/reply ${awaiting} hello`, ADMIN_A);
    expect(net.textsTo(ADMIN_A).at(-1)).toBe(`No support request with the id ${awaiting}.`);
    expect(net.textsTo(BUYER).filter((t) => t.includes('Luminara support'))).toEqual([]);

    await say(env, 'now it is a request');
    await say(env, `/close ${awaiting}`, ADMIN_A);
    expect(rows(db)[0].status).toBe('closed');
    expect(net.textsTo(ADMIN_A).at(-1)).toBe(`Request ${awaiting} is closed. The buyer was not messaged.`);
    await say(env, `/reply ${awaiting} too late`, ADMIN_A);
    expect(net.textsTo(ADMIN_A).at(-1)).toBe(`Request ${awaiting} is closed.`);
    expect(net.textsTo(BUYER).filter((t) => t.includes('Luminara support'))).toEqual([]);
  });

  it('an answer that Telegram does not deliver leaves the request open, and the admin reads why', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db);
    net.replies.sendMessage = (body) =>
      Number(body.chat_id) === BUYER ? { ok: false, description: 'Forbidden: bot was blocked by the user' } : { ok: true, result: {} };

    await say(env, `/reply ${id} hello`, ADMIN_A);
    expect(rows(db)[0].status).toBe('open');
    expect(net.textsTo(ADMIN_A).at(-1)).toBe(`Not delivered to the buyer: Forbidden: bot was blocked by the user. Request ${id} is still open.`);
  });

  it('a request can be answered again, and the answer is sent as plain text', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db);
    await say(env, `/reply ${id} first *answer*`, ADMIN_A);
    await say(env, `/reply ${id} second_answer`, ADMIN_B);
    expect(rows(db)[0].status).toBe('answered');
    const relayed = net.of('sendMessage').filter((c) => Number(c.body.chat_id) === BUYER && String(c.body.text).includes('Luminara support'));
    expect(relayed).toHaveLength(2);
    for (const call of relayed) expect(call.body).not.toHaveProperty('parse_mode');
  });

  it('/requests lists what is waiting, oldest first, to admins only', async () => {
    const { env, db } = makeEnv();
    await say(env, '/requests', ADMIN_A);
    expect(net.textsTo(ADMIN_A).at(-1)).toBe('No payment support requests are waiting for an answer.');

    const first = await openRequest(env, db, 'oldest problem');
    travel(3 * 60 * MINUTE);
    const second = await openRequest(env, db, 'newer problem', STRANGER);
    await say(env, '/requests', ADMIN_A);
    const list = net.textsTo(ADMIN_A).at(-1)!;
    expect(list.indexOf(first)).toBeGreaterThan(0);
    expect(list.indexOf(second)).toBeGreaterThan(list.indexOf(first));
    expect(list).toContain('oldest problem');
    expect(list).toContain(`${first} · 3h · Telegram id ${BUYER}`);

    await say(env, '/requests', STRANGER);
    expect(net.textsTo(STRANGER).at(-1)).toBe('Unauthorized. Only configured bot administrators can answer support requests.');
    await say(env, `/close ${first}`, STRANGER);
    expect(rows(db).find((r) => r.id === first).status).toBe('open');
  });

  it('in a group an admin command does nothing but say where to use it, so no buyer is shown to the room', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db, 'private words');
    const group = -1005678;
    const inGroup = (text: string) =>
      handleTelegramUpdate({ message: { message_id: 9, chat: { id: group, type: 'supergroup' }, from: { id: ADMIN_A }, text } }, env);
    const toBuyerBefore = net.textsTo(BUYER).length;

    await inGroup('/requests');
    await inGroup(`/reply ${id} answering in the wrong place`);
    await inGroup(`/close ${id}`);

    expect(net.textsTo(group)).toEqual(Array(3).fill('Use this command in a private chat with the bot.'));
    expect(net.textsTo(group).join('\n')).not.toContain('private words');
    expect(net.textsTo(BUYER)).toHaveLength(toBuyerBefore);
    expect(rows(db)[0].status).toBe('open');
  });

  it('when the requests cannot be read, the admin is told nothing was sent', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db);
    env.DB = faultyDb(db, (sql) => (/FROM payment_support_requests WHERE id = \?/.test(sql) ? 'D1_ERROR: Network connection lost.' : false));
    await say(env, `/reply ${id} hello`, ADMIN_A);
    expect(net.textsTo(ADMIN_A).at(-1)).toBe('The support requests could not be read just now. Nothing was sent. Try again in a minute.');
    expect(net.textsTo(BUYER).filter((t) => t.includes('Luminara support'))).toEqual([]);
  });

  it('the list route needs the admin secret, returns the requests, and records that they were read', async () => {
    const { env, db } = makeEnv();
    const id = await openRequest(env, db, 'route me');
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const get = (query: string, secret?: string) =>
      worker.fetch(
        new Request(`https://luminarasuite.com/api/admin/payment-support${query}`, { headers: secret ? { 'x-admin-secret': secret } : {} }),
        env,
        ctx,
      );

    expect((await get('')).status).toBe(401);
    expect((await get('', 'wrong')).status).toBe(401);
    expect((await get('?status=awaiting', 'admin-secret-for-tests')).status).toBe(400);

    const ok = await get('', 'admin-secret-for-tests');
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { total: number; requests: Array<{ id: string; message: string }> };
    expect(body.total).toBe(1);
    expect(body.requests[0]).toMatchObject({ id, message: 'route me', status: 'open', payer_tg_id: BUYER });
    expect(((await (await get('?status=answered', 'admin-secret-for-tests')).json()) as { total: number }).total).toBe(0);

    const audits = db.sqlite.prepare("SELECT details FROM org_audit_logs WHERE action = 'admin.payment_support.list'").all();
    expect(audits).toHaveLength(2);
    // The audit row says how many were read, not what they said.
    expect(JSON.stringify(audits)).not.toContain('route me');

    const post = await worker.fetch(
      new Request('https://luminarasuite.com/api/admin/payment-support', { method: 'POST', headers: { 'x-admin-secret': 'admin-secret-for-tests' } }),
      env,
      ctx,
    );
    expect(post.status).toBe(405);
  });
});

describe('the daily sweep', () => {
  it('removes windows nobody wrote into, and leaves requests alone', async () => {
    const { env, db } = makeEnv();
    await openRequest(env, db, 'a real request');
    await say(env, '/paysupport', STRANGER);
    expect(rows(db)).toHaveLength(2);

    // Still inside its 10 minutes: kept.
    travel(5 * MINUTE);
    expect((await runPaymentSupportSweep(env))?.deleted).toBe(0);
    expect(rows(db)).toHaveLength(2);

    travel(6 * MINUTE);
    const summary = await runPaymentSupportSweep(env);
    expect(summary).toEqual({ deleted: 1, purged: 0, open: 1, overdue: 0 });
    expect(rows(db)).toMatchObject([{ status: 'open', message: 'a real request' }]);
  });

  it('reminds the admins of a request that has waited more than a day, and says nothing before that', async () => {
    const { env, db } = makeEnv();
    await openRequest(env, db);
    const told = () => net.textsTo(ADMIN_A).filter((t) => t.includes('waited more than a day'));

    travel(SUPPORT_REMIND_AFTER_MS - MINUTE);
    await runPaymentSupportSweep(env);
    expect(told()).toEqual([]);

    travel(2 * MINUTE);
    await runPaymentSupportSweep(env);
    expect(told()).toEqual(['1 payment support request has waited more than a day for an answer (1 open in all). Send /requests to read them.']);

    // Answered: nothing to remind about.
    await say(env, `/reply ${rows(db)[0].id} done`, ADMIN_A);
    await runPaymentSupportSweep(env);
    expect(told()).toHaveLength(1);
  });

  it('removes an answered or closed request 12 months after it was last touched, and never one that still waits', async () => {
    const { env, db } = makeEnv();
    const answered = await openRequest(env, db, 'answered one');
    await say(env, `/reply ${answered} done`, ADMIN_A);
    travel(SUPPORT_WINDOW_MS + MINUTE);
    const closed = await openRequest(env, db, 'closed one', STRANGER);
    await say(env, `/close ${closed}`, ADMIN_A);
    travel(SUPPORT_WINDOW_MS + MINUTE);
    const waiting = await openRequest(env, db, 'nobody answered this', ADMIN_B);

    travel(SUPPORT_RETENTION_MS - 60 * MINUTE);
    expect((await runPaymentSupportSweep(env))?.purged).toBe(0);
    expect(rows(db)).toHaveLength(3);

    travel(2 * 60 * MINUTE);
    const summary = await runPaymentSupportSweep(env);
    expect(summary?.purged).toBe(2);
    expect(rows(db)).toMatchObject([{ id: waiting, status: 'open', message: 'nobody answered this' }]);
  });

  it('does nothing, quietly, on a database from before the migration', async () => {
    const { env } = makeEnv();
    env.DB = createSqliteD1({ skipMigrations: ['0026'] }) as D1Database;
    expect(await runPaymentSupportSweep(env)).toBeNull();
    expect(errSpy.mock.calls.filter((c) => String(c[0]).includes('[Support]'))).toEqual([]);
  });

  it('runs on the daily cron', async () => {
    const { ALL_SCHEDULED_JOBS, DAILY_CRON, jobsForCron } = await import('../worker/scheduledJobs');
    expect(jobsForCron(DAILY_CRON)).toContain('payment_support_sweep');
    expect(ALL_SCHEDULED_JOBS).toContain('payment_support_sweep');
    const source = readFileSync(resolve(__dirname, '..', 'worker', 'index.ts'), 'utf8');
    expect(source).toMatch(/jobs\.includes\('payment_support_sweep'\)/);
    expect(source).toContain('runPaymentSupportSweep(env)');
  });
});

describe('each change is one conditional update', () => {
  it('a window that has run out cannot be written into, even before the sweep has removed it', async () => {
    const { env, db } = makeEnv();
    const opened = await openSupportWindow(env, { payerTgId: BUYER, accountId: String(BUYER), chargeId: null }, 1_000_000);
    expect(opened.ok).toBe(true);
    expect(await takeSupportMessage(env, BUYER, 'too late', 1_000_000 + SUPPORT_WINDOW_MS)).toEqual({ kind: 'none' });
    expect(rows(db)[0]).toMatchObject({ status: 'awaiting', message: null });

    const inTime = await takeSupportMessage(env, BUYER, 'in time', 1_000_000 + SUPPORT_WINDOW_MS - 1);
    expect(inTime.kind).toBe('opened');
    expect(rows(db)[0]).toMatchObject({ status: 'open', message: 'in time' });
  });

  it("another payer's window is never written into", async () => {
    const { env, db } = makeEnv();
    await openSupportWindow(env, { payerTgId: BUYER, accountId: String(BUYER), chargeId: null });
    expect(await takeSupportMessage(env, STRANGER, 'not mine')).toEqual({ kind: 'none' });
    expect(rows(db)[0]).toMatchObject({ payer_tg_id: BUYER, status: 'awaiting', message: null });
  });

  it('an empty message is not a request', async () => {
    const { env, db } = makeEnv();
    await openSupportWindow(env, { payerTgId: BUYER, accountId: String(BUYER), chargeId: null });
    expect(await takeSupportMessage(env, BUYER, '   ')).toEqual({ kind: 'none' });
    expect(rows(db)[0].status).toBe('awaiting');
  });

  it('the lookup made for every chat message uses an index, not a scan of the table', () => {
    const db = createSqliteD1();
    const plan = db.sqlite
      .prepare(
        `EXPLAIN QUERY PLAN SELECT id FROM payment_support_requests
         WHERE payer_tg_id = ? AND status IN ('awaiting','open','answered') AND expires_at > ?
         ORDER BY updated_at DESC, id DESC LIMIT 1`,
      )
      .all(BUYER, 0)
      .map((step: { detail: string }) => step.detail)
      .join(' | ');
    expect(plan).toContain('idx_payment_support_payer');
    expect(plan).not.toMatch(/SCAN payment_support_requests(?! USING)/);
  });

  it('the table refuses a request without a message, whatever the code does', () => {
    const db = createSqliteD1();
    expect(() =>
      db.sqlite.prepare("INSERT INTO payment_support_requests (id, payer_tg_id, status, created_at, updated_at) VALUES ('ps_x', 1, 'open', 1, 1)").run(),
    ).toThrow();
    expect(() =>
      db.sqlite
        .prepare("INSERT INTO payment_support_requests (id, payer_tg_id, message, status, created_at, updated_at) VALUES ('ps_y', 1, ?, 'open', 1, 1)")
        .run('x'.repeat(SUPPORT_MESSAGE_MAX + 1)),
    ).toThrow();
  });
});

describe('the account behind a request', () => {
  it('a request follows the account that survives a link', async () => {
    const { env, kv, db } = makeEnv();
    const id = await openRequest(env, db);
    // The web account holds the paid plan, so it is the one that survives.
    await kv.put('sub:fb:uid-1', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + 86400_000 }));
    const linked = await linkTelegramAndFirebase(env, String(BUYER), 'uid-1');
    expect(linked.accountId).toBe('fb:uid-1');
    expect(rows(db)[0]).toMatchObject({ id, account_id: 'fb:uid-1', payer_tg_id: BUYER });
  });

  it('deleting an account fails loudly when its requests cannot be deleted, instead of reporting it deleted', async () => {
    const { env, db } = makeEnv();
    await openRequest(env, db);
    env.DB = faultyDb(db, (sql) => (/DELETE FROM payment_support_requests WHERE account_id/.test(sql) ? 'D1_ERROR: Network connection lost.' : false));
    const user = { id: String(BUYER), accountId: String(BUYER), source: 'telegram' } as HostedIdentity;
    const res = await createPrivacyJob(env, user, 'delete');
    expect(res.status).toBe(500);
    expect(rows(db)).toHaveLength(1);
  });

  it('the export does not carry the Telegram id of whoever wrote in', async () => {
    const { env, kv, db } = makeEnv();
    await openRequest(env, db);
    const user = { id: String(BUYER), accountId: String(BUYER), source: 'telegram' } as HostedIdentity;
    const exported = await createPrivacyJob(env, user, 'export');
    const { jobId } = (await exported.json()) as { jobId: string };
    const body = JSON.parse((await kv.get(`privacy:export:${jobId}`)) as string);
    expect(Object.keys(body.paymentSupportRequests[0]).sort()).toEqual(['charge_id', 'created_at', 'id', 'message', 'status', 'updated_at']);
  });
});

describe('the release checks know the table', () => {
  it('the smoke check lists the migration and the table', () => {
    const source = readFileSync(resolve(__dirname, '..', 'scripts', 'smoke-check.mjs'), 'utf8');
    expect(source).toContain("'migrations/0026_payment_support.sql'");
    expect(source).toContain("'payment_support_requests'");
  });
});
