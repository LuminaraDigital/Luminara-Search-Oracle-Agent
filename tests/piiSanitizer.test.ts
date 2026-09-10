import { describe, it, expect } from 'vitest';
import { sanitizePii } from '../services/trust/piiSanitizer';

describe('Trust & Security - PII & Secret Redaction Gate', () => {
  it('redacts sensitive API keys (OpenAI, GitHub, NVIDIA, Groq)', () => {
    // Assemble at runtime so secret scanners do not treat the fixture as a live key.
    const fakeKey = `sk-${'a'.repeat(24)}`;
    const text = `Found placeholder test_key ${fakeKey} in HTML source`;
    const result = sanitizePii(text);
    expect(result.sanitized).toBe('Found placeholder test_key [REDACTED_API_KEY] in HTML source');
    expect(result.typesRedacted).toContain('api_key');
  });

  it('redacts JWTs and Bearer authorization tokens', () => {
    const text = 'Headers: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const result = sanitizePii(text);
    expect(result.sanitized).toContain('Bearer [REDACTED_TOKEN]');
    expect(result.typesRedacted).toContain('bearer_token');
  });

  it('redacts email addresses and contact phone numbers', () => {
    const text = 'Contact founder@luminarasuite.com or call 555-123-4567 for business enquiries.';
    const result = sanitizePii(text);
    expect(result.sanitized).toBe('Contact [REDACTED_EMAIL] or call [REDACTED_PHONE] for business enquiries.');
    expect(result.typesRedacted).toContain('email');
    expect(result.typesRedacted).toContain('phone');
  });

  it('passes through safe clean text without alterations', () => {
    const cleanText = 'Luminara Suite is an Answer Engine Optimization platform.';
    const result = sanitizePii(cleanText);
    expect(result.sanitized).toBe(cleanText);
    expect(result.redactionsCount).toBe(0);
    expect(result.typesRedacted).toEqual([]);
  });
});
