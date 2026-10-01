#!/usr/bin/env node
/**
 * Blocks commits/pushes that contain forbidden literal tokens (local identity
 * strings, operator-listed project tokens). Luminara identity guard.
 * Used by .githooks and `npm run tokens:check`.
 *
 * Exit 0 = clean. Exit 1 = findings (or scan error).
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--staged')
  ? 'staged'
  : process.argv.includes('--all')
    ? 'all'
    : 'staged';

const TOKEN_FILE = resolve(root, '.githooks', 'forbidden-tokens.txt');
const TOKEN_FILE_POSIX = '.githooks/forbidden-tokens.txt';
const SIZE_CAP = 2 * 1024 * 1024; // 2 MB
const MIN_TOKEN_LEN = 3;

function toPosix(p) {
  return p.split(/[/\\]/).join('/');
}

function git(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
}

/** True when the current directory is inside a git work tree. */
function inGitWorkTree() {
  try {
    git('git rev-parse --is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse the committed token list. One token per line; `#` starts a comment
 * (whole-line or trailing). CRLF tolerated. Missing file = empty list.
 * Tokens shorter than MIN_TOKEN_LEN are ignored with a warning.
 */
export function parseTokenFile(text) {
  const tokens = [];
  const warnings = [];
  if (text == null) return { tokens, warnings };
  for (const raw of String(text).split(/\r?\n/)) {
    // Strip trailing comment first so "token  # note" works.
    const noComment = raw.replace(/#.*$/, '');
    const token = noComment.trim();
    if (!token) continue;
    if (token.length < MIN_TOKEN_LEN) {
      warnings.push(`ignored token shorter than ${MIN_TOKEN_LEN} chars: ${JSON.stringify(token)}`);
      continue;
    }
    tokens.push(token);
  }
  return { tokens, warnings };
}

function readTokenFile() {
  if (!existsSync(TOKEN_FILE)) return { tokens: [], warnings: [] };
  try {
    return parseTokenFile(readFileSync(TOKEN_FILE, 'utf8'));
  } catch (err) {
    return { tokens: [], warnings: [`could not read token file: ${err?.message || err}`] };
  }
}

/**
 * Resolve local identity tokens from environment and os. Every os call is
 * guarded so a failure degrades to that source simply being absent.
 */
export function resolveIdentityTokens(env = process.env, osMod = os) {
  const out = [];
  for (const key of ['USER', 'LOGNAME', 'USERNAME']) {
    const v = env?.[key];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }
  try {
    const u = osMod.userInfo()?.username;
    if (typeof u === 'string' && u.trim()) out.push(u.trim());
  } catch {
    // degrade gracefully
  }
  try {
    const h = osMod.homedir();
    if (typeof h === 'string' && h.trim()) {
      const last = basename(h.trim());
      if (last) out.push(last);
    }
  } catch {
    // degrade gracefully
  }
  return out;
}

function isBinaryPath(rel) {
  return /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp[34]|wav|zip|gz|br|wasm|pdf|exe|dll|so|dylib|bin|dat|sqlite3?|db)$/i.test(
    rel,
  );
}

/**
 * True when `token` occurs in `line`. Identity-class tokens must be bounded by
 * non-alphanumeric characters (or line edges) so a short local username that
 * happens to be a fragment of a longer brand or project word (e.g. a username
 * inside the brand name) does not fire on branding text; the guard targets
 * genuine identity leaks such as home paths like /Users/name or C:\Users\name.
 * List-class tokens are plain literal substrings, operator-chosen.
 */
function lineHasToken(line, token, source) {
  if (source !== 'identity') return line.includes(token);
  let idx = line.indexOf(token);
  while (idx !== -1) {
    const before = idx === 0 ? '' : line[idx - 1];
    const after = idx + token.length >= line.length ? '' : line[idx + token.length];
    const bOk = before === '' || !/[A-Za-z0-9]/.test(before);
    const aOk = after === '' || !/[A-Za-z0-9]/.test(after);
    if (bOk && aOk) return true;
    idx = line.indexOf(token, idx + 1);
  }
  return false;
}

function listFiles() {
  if (mode === 'staged') {
    const out = git('git diff --cached --name-only --diff-filter=ACM');
    return out ? out.split(/\r?\n/).filter(Boolean) : [];
  }
  const tracked = git('git ls-files');
  let untracked = '';
  try {
    untracked = git('git ls-files --others --exclude-standard');
  } catch {
    untracked = '';
  }
  return [
    ...new Set([
      ...(tracked ? tracked.split(/\r?\n/) : []),
      ...(untracked ? untracked.split(/\r?\n/) : []),
    ]),
  ].filter(Boolean);
}

/** Merge list tokens and identity tokens, dedupe, tag with source class. */
export function mergeTokens(listTokens, identityTokens) {
  const seen = new Map();
  for (const t of listTokens || []) {
    const k = typeof t === 'string' ? t.trim() : '';
    if (k && !seen.has(k)) seen.set(k, 'list');
  }
  for (const t of identityTokens || []) {
    const k = typeof t === 'string' ? t.trim() : '';
    if (k && !seen.has(k)) seen.set(k, 'identity');
  }
  return [...seen.entries()].map(([token, source]) => ({ token, source }));
}

function main() {
  if (!inGitWorkTree()) {
    console.log('Forbidden-token check skipped: not inside a git work tree.');
    process.exit(0);
  }

  const { tokens: listTokens, warnings } = readTokenFile();
  // On a hosted CI runner the OS user is the runner account (e.g. "runner"), not a
  // developer identity, and it matches ordinary words. CI sets this to check list tokens only.
  const identityTokens = process.env.FORBIDDEN_TOKENS_SKIP_IDENTITY === '1' ? [] : resolveIdentityTokens();
  const merged = mergeTokens(listTokens, identityTokens);

  for (const w of warnings) console.warn(`token list warning: ${w}`);

  if (!merged.length) {
    console.log(`Forbidden-token check passed (${mode}, no tokens configured).`);
    process.exit(0);
  }

  const findings = [];
  const notes = [];
  let files;
  try {
    files = listFiles();
  } catch (err) {
    console.error(`Forbidden-token check failed: could not list files: ${err?.message || err}`);
    process.exit(1);
  }

  for (const rel of files) {
    const posix = toPosix(rel);
    // Never scan the token list itself; its own entries would self-match.
    if (posix === TOKEN_FILE_POSIX) continue;
    if (isBinaryPath(rel)) continue;
    const abs = resolve(root, rel);
    if (!existsSync(abs)) continue;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > SIZE_CAP) {
      notes.push(`skipped ${posix} (> 2 MB)`);
      continue;
    }
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { token, source } of merged) {
        if (lineHasToken(line, token, source)) {
          const shown = source === 'identity' ? 'local username' : token;
          findings.push({ file: posix, line: i + 1, source, shown });
        }
      }
    }
  }

  for (const n of notes) console.log(`note: ${n}`);

  if (findings.length) {
    console.error(`Forbidden-token check failed (${mode}): ${findings.length} finding(s)`);
    for (const f of findings) {
      console.error(`  - ${f.file}:${f.line}: forbidden token (${f.source}: ${f.shown})`);
    }
    console.error('Remove the forbidden token(s) from the tree, then retry.');
    process.exit(1);
  }

  console.log(`Forbidden-token check passed (${mode}, ${files.length} file(s)).`);
  process.exit(0);
}

// Run main when executed directly, not when imported by tests.
const invokedAsScript = (() => {
  try {
    return resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
})();

if (invokedAsScript) main();
