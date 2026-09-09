#!/usr/bin/env node
/**
 * Blocks commits/pushes that contain credential-shaped strings or secret files.
 * Used by .githooks and `npm run secrets:check`.
 *
 * Exit 0 = clean. Exit 1 = secrets found (or scan error).
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--staged')
  ? 'staged'
  : process.argv.includes('--all')
    ? 'all'
    : 'staged';

/** Paths that may mention key shapes as documentation or placeholders only. */
const ALLOW_PATH_RE =
  /(^|[/\\])(\.env\.example|\.dev\.vars\.example|THIRD_PARTY_NOTICES\.md|package-lock\.json|playbooks\.generated\.json)$/i;

/** Filenames that must never be committed. */
const FORBIDDEN_NAME_RE =
  /(^|[/\\])(\.env|\.env\..+|\.dev\.vars|\.dev\.vars\..+|mcp\.json|\.mcp\.json|.*credentials.*\.json|.*service[_-]?account.*\.json|google-api\.json|application_default_credentials\.json|.*\.(pem|p12|pfx|key)|id_rsa|id_ed25519|id_ecdsa)(\.|$)/i;

const PLACEHOLDER_RE =
  /your[_-]?|example|change[_-]?me|placeholder|xxxx|dummy|redacted|TODO|insert|sample|test[_-]?key|not[_-]?a[_-]?real/i;

/** High-confidence live secret shapes (keep in sync with vite.config.ts + CI). */
const PATTERNS = [
  { label: 'GitHub token (gho_/ghp_/github_pat_)', re: /\b(gho_|ghp_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]{20,}\b/ },
  { label: 'Groq key', re: /\bgsk_[A-Za-z0-9]{20,}\b/ },
  { label: 'NVIDIA key', re: /\bnvapi-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Tavily key', re: /\btvly-[A-Za-z0-9-]{20,}\b/ },
  { label: 'Firecrawl key', re: /\bfc-[a-f0-9]{30,}\b/ },
  { label: 'Browserbase key', re: /\bbb_live_[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'Telegram bot token', re: /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/ },
  { label: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: 'Google service account private_key', re: /"private_key"\s*:\s*"-----BEGIN/ },
];

function git(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
}

function listFiles() {
  if (mode === 'staged') {
    const out = git('git diff --cached --name-only --diff-filter=ACMR');
    return out ? out.split(/\r?\n/).filter(Boolean) : [];
  }
  // Tracked + untracked, respecting .gitignore
  const tracked = git('git ls-files');
  let untracked = '';
  try {
    untracked = git('git ls-files --others --exclude-standard');
  } catch {
    untracked = '';
  }
  return [...new Set([...(tracked ? tracked.split(/\r?\n/) : []), ...(untracked ? untracked.split(/\r?\n/) : [])])].filter(
    Boolean,
  );
}

function isBinaryPath(rel) {
  return /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp[34]|wav|zip|gz|br|wasm|pdf)$/i.test(rel);
}

function relNorm(p) {
  return p.split(/[/\\]/).join(sep);
}

const findings = [];
const files = listFiles();

for (const rel of files) {
  const abs = resolve(root, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) continue;

  if (FORBIDDEN_NAME_RE.test(relNorm(rel)) && !ALLOW_PATH_RE.test(relNorm(rel))) {
    findings.push({ file: rel, label: 'forbidden secret filename', snippet: rel });
    continue;
  }

  if (ALLOW_PATH_RE.test(relNorm(rel)) || isBinaryPath(rel)) continue;

  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  // Skip huge generated lockfiles content scan already allowlisted; skip empty
  if (!text || text.length > 2_000_000) continue;

  for (const { label, re } of PATTERNS) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (!m) continue;
    const hit = m[0];
    // Allow obvious placeholders next to the match context
    const idx = text.indexOf(hit);
    const ctx = text.slice(Math.max(0, idx - 40), idx + hit.length + 40);
    if (PLACEHOLDER_RE.test(ctx) && !/PRIVATE KEY|github_pat_|gho_|ghp_|gsk_|nvapi-|AKIA/.test(hit)) {
      continue;
    }
    // Never allow private keys or GitHub tokens even near "example"
    if (/PRIVATE KEY|gho_|ghp_|ghu_|ghs_|ghr_|github_pat_/.test(hit)) {
      findings.push({ file: rel, label, snippet: hit.slice(0, 12) + '…<REDACTED>' });
      continue;
    }
    if (PLACEHOLDER_RE.test(ctx)) continue;
    findings.push({ file: rel, label, snippet: hit.slice(0, 8) + '…<REDACTED>' });
  }
}

if (findings.length) {
  console.error(`Secret check failed (${mode}): ${findings.length} finding(s)`);
  for (const f of findings) {
    console.error(`  - ${f.file}: ${f.label} (${f.snippet})`);
  }
  console.error('Remove secrets from the tree, use .env / wrangler secrets, then retry.');
  process.exit(1);
}

console.log(`Secret check passed (${mode}, ${files.length} file(s)).`);
process.exit(0);
