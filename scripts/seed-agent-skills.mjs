/**
 * Seed agent_skills (D1) with methodology prompts bundled in services/geminiService.ts.
 *
 * Usage:
 *   node scripts/seed-agent-skills.mjs [--local|--remote] [--apply]
 *
 * Default mode is DRY RUN: prints the planned INSERT statements without writing.
 * Writing to D1 requires --apply. Target defaults to --local (wrangler dev db);
 * pass --remote for the production database.
 *
 * HEURISTIC: reads services/geminiService.ts as text and finds exported const
 * template literals whose NAME matches /PROMPT|INSTRUCTION|SYSTEM/ AND whose
 * template body exceeds 200 chars (short constants are labels, not prompts).
 * NAME is slugified to kebab-case for skill_slug. Template bodies are captured
 * as raw source text; any ${interpolation} stays literal, so review slugs
 * before --apply and prune versions whose prompts are dynamic.
 *
 * Honesty note: this script seeds ONE version per slug with version=1. The
 * runtime loader never seeds D1 from fallbacks; this operator-run script is
 * the only bridge from bundled prompts to the catalog.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(repoRoot, 'services', 'geminiService.ts');
const MODE_RE = /PROMPT|INSTRUCTION|SYSTEM/;
const MIN_BODY = 200;

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

// Find `export const NAME = \`...\`;` blocks. The body may span lines; a
// backtick closes it (template literal escapes like \` are rare in prompts
// and would need manual review anyway).
function findPromptConsts(text) {
  const re = /export const ([A-Za-z0-9_]+)\s*=\s*`([\s\S]*?)`/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, name, body] = m;
    if (!MODE_RE.test(name)) continue;
    if (body.length <= MIN_BODY) continue;
    out.push({ slug: slugify(name), name, body });
  }
  return out;
}

// wrangler d1 execute --command takes raw SQL with no bindings, so inline
// values with single quotes doubled.
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

function buildInsert({ slug, body }) {
  return (
    'INSERT OR IGNORE INTO agent_skills (skill_slug, version, enabled, prompt_body, created_at, created_by, notes) VALUES (' +
    [sqlString(slug), '1', '1', sqlString(body), String(Date.now()), sqlString('seed-script'), sqlString('seeded from services/geminiService.ts')].join(', ') +
    ');'
  );
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const target = args.includes('--remote') ? '--remote' : '--local';

const text = readFileSync(SOURCE, 'utf8');
const matches = findPromptConsts(text);

console.log(`[seed-agent-skills] source: ${SOURCE}`);
console.log(`[seed-agent-skills] matched ${matches.length} prompt consts:`);
for (const m of matches) console.log(`  - ${m.name} -> slug '${m.slug}' (${m.body.length} chars)`);

if (!apply) {
  console.log('\n[seed-agent-skills] DRY RUN (pass --apply to write). Planned statements:');
  for (const m of matches) console.log(buildInsert(m) + '\n');
  console.log(`[seed-agent-skills] planned ${matches.length} INSERT statements against target '${target}'.`);
  process.exit(0);
}

let ok = 0;
let failed = 0;
for (const m of matches) {
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'luminara-users', target, '--command', buildInsert(m)], {
      stdio: 'inherit',
      cwd: repoRoot,
    });
    ok++;
  } catch (err) {
    failed++;
    console.error(`[seed-agent-skills] FAILED slug '${m.slug}': ${err.message}`);
  }
}
console.log(`[seed-agent-skills] done: ${ok} inserted, ${failed} failed of ${matches.length} total.`);
process.exit(failed > 0 ? 1 : 0);
