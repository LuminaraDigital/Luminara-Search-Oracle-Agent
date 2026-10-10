import { describe, expect, it } from 'vitest';
import { GATEWAY_NO_RECEIPT_NOTE, executeOracleGatewayTask } from '../worker/oracleGateway';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

describe('worker/oracleGateway', () => {
  it('returns 400 when targetDomain is invalid', async () => {
    const env = {} as Env;
    const res = await executeOracleGatewayTask(env, null, { targetDomain: '' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_DOMAIN');
  });

  it('returns 429 when quota check fails', async () => {
    const env = {
      REQUIRE_TG_AUTH: 'true',
    } as unknown as Env;

    const res = await executeOracleGatewayTask(env, null, { targetDomain: 'example.com' });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('QUOTA_EXHAUSTED');
  });

  it('successfully executes gateway audit task on valid domain', async () => {
    const env = {
      GROQ_API_KEY: 'gsk_mock',
      TAVILY_API_KEY: 'tvly_mock',
    } as unknown as Env;

    const res = await executeOracleGatewayTask(env, null, {
      targetDomain: 'https://example.com',
      focus: 'AEO',
      surface: 'web',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      state: string;
      targetDomain: string;
      healthScore: number | null;
      verdict: string;
      oneMoveThisWeek: string;
      evidence: {
        measurementStatus: string;
      };
      diagnostics: string[];
    };

    expect(body.ok).toBe(true);
    expect(body.state).toBe('settled');
    expect(body.targetDomain).toBe('example.com');
    expect(body.healthScore).toBeNull();
    expect(body.evidence.measurementStatus).toBe('not_measured');
    expect(body.verdict).toContain('not_measured');
    expect(body.oneMoveThisWeek).toContain('probe crawl');
    expect(body.diagnostics.length).toBeGreaterThan(0);
  });

  it('issues no Trust Receipt, and says so, even with receipts on, a signing key and a signed-in user', async () => {
    // Everything the old code needed to mint one: the flag, a valid Ed25519 key, D1 and a user.
    const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const db = createSqliteD1();

    const env = {
      GROQ_API_KEY: 'gsk_mock',
      TRUST_RECEIPTS_ENABLED: 'true',
      RECEIPT_SIGNING_KEY: JSON.stringify(jwk),
      DB: db,
    } as unknown as Env;

    const user: HostedIdentity = {
      id: 'usr_verified',
      accountId: 'acc_verified',
      source: 'telegram',
    };

    const res = await executeOracleGatewayTask(env, user, {
      targetDomain: 'luminarasuite.com',
      focus: 'GEO',
      surface: 'tma',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & { diagnostics: string[] };

    expect(body.ok).toBe(true);
    expect(body.receiptIssued).toBe(false);
    expect(body.receiptNote).toBe(GATEWAY_NO_RECEIPT_NOTE);
    expect(body).not.toHaveProperty('receiptId');
    expect(body).not.toHaveProperty('receiptSignature');
    expect(body.diagnostics.join('\n')).toContain('No Trust Receipt issued');
    expect(body.diagnostics.join('\n')).not.toContain('Minted');

    // The route checked nothing, so nothing is stored at any level.
    const { results } = await db.prepare('SELECT level FROM trust_receipts').all<{ level: string }>();
    expect(results.filter((r) => r.level === 'worker_verified')).toEqual([]);
    expect(results).toEqual([]);
  });
});
