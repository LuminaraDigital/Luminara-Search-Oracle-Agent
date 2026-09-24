import { describe, expect, it, vi } from 'vitest';
import { redactSensitive, redactForAudit, safeLog } from '../worker/logRedaction';
import { recordAuditLog } from '../worker/auditLog';
import { createSqliteD1 } from './helpers/sqliteD1';

const JWT_SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';
const LICENSE_SAMPLE = 'LUM-GROWTH-30D-AB12-CD34';

describe('redactSensitive: passthrough and structure', () => {
  it('returns null, undefined, and empty string as-is', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
    expect(redactSensitive('')).toBe('');
    expect(redactSensitive(0)).toBe(0);
    expect(redactSensitive(false)).toBe(false);
  });

  it('redacts sensitive keys case-insensitively in nested objects', () => {
    const out = redactSensitive({
      Password: 'hunter2xyz',
      nested: { API_KEY: 'k-12345678', ApiKey: 'k-87654321' },
      list: [{ Secret: 's-abcdefgh' }],
    }) as Record<string, unknown>;
    expect(out.Password).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).API_KEY).toBe('[redacted]');
    expect((out.nested as Record<string, unknown>).ApiKey).toBe('[redacted]');
    expect(((out.list as unknown[])[0] as Record<string, unknown>).Secret).toBe('[redacted]');
  });

  it('matches delimiter-suffix keys like x_api_key but never substrings like tokenizer or authority', () => {
    const out = redactSensitive({
      x_api_key: 'abc12345',
      tokenizer: 'not-secret',
      authority: 'not-secret',
      authored: 'not-secret',
      session_data: 'sess-123456',
    }) as Record<string, unknown>;
    expect(out.x_api_key).toBe('[redacted]');
    expect(out.session_data).toBe('sess-123456');
    expect(out.tokenizer).toBe('not-secret');
    expect(out.authority).toBe('not-secret');
    expect(out.authored).toBe('not-secret');
  });

  it('covers the full built-in key list', () => {
    const payload = {
      password: 1, secret: 1, token: 1, api_key: 1, apikey: 1,
      authorization: 1, auth: 1, private_key: 1, license_key: 1, license: 1,
      card: 1, cvc: 1, otp: 1, session: 1, cookie: 1, jwt: 1, bearer: 1,
      keep_me: 'visible',
    };
    const out = redactSensitive(payload) as Record<string, unknown>;
    for (const k of Object.keys(payload)) {
      if (k === 'keep_me') {
        expect(out[k]).toBe('visible');
      } else {
        expect(out[k]).toBe('[redacted]');
      }
    }
  });

  it('honors extraKeys on top of the built-in list', () => {
    const out = redactSensitive(
      { vault_code: 'v-12345678', other: 'fine' },
      { extraKeys: ['vaultCode'] },
    ) as Record<string, unknown>;
    expect(out.vault_code).toBe('[redacted]');
    expect(out.other).toBe('fine');
  });

  it('truncates nodes deeper than maxDepth (default 8)', () => {
    interface N { next?: N; value?: string }
    const deep: N = { value: 'root' };
    let node = deep;
    for (let i = 0; i < 12; i++) {
      node.next = { value: `d${i}` };
      node = node.next;
    }
    const out = redactSensitive(deep) as Record<string, unknown>;
    let cursor: unknown = out;
    let truncatedSeen = false;
    for (let i = 0; i < 20; i++) {
      if (cursor === '[truncated]') { truncatedSeen = true; break; }
      if (cursor && typeof cursor === 'object') cursor = (cursor as Record<string, unknown>).next;
      else break;
    }
    expect(truncatedSeen).toBe(true);
  });

  it('respects a custom maxDepth', () => {
    const out = redactSensitive({ a: { b: { c: { d: 'too deep' } } } }, { maxDepth: 3 }) as Record<string, unknown>;
    expect(JSON.stringify(out)).toContain('[truncated]');
  });

  it('replaces circular references with [circular]', () => {
    interface C { name: string; self?: C }
    const a: C = { name: 'a' };
    a.self = a;
    const out = redactSensitive(a) as Record<string, unknown>;
    expect(out.self).toBe('[circular]');
  });

  it('never mutates the input object', () => {
    const input = { password: 'hunter2xyz', nested: { token: 't-12345678' } };
    const snapshot = JSON.parse(JSON.stringify(input));
    redactSensitive(input);
    expect(input).toEqual(snapshot);
  });

  it('passes non-plain objects through by reference without enumerating them', () => {
    class SecretBox { password = 'hunter2xyz' }
    const box = new SecretBox();
    const out = redactSensitive({ box, fn: () => 1 }) as { box: SecretBox };
    expect(out.box).toBe(box);
    expect(out.box.password).toBe('hunter2xyz');
  });

  it('redacts inside arrays that are values of plain objects and arrays of arrays', () => {
    const out = redactSensitive([{ secret: 'x-12345678' }, [{ jwt: 'y-87654321' }]]) as unknown[];
    expect((out[0] as Record<string, unknown>).secret).toBe('[redacted]');
    expect(((out[1] as unknown[])[0] as Record<string, unknown>).jwt).toBe('[redacted]');
  });
});

describe('redactSensitive: value-pattern redaction in strings', () => {
  it('masks Bearer tokens but keeps the Bearer prefix', () => {
    const out = redactSensitive({ message: 'call with Bearer abcdef1234567890TOKEN' }) as Record<string, unknown>;
    expect(out.message).toMatch(/^call with Bearer \*+$/);
    expect(out.message).not.toContain('abcdef1234567890TOKEN');
  });

  it('redacts JWTs (3 base64url dotted segments, each >= 10 chars)', () => {
    const out = redactSensitive({ log: `got token ${JWT_SAMPLE} ok` }) as Record<string, unknown>;
    expect(out.log).toBe('got token [redacted] ok');
  });

  it('redacts Luminara license key shapes anywhere in a string', () => {
    const out = redactSensitive({ note: `redeemed ${LICENSE_SAMPLE} today` }) as Record<string, unknown>;
    expect(out.note).toBe('redeemed [redacted] today');
  });

  it('redacts generic hex/alnum tokens >= 32 chars preceded by a key/license label', () => {
    const hex = 'a'.repeat(40);
    const out = redactSensitive({ text: `license: ${hex}` }) as Record<string, unknown>;
    expect(out.text).toBe('license: [redacted]');
  });

  it('never pattern-redacts strings shorter than 8 chars as bare secrets', () => {
    const out = redactSensitive({ note: 'short ok', path: '/tmp/ok' }) as Record<string, unknown>;
    expect(out.note).toBe('short ok');
    expect(out.path).toBe('/tmp/ok');
  });

  it('redacts provided secretValues (length >= 8) inside any string', () => {
    const secret = 'SUPER_SECRET_VALUE_99';
    const out = redactSensitive(
      { line: `db failed with ${secret} at handoff`, other: 'clean' },
      { secretValues: [secret] },
    ) as Record<string, unknown>;
    expect(out.line).toBe('db failed with [redacted] at handoff');
    expect(out.other).toBe('clean');
  });
});

describe('redactSensitive: username and home-path masking', () => {
  it('masks username/user/home/userHome keys to first char + ***', () => {
    const out = redactSensitive({
      username: 'luminous',
      user: 'luminous',
      home: 'luminous',
      userHome: 'luminous',
    }) as Record<string, unknown>;
    expect(out.username).toBe('l***');
    expect(out.user).toBe('l***');
    expect(out.home).toBe('l***');
    expect(out.userHome).toBe('l***');
  });

  it('masks names inside Windows and posix home paths in strings', () => {
    const out = redactSensitive({
      win: 'file at C:\\Users\\operator\\Desktop',
      posix: 'file at /home/operator/work',
      mac: 'file at /Users/operator/work',
    }) as Record<string, unknown>;
    expect(out.win).toBe('file at C:\\Users\\o***\\Desktop');
    expect(out.posix).toBe('file at /home/o***/work');
    expect(out.mac).toBe('file at /Users/o***/work');
  });
});

describe('safeLog', () => {
  it('logs a single redacted JSON line via console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      safeLog('test.event', { password: 'hunter2xyz', note: 'ok' });
      expect(spy).toHaveBeenCalledTimes(1);
      const line = spy.mock.calls[0][0] as string;
      expect(line).toContain('test.event');
      expect(line).toContain('[redacted]');
      expect(line).not.toContain('hunter2xyz');
      expect(() => JSON.parse(line.slice(line.indexOf('{')))).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('handles missing data', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      safeLog('bare.event');
      expect(spy.mock.calls[0][0]).toContain('null');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('audit log integration (persisted rows are redacted)', () => {
  it('recordAuditLog persists [redacted] for a seeded secret in details', async () => {
    const db = createSqliteD1();
    const env = { DB: db } as never;
    const SEEDED_SECRET = 'persistence-seeded-secret-001';

    await recordAuditLog(env, {
      org_id: 'org_redact_test',
      actor_id: 'actor_1',
      action: 'redaction.test',
      details: {
        password: SEEDED_SECRET,
        note: `operator used ${JWT_SAMPLE}`,
        ok_field: 'visible',
      },
    });

    const rows = await db.prepare(
      `SELECT details FROM org_audit_logs WHERE org_id = ?`,
    ).bind('org_redact_test').all();
    expect(rows.results.length).toBe(1);
    const details = (rows.results[0] as { details: string }).details;
    expect(details).toContain('[redacted]');
    expect(details).not.toContain(SEEDED_SECRET);
    expect(details).not.toContain(JWT_SAMPLE);
    const parsed = JSON.parse(details) as Record<string, unknown>;
    expect(parsed.password).toBe('[redacted]');
    expect(parsed.note).toBe('operator used [redacted]');
    expect(parsed.ok_field).toBe('visible');
  });

  it('redactForAudit redacts string payloads too', () => {
    const out = redactForAudit(`token ${JWT_SAMPLE}`) as string;
    expect(out).toBe('token [redacted]');
  });
});
