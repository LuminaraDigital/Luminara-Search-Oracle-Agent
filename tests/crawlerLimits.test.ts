import { describe, expect, it } from 'vitest';
// The crawler ships as plain ESM with no build step; the limiter uses no dependencies.
// @ts-expect-error untyped .mjs module
import { createRateLimiter, createSemaphore, parseAllowedOrigins, parsePositiveInt, resolveClientIp, resolveCorsOrigin } from '../crawler/limits.mjs';

describe('crawler CORS allowlist', () => {
  it('echoes only exact allowlisted origins', () => {
    const allowed = parseAllowedOrigins(' http://localhost:3000 , https://luminarasuite.com/ ,');
    expect(allowed.size).toBe(2);
    expect(resolveCorsOrigin('http://localhost:3000', allowed)).toBe('http://localhost:3000');
    expect(resolveCorsOrigin('https://luminarasuite.com', allowed)).toBe('https://luminarasuite.com');
    for (const miss of ['http://localhost:3001', 'https://evil.luminarasuite.com', 'https://luminarasuite.com.evil.com', 'HTTP://LOCALHOST:3000', 'null', '', undefined]) {
      expect(resolveCorsOrigin(miss, allowed), String(miss)).toBeNull();
    }
  });

  it('denies every origin by default and does not honour a wildcard', () => {
    expect(parseAllowedOrigins(undefined).size).toBe(0);
    expect(resolveCorsOrigin('http://localhost:3000', parseAllowedOrigins(undefined))).toBeNull();
    expect(resolveCorsOrigin('http://localhost:3000', parseAllowedOrigins(''))).toBeNull();
    expect(resolveCorsOrigin('https://evil.example', parseAllowedOrigins('*'))).toBeNull();
  });
});

describe('crawler env integer parsing', () => {
  it('falls back on junk and clamps to bounds', () => {
    expect(parsePositiveInt('3', 2, 1, 32)).toBe(3);
    expect(parsePositiveInt(' 4 ', 2, 1, 32)).toBe(4);
    expect(parsePositiveInt('0', 2, 1, 32)).toBe(1);
    expect(parsePositiveInt('999', 2, 1, 32)).toBe(32);
    for (const junk of [undefined, '', '-1', '1.5', '1e3', 'abc', 'NaN']) {
      expect(parsePositiveInt(junk, 2, 1, 32), String(junk)).toBe(2);
    }
  });
});

describe('crawler browser-session semaphore', () => {
  it('rejects when saturated and frees a slot once per release function', () => {
    const sem = createSemaphore(2);
    const a = sem.tryAcquire();
    const b = sem.tryAcquire();
    expect(a).toBeTypeOf('function');
    expect(b).toBeTypeOf('function');
    expect(sem.tryAcquire()).toBeNull();

    a();
    a();
    expect(sem.active).toBe(1);
    const c = sem.tryAcquire();
    expect(c).toBeTypeOf('function');
    expect(sem.tryAcquire()).toBeNull();

    b();
    c();
    expect(sem.active).toBe(0);
  });

  it('frees the slot when guarded work throws', async () => {
    const sem = createSemaphore(1);
    const guarded = async () => {
      const release = sem.tryAcquire();
      if (!release) throw new Error('busy');
      try {
        throw new Error('boom');
      } finally {
        release();
      }
    };
    await expect(guarded()).rejects.toThrow('boom');
    await expect(guarded()).rejects.toThrow('boom');
    expect(sem.active).toBe(0);
  });

  it('treats an invalid maximum as 1', () => {
    expect(createSemaphore(0).max).toBe(1);
    expect(createSemaphore(Number.NaN).max).toBe(1);
  });
});

describe('crawler per-IP rate limiter', () => {
  it('blocks past the limit within a window and resets after it', () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    for (let i = 0; i < 3; i++) expect(rl.hit('203.0.113.1').allowed).toBe(true);

    const blocked = rl.hit('203.0.113.1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
    expect(rl.hit('203.0.113.2').allowed).toBe(true);

    t += 59_000;
    const stillBlocked = rl.hit('203.0.113.1');
    expect(stillBlocked.allowed).toBe(false);
    expect(stillBlocked.retryAfterSec).toBe(1);

    t += 1_000;
    const reset = rl.hit('203.0.113.1');
    expect(reset.allowed).toBe(true);
    expect(reset.remaining).toBe(2);
  });

  it('prunes expired buckets', () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 5, windowMs: 1_000, now: () => t });
    for (let i = 0; i < 100; i++) rl.hit(`198.51.100.${i}`);
    expect(rl.size).toBe(100);

    t += 1_000;
    rl.hit('192.0.2.1');
    expect(rl.size).toBe(1);
  });

  it('caps bucket count by evicting the oldest keys', () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000, maxBuckets: 10, now: () => 0 });
    for (let i = 0; i < 50; i++) rl.hit(`k${i}`);
    expect(rl.size).toBe(10);
    expect(rl.hit('k49').remaining).toBe(3);
    expect(rl.hit('k0').remaining).toBe(4);
  });
});

describe('crawler client IP resolution', () => {
  it('uses the socket address unless a proxy is explicitly trusted', () => {
    expect(resolveClientIp('::ffff:203.0.113.9', '6.6.6.6', false)).toBe('203.0.113.9');
    expect(resolveClientIp('10.0.0.2', '6.6.6.6, 198.51.100.7', true)).toBe('198.51.100.7');
    expect(resolveClientIp('10.0.0.2', undefined, true)).toBe('10.0.0.2');
    expect(resolveClientIp(undefined, undefined, false)).toBe('unknown');
  });
});
