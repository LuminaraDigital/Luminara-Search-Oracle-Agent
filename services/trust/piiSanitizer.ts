/**
 * PII & Sensitive Secret Sanitizer
 * Adapted from OmniRoute (src/lib/piiSanitizer.ts, MIT License).
 *
 * Redacts personal identifiable information (emails, phone numbers) and sensitive
 * credentials (API keys, JWTs, Bearer tokens) from scraped website DOMs and user input
 * before sending payloads to third-party LLM providers.
 */

export interface SanitizationResult {
  sanitized: string;
  redactionsCount: number;
  typesRedacted: string[];
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const API_KEY_RE = /\b(?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|nvapi-[a-zA-Z0-9_-]{20,}|gsk_[a-zA-Z0-9]{20,})\b/g;
const BEARER_TOKEN_RE = /Bearer\s+([A-Za-z0-9\-_~+/=]{15,})/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

export function sanitizePii(text: string): SanitizationResult {
  if (!text || typeof text !== 'string') {
    return { sanitized: text || '', redactionsCount: 0, typesRedacted: [] };
  }

  let working = text;
  let count = 0;
  const types = new Set<string>();

  // Redact API keys
  working = working.replace(API_KEY_RE, () => {
    count++;
    types.add('api_key');
    return '[REDACTED_API_KEY]';
  });

  // Redact Bearer tokens first
  working = working.replace(BEARER_TOKEN_RE, () => {
    count++;
    types.add('bearer_token');
    return 'Bearer [REDACTED_TOKEN]';
  });

  // Redact standalone JWTs
  working = working.replace(JWT_RE, () => {
    count++;
    types.add('jwt');
    return '[REDACTED_JWT]';
  });

  // Redact Emails
  working = working.replace(EMAIL_RE, () => {
    count++;
    types.add('email');
    return '[REDACTED_EMAIL]';
  });

  // Redact Phone numbers
  working = working.replace(PHONE_RE, () => {
    count++;
    types.add('phone');
    return '[REDACTED_PHONE]';
  });

  return {
    sanitized: working,
    redactionsCount: count,
    typesRedacted: Array.from(types),
  };
}
