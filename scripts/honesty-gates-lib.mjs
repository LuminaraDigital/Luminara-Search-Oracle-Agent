// Honesty gates library: exported check functions for CI gating.
// Each check returns violation objects: { file, line, rule, snippet }.
// Node stdlib only, ESM.

import fs from 'node:fs';
import path from 'node:path';

export const RULE_HEX = 'no-hardcoded-hex-colors';
export const RULE_RANDOM = 'no-math-random-metrics';
export const RULE_PROMPT = 'no-metric-claims-without-citation-in-prompts';
export const RULE_VENDOR = 'no-banned-vendor-names';

const SKIP_PATH_PARTS = ['docs/', 'public/', 'design/', '.hallmark/', '.hermes/', 'node_modules', 'dist', 'build'];

function normalize(p) {
  return p.split(path.sep).join('/');
}

export function walkFiles(rootDir, exts, out = []) {
  if (!fs.existsSync(rootDir)) return out;
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (exts.some((ext) => e.name.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out;
}

export function isExemptPath(relFile) {
  const f = normalize(relFile);
  const basename = f.split('/').pop();
  if (basename === 'constants.tsx') return true;
  if (basename === 'index.css') return true;
  if (basename === 'tailwind.config.js') return true;
  if (f.includes('/constants/')) return true;
  if (f === 'components/ui/icons.tsx' || f.endsWith('/components/ui/icons.tsx')) return true;
  for (const part of SKIP_PATH_PARTS) {
    if (f.includes(part)) return true;
  }
  return false;
}

function snippetFor(text, index) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + 60);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function relPath(rootDir, abs) {
  return normalize(path.relative(rootDir, abs));
}

export function checkNoHardcodedHexColors(rootDir) {
  const violations = [];
  const files = walkFiles(path.join(rootDir, 'components'), ['.tsx']);
  const re = /#(?:[0-9a-fA-F]{3}\b|[0-9a-fA-F]{6}\b)/g;
  for (const abs of files) {
    const rel = relPath(rootDir, abs);
    if (isExemptPath(rel)) continue;
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    let m;
    while ((m = re.exec(text)) !== null) {
      violations.push({
        file: rel,
        line: lineAt(text, m.index),
        rule: RULE_HEX,
        snippet: snippetFor(text, m.index),
      });
    }
  }
  return violations;
}

export function checkNoMathRandomMetrics(rootDir) {
  const violations = [];
  const metricRe = /authority|traffic|keyword|ranking|visibility|score/i;
  const randRe = /Math\.random\(/g;
  const files = [
    ...walkFiles(path.join(rootDir, 'services'), ['.ts']),
    ...walkFiles(path.join(rootDir, 'worker'), ['.ts']),
  ];
  for (const abs of files) {
    const rel = relPath(rootDir, abs);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!metricRe.test(text)) continue;
    let m;
    while ((m = randRe.exec(text)) !== null) {
      violations.push({
        file: rel,
        line: lineAt(text, m.index),
        rule: RULE_RANDOM,
        snippet: snippetFor(text, m.index),
      });
    }
  }
  return violations;
}

export function checkNoMetricClaimsWithoutCitation(rootDir) {
  const violations = [];
  const file = path.join(rootDir, 'services', 'geminiService.ts');
  if (!fs.existsSync(file)) return violations;
  const rel = relPath(rootDir, file);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return violations;
  }
  // Extract template literals (naive backtick scan, handles interpolation by scanning between backticks).
  const literals = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      const start = i;
      i++;
      let depth = 0;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '$' && text[i + 1] === '{') {
          depth++;
          i += 2;
          continue;
        }
        if (text[i] === '}' && depth > 0) {
          depth--;
          i++;
          continue;
        }
        if (text[i] === '`' && depth === 0) break;
        i++;
      }
      const end = i;
      literals.push({ start, end, body: text.slice(start, end + 1) });
    }
    i++;
  }
  const allowRe = /not_measured|cite|citation|source/i;
  for (const lit of literals) {
    if (/domain authority/i.test(lit.body) && !allowRe.test(lit.body)) {
      const idx = lit.body.search(/domain authority/i);
      violations.push({
        file: rel,
        line: lineAt(text, lit.start + idx),
        rule: RULE_PROMPT,
        snippet: snippetFor(lit.body, idx),
      });
    }
  }
  return violations;
}

const BANNED_VENDORS = ['wger', 'openfoodfacts', 'coincompass', 'paperclip'];

export function checkNoBannedVendorNames(rootDir) {
  const violations = [];
  const files = [
    ...walkFiles(path.join(rootDir, 'components'), ['.tsx']),
    ...walkFiles(path.join(rootDir, 'public'), ['.html']),
  ];
  for (const extra of ['constants.tsx', 'index.html']) {
    const p = path.join(rootDir, extra);
    if (fs.existsSync(p)) files.push(p);
  }
  const re = new RegExp(`\\b(?:${BANNED_VENDORS.join('|')})\\b`, 'gi');
  for (const abs of files) {
    const rel = relPath(rootDir, abs);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    let m;
    while ((m = re.exec(text)) !== null) {
      violations.push({
        file: rel,
        line: lineAt(text, m.index),
        rule: RULE_VENDOR,
        snippet: snippetFor(text, m.index),
      });
    }
  }
  return violations;
}

export function runAllChecks(rootDir) {
  return [
    ...checkNoHardcodedHexColors(rootDir),
    ...checkNoMathRandomMetrics(rootDir),
    ...checkNoMetricClaimsWithoutCitation(rootDir),
    ...checkNoBannedVendorNames(rootDir),
  ];
}

export function loadBaseline(baselinePath) {
  try {
    if (!fs.existsSync(baselinePath)) return new Set();
    const raw = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const list = Array.isArray(raw?.violations) ? raw.violations : [];
    return new Set(list.map((v) => `${normalize(String(v.file))}::${String(v.rule)}`));
  } catch {
    return new Set();
  }
}

export function baselineKey(v) {
  return `${normalize(v.file)}::${v.rule}`;
}

export function filterNewViolations(violations, baselineKeys) {
  const fresh = [];
  const grandfathered = [];
  for (const v of violations) {
    if (baselineKeys.has(baselineKey(v))) grandfathered.push(v);
    else fresh.push(v);
  }
  return { fresh, grandfathered };
}

export function serializeBaseline(violations) {
  const list = violations.map((v) => ({ file: normalize(v.file), line: v.line, rule: v.rule }));
  list.sort((a, b) => (a.rule + a.file).localeCompare(b.rule + b.file));
  return JSON.stringify({ violations: list }, null, 2) + '\n';
}
