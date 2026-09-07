#!/usr/bin/env node
/**
 * Compiles the vendored claude-seo skills (.claude/skills/*, MIT, by AgriciDaniel) into a compact
 * JSON of "playbooks" the app injects into audit and chat prompts.
 *
 * Only the methodology is kept: scoring criteria, checklists, thresholds, deprecations, output
 * structure. Runtime instructions (Python scripts, MCP tools, community footer, error handling)
 * are stripped because the browser app has none of that machinery.
 *
 * Run: node scripts/build-playbooks.mjs   (also runs as `prebuild`)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, '.claude', 'skills');
const outFile = join(root, 'services', 'skills', 'playbooks.generated.json');

/** Playbooks the app uses, with the audit focuses / lenses they apply to. */
const PLAYBOOKS = [
  { id: 'core', skill: 'seo', title: 'Scoring and priority rules', tags: ['SEO', 'AEO', 'GEO'], keep: ['Quality Gates', 'Scoring Methodology', 'Industry Detection'], max: 4500 },
  { id: 'technical', skill: 'seo-technical', title: 'Technical SEO', tags: ['SEO'], drop: ['Audit command', 'Agent-Friendly Pages & Agentic Browsing'], max: 9000 },
  { id: 'content', skill: 'seo-content', title: 'Content quality and E-E-A-T', tags: ['SEO', 'GEO'], max: 9000 },
  { id: 'schema', skill: 'seo-schema', title: 'Schema.org markup', tags: ['SEO', 'AEO', 'GEO', 'schema'], drop: ['Detection', 'Generation'], max: 8000 },
  { id: 'geo', skill: 'seo-geo', title: 'AI search (AI Overviews, ChatGPT, Perplexity)', tags: ['AEO', 'GEO'], max: 11000 },
  { id: 'local', skill: 'seo-local', title: 'Local SEO', tags: ['local'], drop: ['Reference Files', 'FLOW Framework Integration'], max: 10000 },
  { id: 'ecommerce', skill: 'seo-ecommerce', title: 'E-commerce SEO', tags: ['ecommerce'], keep: ['1. Product Page Analysis (No DataForSEO Needed)', '5. Product Schema Enhancement'], max: 8000 },
  { id: 'sxo', skill: 'seo-sxo', title: 'Search experience (SXO)', tags: ['sxo'], max: 6000 },
  { id: 'page', skill: 'seo-page', title: 'Single-page checklist', tags: ['page'], max: 5000 },
];

const ALWAYS_DROP = new Set([
  'DataForSEO Integration (Optional)', 'DataForSEO Integration', 'Google API Integration (Optional)', 'Google API Integration',
  'Error Handling', 'Community Footer', 'When to show', 'When to skip', 'Runtime Setup', 'Runtime', 'Sub-Skills', 'Subagents',
  'Optional Extensions', 'Quick Reference', 'Orchestration Logic', 'Commands', 'Cost Guardrail (MANDATORY)',
]);

function stripFrontmatter(md) {
  return md.startsWith('---') ? md.replace(/^---[\s\S]*?\n---\n/, '') : md;
}

/** Splits markdown into [{level, title, body}] on H2/H3 headings. */
function sections(md) {
  const out = [];
  let current = { level: 0, title: '', lines: [] };
  for (const line of md.split('\n')) {
    const m = line.match(/^(##|###)\s+(.*)$/);
    if (m) {
      out.push(current);
      current = { level: m[1].length, title: m[2].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  out.push(current);
  return out;
}

function cleanBody(text) {
  return text
    .split('\n')
    // Runtime references make no sense in the app.
    .filter(l => !/claude-seo run|claude-seo setup|claude-seo doctor|\/seo [a-z-]+|MCP|mcp_|skool\.com|Built by agricidaniel/i.test(l))
    .join('\n')
    .replace(/```(bash|sh|python)[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compile(spec) {
  const file = join(skillsDir, spec.skill, 'SKILL.md');
  if (!existsSync(file)) throw new Error(`Missing skill: ${file}`);
  const raw = stripFrontmatter(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  const parts = sections(raw);
  const kept = [];
  let keeping = !spec.keep; // keep-list mode starts closed; drop-list mode starts open
  let currentH2Dropped = false;
  for (const s of parts) {
    if (s.level === 0) continue; // intro before first heading is usually invocation text
    if (s.level === 2) {
      if (spec.keep) keeping = spec.keep.includes(s.title);
      currentH2Dropped = ALWAYS_DROP.has(s.title) || (spec.drop || []).includes(s.title);
    }
    if (!keeping || currentH2Dropped) continue;
    if (s.level === 3 && (ALWAYS_DROP.has(s.title) || (spec.drop || []).includes(s.title))) continue;
    const body = cleanBody(s.lines.join('\n'));
    if (!body) continue;
    kept.push(`${'#'.repeat(s.level)} ${s.title}\n${body}`);
  }
  let text = kept.join('\n\n');
  if (text.length > spec.max) text = text.slice(0, spec.max).replace(/\n[^\n]*$/, '') + '\n…';
  return { id: spec.id, title: spec.title, tags: spec.tags, chars: text.length, body: text };
}

const playbooks = PLAYBOOKS.map(compile);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({
  source: 'AgriciDaniel/claude-seo (MIT). Compiled by scripts/build-playbooks.mjs; do not edit by hand.',
  generatedAt: new Date().toISOString().slice(0, 10),
  playbooks,
}, null, 2) + '\n');
console.log(playbooks.map(p => `${p.id.padEnd(10)} ${String(p.chars).padStart(6)} chars`).join('\n'));
