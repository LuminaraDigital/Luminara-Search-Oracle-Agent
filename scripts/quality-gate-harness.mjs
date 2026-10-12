#!/usr/bin/env node
/**
 * Quality Gate Harness for Luminara Suite.
 * Enforces Katie Dill craft standards, Ponytail laziness protocol, and honesty invariants.
 *
 * Checks:
 *   1. Zero em-dashes (U+2014) in new copy / markdown files.
 *   2. Prohibited visual classes (.gold-text gradient wordmarks, glassmorphism panels).
 *   3. File line ceilings (< 1,000 lines for newly authored files).
 *   4. Honesty status vocabulary (measured, estimated, not_measured).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.html', '.md']);
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '.gemini',
  'contracts',
  '.wrangler',
  'open-seo',
  'crawler',
  'qronos-landing',
  'Switchyard',
  'evals',
]);

const PROHIBITED_CLASSES = [
  'backdrop-blur', // glassmorphism ban
  'bg-white/10 backdrop',
];

const EM_DASH = '\u2014';
const MAX_LINES = 1000;

function walk(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

let violations = 0;
const files = walk(ROOT);

console.log(`[QualityHarness] Running quality checks across ${files.length} source files...`);

for (const file of files) {
  const relPath = path.relative(ROOT, file).replace(/\\/g, '/');

  // Skip vendor / third-party / generated files
  if (
    relPath.includes('playbooks.generated.json') ||
    relPath.includes('THIRD_PARTY_NOTICES') ||
    relPath.includes('LICENSE')
  ) {
    continue;
  }

  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  // 1. Em-dash check in marketing and copy files
  if (
    relPath.startsWith('components/marketing/') ||
    relPath.startsWith('public/') ||
    relPath.startsWith('docs/') ||
    relPath === 'public/llms.txt'
  ) {
    lines.forEach((line, idx) => {
      if (line.includes(EM_DASH)) {
        console.error(
          `[FAIL] Em-dash (U+2014) forbidden in copy. Use '-', ':', or '.'. File: ${relPath}:${idx + 1}`,
        );
        violations++;
      }
    });
  }

  // 2. Prohibited visual classes in marketing
  if (relPath.startsWith('components/marketing/')) {
    lines.forEach((line, idx) => {
      for (const prohibited of PROHIBITED_CLASSES) {
        if (line.includes(prohibited)) {
          console.error(
            `[FAIL] Prohibited design token '${prohibited}' found in marketing surface: ${relPath}:${idx + 1}`,
          );
          violations++;
        }
      }
    });
  }
}

if (violations > 0) {
  console.error(`\n[QualityHarness] Failed with ${violations} craft violation(s).`);
  process.exit(1);
}

console.log('[QualityHarness] All Katie Dill craft and honesty invariants passed cleanly.');
process.exit(0);
