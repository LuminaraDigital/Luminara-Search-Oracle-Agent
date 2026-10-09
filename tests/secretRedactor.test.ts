import { describe, it, expect } from 'vitest';
import {
  redactSecretsInText,
  redactSecrets,
  isSecretFieldName,
  maskSecret,
} from '../services/security/secretRedactor';

describe('secretRedactor', () => {
  it('identifies secret field names accurately without false positives', () => {
    expect(isSecretFieldName('apiKey')).toBe(true);
    expect(isSecretFieldName('ANTHROPIC_API_KEY')).toBe(true);
    expect(isSecretFieldName('db_password')).toBe(true);
    expect(isSecretFieldName('auth_token')).toBe(true);
    expect(isSecretFieldName('xai_key')).toBe(true);
    expect(isSecretFieldName('keyboard')).toBe(false);
    expect(isSecretFieldName('hotkey')).toBe(false);
  });

  it('masks secret text while preserving length indicator', () => {
    const raw = 'gsk_dummy_sample_test_key_1234567890';
    const masked = maskSecret(raw);
    expect(masked).toBe(`«redacted ${raw.length} chars»`);
    // Idempotent: repeated mask does not alter the string
    expect(maskSecret(masked)).toBe(masked);
  });

  it('redacts various API key formats within text', () => {
    const groqKey = 'gsk_dummy_sample_test_key_1234567890';
    const openaiKey = 'sk-proj-dummy_sample_test_key_123456';
    const geminiKey = 'AIzaSyDummy_Sample_Test_Key_1234567890';
    const tavilyKey = 'tvly-dummy_sample_test_key_123456';

    const input = `Keys: Groq=${groqKey}, OpenAI=${openaiKey}, Gemini=${geminiKey}, Tavily=${tavilyKey}`;
    const scrubbed = redactSecretsInText(input);

    expect(scrubbed).not.toContain(groqKey);
    expect(scrubbed).not.toContain(openaiKey);
    expect(scrubbed).not.toContain(geminiKey);
    expect(scrubbed).not.toContain(tavilyKey);
    expect(scrubbed).toContain('«redacted');
  });

  it('redacts bearer tokens, key assignments, and userinfo in URLs', () => {
    const text =
      'Call with Bearer secret-auth-token-123456 and url https://admin:supersecret@example.com/api?apiKey=mysecrettoken123';
    const scrubbed = redactSecretsInText(text);

    expect(scrubbed).not.toContain('secret-auth-token-123456');
    expect(scrubbed).not.toContain('supersecret');
    expect(scrubbed).not.toContain('mysecrettoken123');
  });

  it('deep scrubs structured objects and arrays without corrupting non-secret fields', () => {
    const payload = {
      user: 'oracle-admin',
      config: {
        tavilyKey: 'tvly-dummy_sample_test_key_123456',
        auditCount: 42,
      },
      headers: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Authorization', value: 'Bearer token-123456789012' },
      ],
      command: 'curl -H "x-api-key: secretkey987654321" https://api.luminara.ai',
    };

    const cleaned = redactSecrets(payload);
    expect(cleaned.user).toBe('oracle-admin');
    expect(cleaned.config.auditCount).toBe(42);
    expect(cleaned.config.tavilyKey).toMatch(/«redacted \d+ chars»/);
    expect(cleaned.headers[0].value).toBe('application/json');
    expect(cleaned.headers[1].value).toMatch(/«redacted \d+ chars»/);
    expect(cleaned.command).not.toContain('secretkey987654321');
  });
});
