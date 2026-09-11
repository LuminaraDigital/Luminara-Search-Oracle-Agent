import { describe, expect, it } from 'vitest';
import { toUserFacingText } from '../utils/userFacingText';

describe('toUserFacingText', () => {
  it('passes strings through', () => {
    expect(toUserFacingText('hello')).toBe('hello');
  });

  it('uses fallback for nullish / empty', () => {
    expect(toUserFacingText(null, 'fallback')).toBe('fallback');
    expect(toUserFacingText(undefined, 'fallback')).toBe('fallback');
    expect(toUserFacingText('', 'fallback')).toBe('fallback');
  });

  it('unwraps Error.message', () => {
    expect(toUserFacingText(new Error('boom'), 'x')).toBe('boom');
  });

  it('coerces the React #31 shape { message, code, metadata }', () => {
    const err = {
      message: 'NVIDIA NIM requires a paid plan',
      code: 'TIER_UPGRADE_REQUIRED',
      metadata: { provider: 'nim' },
    };
    expect(toUserFacingText(err)).toBe('NVIDIA NIM requires a paid plan (TIER_UPGRADE_REQUIRED)');
  });

  it('unwraps nested OpenAI-style { error: { message, code, metadata } }', () => {
    const body = {
      error: {
        message: 'Insufficient quota',
        code: 'insufficient_quota',
        metadata: {},
      },
    };
    expect(toUserFacingText(body)).toBe('Insufficient quota (insufficient_quota)');
  });

  it('never returns a non-string (safe for React children)', () => {
    const samples: unknown[] = [
      { message: { message: 'deep', code: 'x', metadata: {} }, code: 'y', metadata: {} },
      { foo: 1 },
      42,
      true,
      Symbol('s'),
    ];
    for (const sample of samples) {
      const out = toUserFacingText(sample, 'fallback');
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });
});
