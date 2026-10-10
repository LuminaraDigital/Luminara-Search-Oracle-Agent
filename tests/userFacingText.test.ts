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

  it('strips raw JSON and returns sanitized message', () => {
    const rawJson = '{"error":{"message":"Request too large for model","type":"invalid_request_error"}}';
    const text = toUserFacingText(rawJson);
    expect(text).not.toContain('{"error"');
    expect(text).toContain('too long for the engine');
  });

  it('sanitizes Groq inference errors without mentioning Groq or raw JSON', () => {
    const groq402 = 'Groq inference error (402): {"error":{"message":"Payment Required"}}';
    const text402 = toUserFacingText(groq402);
    expect(text402).not.toContain('Groq');
    expect(text402).not.toContain('402');
    expect(text402).toContain('credit limits');

    const groq413 = 'Groq inference error (413): {"error":{"message":"Rate limit reached for model on tokens per minute (TPM): Limit 8000, Used 8693"}}';
    const text413 = toUserFacingText(groq413);
    expect(text413).not.toContain('Groq');
    expect(text413).not.toContain('8693');
    expect(text413).toContain('too long for the engine');
  });

  it('sanitizes FreeLLMAPI strings', () => {
    const freeLlm = 'FreeLLMAPI error: native inference providers failed';
    const text = toUserFacingText(freeLlm);
    expect(text).not.toContain('FreeLLMAPI');
    expect(text).toContain('busy or unavailable');
  });

  it('formats AI_UNAVAILABLE as zero-charge friendly message', () => {
    const err = { error: { code: 'AI_UNAVAILABLE', message: 'Luminara could not answer right now. Nothing was charged. Try again in a minute.' } };
    expect(toUserFacingText(err)).toBe('Luminara could not answer right now. Nothing was charged. Try again in a minute.');
  });
});

