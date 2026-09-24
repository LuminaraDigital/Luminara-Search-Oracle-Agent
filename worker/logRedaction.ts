/**
 * Luminara Worker Log Redaction Service (spec 0009).
 *
 * Recursively redacts sensitive values (secrets, bearer tokens, JWTs,
 * license keys, env secrets, home paths) from log payloads before they are
 * written to D1, KV, or console, so secrets never persist.
 */

export interface RedactOptions {
  extraKeys?: string[];
  maxDepth?: number;
  secretValues?: string[];
}

const REDACTED = '[redacted]';
const TRUNCATED = '[truncated]';
const CIRCULAR = '[circular]';
const DEFAULT_MAX_DEPTH = 8;
const MIN_SECRET_LEN = 8;

const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'private_key',
  'license_key',
  'license',
  'card',
  'cvc',
  'otp',
  'session',
  'cookie',
  'jwt',
  'bearer',
]);

const USERNAME_KEYS = new Set(['username', 'user', 'home', 'userhome']);

/** Normalizes a key: camelCase humps become underscores, then lowercased, only a-z0-9_ kept. */
function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Whole-key or delimiter-suffix match against the sensitive list, e.g.
 * `x_api_key` matches `api_key`, but `tokenizer` never matches `token`.
 */
function isSensitiveKey(key: string, extra: Set<string>): boolean {
  const norm = normalizeKey(key);
  if (!norm) return false;
  if (SENSITIVE_KEYS.has(norm) || extra.has(norm)) return true;
  const parts = norm.split('_');
  for (let i = 1; i < parts.length; i++) {
    // Delimiter suffixes match whole segments (e.g. x_api_key -> api_key)
    // but never truncated prefixes (e.g. tokenizer -> tor is not a segment).
    // A single 1-char prefix segment (e.g. x_... ) still allows the suffix.
    const skipped = parts.slice(0, i);
    if (skipped.length === 1 && skipped[0].length === 1) {
      // short prefix like x_ is fine
    } else if (skipped.some((p) => p.length < 4)) {
      continue;
    }
    const suffix = parts.slice(i).join('_');
    if (SENSITIVE_KEYS.has(suffix) || extra.has(suffix)) return true;
  }
  return false;
}

function isUsernameKey(key: string): boolean {
  return USERNAME_KEYS.has(normalizeKey(key).replace(/_/g, ''));
}

// Value patterns (applied inside string values only)
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
/** Luminara license key shape per worker/licenseService.ts: LUM-TIER-XXD-XXXX-XXXX */
const LICENSE_KEY_RE = /\b(?!redacted\b)LUM-[A-Z0-9]{2,}(?:-[A-Z0-9]{2,})+\b/g;
const LABELED_SECRET_RE = /\b(key|license)[\s:=]+([0-9a-zA-Z]{32,})\b/gi;
const HOME_PATH_RE = /([A-Za-z]:\\Users\\|\/home\/|\/Users\/)([^\s\\/'"]+)/g;
const HOME_PATH_KEY_RE = /([A-Za-z]:\\Users\\|\/home\/|\/Users\/)([^\s]*)/g;

function maskName(name: string): string {
  return name.length === 0 ? name : `${name[0]}***`;
}

function redactString(input: string, secretValues: string[]): string {
  let out = input;
  out = out.replace(BEARER_RE, (m) => `Bearer ${'*'.repeat(Math.max(3, m.length - 7))}`);
  out = out.replace(JWT_RE, REDACTED);
  out = out.replace(LICENSE_KEY_RE, REDACTED);
  out = out.replace(LABELED_SECRET_RE, (_m, label: string) => `${label}: ${REDACTED}`);
  out = out.replace(HOME_PATH_RE, (_m, prefix: string, name: string) => `${prefix}${maskName(name)}`);
  for (const secret of secretValues) {
    if (typeof secret === 'string' && secret.length >= MIN_SECRET_LEN) {
      out = out.split(secret).join(REDACTED);
    }
  }
  return out;
}

function maskHomePath(input: string): string {
  return input.replace(HOME_PATH_KEY_RE, (_m, prefix: string, name: string) => `${prefix}${maskName(name)}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

interface WalkCtx {
  maxDepth: number;
  extra: Set<string>;
  secretValues: string[];
  seen: Set<unknown>;
}

function walk(value: unknown, keyName: string | null, depth: number, ctx: WalkCtx): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    // Home paths under username-shaped keys mask only the name, not the whole path.
    if (keyName && isUsernameKey(keyName)) {
      return HOME_PATH_KEY_RE.test(value) ? maskHomePath(value) : maskName(value);
    }
    return redactString(value, ctx.secretValues);
  }

  if (typeof value !== 'object') return value;

  // Non-plain objects (class instances, functions-as-objects) pass through
  // by reference and are never enumerated.
  if (!Array.isArray(value) && !isPlainObject(value)) return value;

  if (ctx.seen.has(value)) return CIRCULAR;
  if (depth >= ctx.maxDepth) return TRUNCATED;

  ctx.seen.add(value);
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = new Array(value.length);
      for (let i = 0; i < value.length; i++) {
        out[i] = walk(value[i], null, depth + 1, ctx);
      }
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // Username-shaped string keys keep a masked identity instead of full
      // redaction even when the key also looks sensitive (e.g. `user`).
      if (typeof v === 'string' && isUsernameKey(k)) {
        out[k] = HOME_PATH_KEY_RE.test(v) ? maskHomePath(v) : maskName(v);
      } else if (isSensitiveKey(k, ctx.extra)) {
        out[k] = REDACTED;
      } else {
        out[k] = walk(v, k, depth + 1, ctx);
      }
    }
    return out;
  } finally {
    ctx.seen.delete(value);
  }
}

/**
 * Recursively redacts sensitive values from a log payload. Returns copies;
 * input objects are never mutated. Null/undefined pass through as-is.
 */
export function redactSensitive(value: unknown, opts?: RedactOptions): unknown {
  return walk(value, null, 0, {
    maxDepth: Math.max(1, opts?.maxDepth ?? DEFAULT_MAX_DEPTH),
    extra: new Set((opts?.extraKeys || []).map((k) => normalizeKey(k))),
    secretValues: opts?.secretValues || [],
    seen: new Set(),
  });
}

/**
 * Redaction for audit persistence payloads (details/metadata fields).
 */
export function redactForAudit(payload: unknown): unknown {
  return redactSensitive(payload);
}

/**
 * Console-safe logger: redacts the data payload, then writes a single
 * JSON.stringify line tagged with the event name.
 */
export function safeLog(event: string, data?: unknown, opts?: RedactOptions): void {
  const redacted = redactSensitive(data, opts);
  console.log(`[Luminara] ${event} ${JSON.stringify(redacted ?? null)}`);
}
