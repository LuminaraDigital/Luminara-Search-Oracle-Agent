/**
 * Telegram chat gets the same account-memory recall as the Oracle chat, only with
 * MEMORY_RECALL_V2 on. No model or Telegram API is called: fetch is mocked and the
 * database is SQLite with the real migrations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleTelegramUpdate } from '../worker/telegramBot';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/index';

class MockKV {
  private store = new Map<string, string>();
  async get(key: string, type?: string) {
    const val = this.store.get(key);
    if (!val) return null;
    return type === 'json' ? JSON.parse(val) : val;
  }
  async put(key: string, value: string) {
    this.store.set(key, value);
  }
  async delete(key: string) {
    this.store.delete(key);
  }
}

const FROM_ID = 100;

function makeEnv(flags: Partial<Env> = {}) {
  const db = createSqliteD1();
  db.sqlite
    .prepare(`INSERT INTO memory_facts (id, account_id, text, kind, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('f1', String(FROM_ID), 'Our bakery serves Leeds. I get 1,200 visits a month.', 'profile', 1);
  db.sqlite
    .prepare(`INSERT INTO memory_facts (id, account_id, text, kind, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('f2', 'someone_else', 'Their bakery serves Paris', 'profile', 2);
  const env: Env = {
    ASSETS: {} as any,
    BOT_TOKEN: '123456:MOCK_TOKEN',
    WEBAPP_URL: 'https://luminarasuite.com',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    TELEGRAM_ADMIN_ID: '999999',
    LUMINARA_KV: new MockKV() as any,
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    FREE_DAILY_LIMIT: '50',
    GROQ_API_KEY: 'gsk_mock_key',
    DB: db as any,
    ...flags,
  };
  return env;
}

async function send(env: Env, text: string, modelReply: string) {
  let systemPrompt = '';
  const sends: Array<Record<string, any>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      if (url.startsWith('https://api.groq.com/')) {
        systemPrompt = JSON.parse(init.body).messages[0].content;
        return { ok: true, json: async () => ({ choices: [{ message: { content: modelReply } }] }) };
      }
      if (url.startsWith('https://api.telegram.org/')) {
        if (url.endsWith('/sendMessage')) sends.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ ok: true, result: {} }) };
      }
      return { ok: false, status: 503, json: async () => ({}) };
    }),
  );
  await handleTelegramUpdate({ message: { chat: { id: FROM_ID }, from: { id: FROM_ID }, text } }, env);
  return { systemPrompt, sends };
}

describe('Telegram memory recall', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('flag off: the prompt has no account memory', async () => {
    const { systemPrompt } = await send(makeEnv(), 'Where does my bakery deliver?', 'Try local landing pages.');
    expect(systemPrompt).not.toBe('');
    expect(systemPrompt).not.toContain('Account memory');
    expect(systemPrompt).not.toContain('serves Leeds');
  });

  it('flag on: this account’s fact is in the prompt, fenced, and no other account’s', async () => {
    const { systemPrompt } = await send(makeEnv({ MEMORY_RECALL_V2: 'true' }), 'Where does my bakery deliver?', 'Try local landing pages.');
    expect(systemPrompt).toContain('## Account memory (retrieved)');
    expect(systemPrompt).toContain('[profile] Our bakery serves Leeds. I get 1,200 visits a month.');
    expect(systemPrompt).toContain('UNTRUSTED_ACCOUNT_MEMORY');
    expect(systemPrompt).not.toContain('Paris');
  });

  it('flag on: a figure the user saved in memory survives the honesty filter', async () => {
    const reply = 'As you said, your traffic is 1,200 visits a month.';
    const on = await send(makeEnv({ MEMORY_RECALL_V2: 'true' }), 'Where does my bakery deliver?', reply);
    expect(on.sends.at(-1)?.text).toContain('1,200 visits');
    // Without the memory, nobody gave that figure in this chat, so the filter removes it.
    const off = await send(makeEnv(), 'Where does my bakery deliver?', reply);
    expect(off.sends.at(-1)?.text).not.toContain('1,200 visits');
  });
});
