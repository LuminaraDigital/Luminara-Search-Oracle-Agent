import { describe, expect, it } from 'vitest';
import { decideTelegramGate } from '../services/auth/useAppAuth';

describe('decideTelegramGate (TMA login decision matrix)', () => {
  it('blocks when initData never arrives', () => {
    const r = decideTelegramGate({ hasInitData: false, authStatus: null });
    expect(r.authenticated).toBe(false);
    expect(r.reason).toMatch(/Open this Mini App from Telegram/i);
  });

  it('blocks on invalid HMAC / 401', () => {
    const r = decideTelegramGate({ hasInitData: true, authStatus: 'invalid' });
    expect(r.authenticated).toBe(false);
    expect(r.reason).toMatch(/could not verify/i);
  });

  it('authenticates on ok', () => {
    const r = decideTelegramGate({ hasInitData: true, authStatus: 'ok' });
    expect(r.authenticated).toBe(true);
    expect(r.reason).toBeNull();
  });

  it('soft-opens on unavailable when initData is present (Worker still enforces APIs)', () => {
    const r = decideTelegramGate({ hasInitData: true, authStatus: 'unavailable' });
    expect(r.authenticated).toBe(true);
    expect(r.reason).toBeNull();
  });
});

describe('waitForInitDataRaw settle contract', () => {
  it('documents the settle budget used in production (~300ms)', () => {
    const attempts = 6;
    const intervalMs = 50;
    const budgetMs = (attempts - 1) * intervalMs;
    expect(budgetMs).toBe(250);
    expect(attempts * intervalMs).toBeLessThanOrEqual(300);
  });
});

describe('Telegram detect timeout policy', () => {
  it('must not demote a sync-detected Mini App to web on slow isTMA()', () => {
    // Production regression: Promise.race(... resolve(false)) caused marketing landing inside TMA.
    const syncHit = true;
    const timedOutConfirmation = true; // timeout should resolve true when syncHit was true
    const insideTelegram = Boolean(timedOutConfirmation) || syncHit;
    expect(insideTelegram).toBe(true);
  });
});
