/**
 * Zero-Leak Secret Redactor
 * Adapted from OpenMausBot (shared/redact.ts, server/redact.ts, Apache 2.0).
 *
 * Keeps secrets out of text and structured data across trust boundaries:
 * native protocol logs, tool titles, activity chips, audit exports, and D1 sync.
 * Retains structural shape and character count while eliminating raw secret values.
 * No em dashes in copy.
 */

const REDACTION_MARKER = /^«redacted \d+ chars»$/;

export const maskSecret = (value: string): string =>
  REDACTION_MARKER.test(value) ? value : `«redacted ${value.length} chars»`;

const SECRET_KEY_PARTS = [
  'token',
  'secret',
  'password',
  'passwd',
  'apikey',
  'api_key',
  'authorization',
  'auth_token',
  'private_key',
];

export function isSecretFieldName(name: string): boolean {
  const normalized = name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  if (SECRET_KEY_PARTS.some((part) => normalized.includes(part))) return true;
  return /(^|[_.-])keys?$/.test(normalized);
}

const KEY_PREFIXES: RegExp[] = [
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, // anthropic / openai / stripe
  /\bxai-[A-Za-z0-9_-]{16,}/g, // xai (grok)
  /\bgsk_[A-Za-z0-9_-]{20,}/g, // groq
  /\bnvapi-[A-Za-z0-9_-]{16,}/g, // nvidia nim
  /\btvly-[A-Za-z0-9_-]{16,}/g, // tavily
  /\bfc-[A-Za-z0-9_-]{16,}/g, // firecrawl
  /\bcsk-[A-Za-z0-9]{24,}/g, // cerebras
  /\bhf_[A-Za-z0-9]{20,}/g, // hugging face
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, // github classic
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // github fine-grained
  /\bxox[abposr]-[A-Za-z0-9-]{20,}/g, // slack
  /\bAKIA[0-9A-Z]{16}\b/g, // aws access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g, // google api key
  /\bnpm_[A-Za-z0-9]{20,}/g, // npm
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // jwt
];

const BEARER = /(\bBearer\s+)([A-Za-z0-9._~+/=-]{12,})/gi;
const PEM_BLOCK = /(-----BEGIN [A-Z ]*PRIVATE KEY-----)([\s\S]*?)(-----END [A-Z ]*PRIVATE KEY-----)/g;

const KEY_VALUE =
  /\b((?:[A-Za-z0-9_-]*_)?(?:api[_-]?key|apikey|secret|token|password|passwd|authorization|auth[_-]?token|access[_-]?key|private[_-]?key)s?)(["']?\s*[=:]\s*)(["']?)([A-Za-z0-9._~+/=-]{8,})\3/gi;

const KEY_SUFFIX_ASSIGNMENT =
  /\b([A-Za-z][A-Za-z0-9_-]*[_-]key)s?(=)(["']?)([A-Za-z0-9._~+/=-]+)\3/gi;

const SECRET_FLAG =
  /(--(?:token|password|passwd|api-key|apikey|secret|access-key|auth-token)(?:=|\s+))(["']?)(?!-)([A-Za-z0-9._~+/=-]+)\2/gi;

const URL_USERINFO =
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:)([^\s/@'"«»]+)(@)/gi;

/**
 * Redact secret tokens, keys, passwords, and authorization headers within raw text.
 */
export function redactSecretsInText(text: string): string {
  if (!text || text.length < 8) return text;
  let out = text;
  out = out.replace(
    PEM_BLOCK,
    (_m, open: string, body: string, close: string) =>
      `${open}\n${maskSecret(body.trim())}\n${close}`
  );
  for (const re of KEY_PREFIXES) {
    out = out.replace(re, (m) => maskSecret(m));
  }
  out = out.replace(
    BEARER,
    (_m, lead: string, tok: string) => `${lead}${maskSecret(tok)}`
  );
  out = out.replace(
    KEY_VALUE,
    (_m, key: string, sep: string, quote: string, value: string) =>
      `${key}${sep}${quote}${maskSecret(value)}${quote}`
  );
  out = out.replace(
    KEY_SUFFIX_ASSIGNMENT,
    (_m, key: string, sep: string, quote: string, value: string) =>
      `${key}${sep}${quote}${maskSecret(value)}${quote}`
  );
  out = out.replace(
    SECRET_FLAG,
    (_m, flag: string, quote: string, value: string) =>
      `${flag}${quote}${maskSecret(value)}${quote}`
  );
  out = out.replace(
    URL_USERINFO,
    (_m, lead: string, secret: string, at: string) =>
      `${lead}${maskSecret(secret)}${at}`
  );
  return out;
}

/**
 * Deeply scrub secrets from arbitrary structured objects, arrays, and primitives.
 */
export function redactSecrets<T>(input: T, depth = 0): T {
  if (typeof input === 'string') {
    return redactSecretsInText(input) as unknown as T;
  }
  if (depth > 12 || input === null || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => {
      if (
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof (item as { name?: unknown }).name === 'string' &&
        typeof (item as { value?: unknown }).value === 'string'
      ) {
        const entry = item as { name: string; value: string };
        return isSecretFieldName(entry.name)
          ? { ...entry, value: maskSecret(entry.value) }
          : { ...entry, value: redactSecretsInText(entry.value) };
      }
      return redactSecrets(item, depth + 1);
    }) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && isSecretFieldName(key)) {
      out[key] = maskSecret(value);
      continue;
    }
    out[key] = redactSecrets(value, depth + 1);
  }
  return out as T;
}
