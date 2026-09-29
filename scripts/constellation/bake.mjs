#!/usr/bin/env node
/**
 * Orchestrate Visibility Field bake (Blender authoring) + budget gate.
 * Committed outputs live under public/brand/constellation/.
 * CI/deploy do NOT require Blender; regen is opt-in: npm run constellation:bake
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT = join(ROOT, 'public/brand/constellation');
const ARCHIVE = join(ROOT, 'design/constellation');
const PY = join(__dirname, 'bake_visibility_field.py');

/** Hard CI fail budgets (suite-10x). */
const HARD_BUDGETS = {
  'field-idle.webp': 100_000,
  'field-sample.webp': 100_000,
  'field-hero.webp': 140_000,
  'field-hero-nodes.webp': 60_000,
  'og-visibility-field.png': 220_000,
  'visibility-field.glb': 700_000,
};

/** Soft craft targets (warn only). */
const SOFT_BUDGETS = {
  'field-idle.webp': 18_000,
  'field-sample.webp': 22_000,
  'field-hero.webp': 32_000,
  'field-hero-nodes.webp': 32_000,
};

const SOFT_HERO_IDLE_COMBINED = 48_000;
const HARD_HERO_IDLE_COMBINED = 72_000;

const DEFAULT_BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';

function findBlender() {
  const fromEnv = process.env.BLENDER_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync(DEFAULT_BLENDER)) return DEFAULT_BLENDER;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], {
    encoding: 'utf8',
  });
  if (which.status === 0) {
    const line = String(which.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (line && existsSync(line)) return line;
  }
  return null;
}

function runBlender(blender) {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(ARCHIVE, { recursive: true });
  const args = [
    '--background',
    '--python',
    PY,
    '--',
    '--out',
    OUT,
    '--archive',
    ARCHIVE,
    '--states',
    'idle,sample,hero,hero_nodes,og',
  ];
  // Archive GLB is authoring-only and size-sensitive; keep committed GLB unless
  // explicitly regenerating (avoids HD plate density bloating the archive).
  if (process.env.CONSTELLATION_BAKE_ARCHIVE === '1') {
    args.push('--with-archive');
  }
  console.log(`[constellation:bake] ${blender} ${args.join(' ')}`);
  const res = spawnSync(blender, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    throw new Error(`Blender bake failed with exit ${res.status}`);
  }
}

/** Compress deployables with sharp when available. */
async function optimizeOutputs() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.warn(
      '[constellation:bake] sharp not installed; install sharp to meet PNG/WebP budgets (npm i -D sharp)'
    );
    return;
  }
  for (const base of ['field-idle', 'field-sample', 'field-hero']) {
    const png = join(OUT, `${base}.png`);
    if (!existsSync(png)) continue;
    const webp = join(OUT, `${base}.webp`);
    const maxW = base === 'field-hero' ? 1600 : 1280;
    const maxH = base === 'field-hero' ? 1200 : 960;
    const quality = base === 'field-hero' ? 82 : 78;
    await sharp(png)
      .resize(maxW, maxH, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 6 })
      .toFile(webp);
    unlinkSync(png);
    console.log(`[constellation:bake] wrote ${webp}; removed intermediate PNG`);
  }
  const nodesPng = join(OUT, 'field-hero-nodes.png');
  if (existsSync(nodesPng)) {
    const webp = join(OUT, 'field-hero-nodes.webp');
    await sharp(nodesPng)
      .ensureAlpha()
      .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, effort: 6, alphaQuality: 90 })
      .toFile(webp);
    unlinkSync(nodesPng);
    console.log(`[constellation:bake] wrote RGBA ${webp}; removed intermediate PNG`);
  }
  const og = join(OUT, 'og-visibility-field.png');
  if (existsSync(og)) {
    const tmp = join(OUT, 'og-visibility-field.tmp.png');
    await sharp(og)
      .resize(1200, 630, { fit: 'cover' })
      .png({ compressionLevel: 9, palette: true, quality: 80 })
      .toFile(tmp);
    unlinkSync(og);
    renameSync(tmp, og);
    console.log(`[constellation:bake] compressed ${og}`);
  }
}

function checkBudgets() {
  const failures = [];
  const softWarns = [];
  const report = {};
  const checkFile = (abs, name) => {
    if (!existsSync(abs)) return;
    const size = statSync(abs).size;
    report[name] = size;
    const hard = HARD_BUDGETS[name];
    if (hard != null && size > hard) {
      failures.push(`${name}: ${size} bytes > hard budget ${hard}`);
    }
    const soft = SOFT_BUDGETS[name];
    if (soft != null && size > soft) {
      softWarns.push(`${name}: ${size} bytes > soft craft target ${soft}`);
    }
  };
  if (existsSync(OUT)) {
    for (const name of readdirSync(OUT)) {
      checkFile(join(OUT, name), name);
    }
  }
  checkFile(join(ARCHIVE, 'visibility-field.glb'), 'visibility-field.glb');

  const hero = report['field-hero.webp'] || 0;
  const idle = report['field-idle.webp'] || 0;
  if (hero && idle) {
    const combined = hero + idle;
    report.hero_idle_combined = combined;
    if (combined > HARD_HERO_IDLE_COMBINED) {
      failures.push(
        `hero+idle combined: ${combined} bytes > hard ${HARD_HERO_IDLE_COMBINED}`
      );
    } else if (combined > SOFT_HERO_IDLE_COMBINED) {
      softWarns.push(
        `hero+idle combined: ${combined} bytes > soft ${SOFT_HERO_IDLE_COMBINED}`
      );
    }
  }

  writeFileSync(
    join(__dirname, 'budget-report.json'),
    `${JSON.stringify({ ok: failures.length === 0, softWarns, report }, null, 2)}\n`
  );
  for (const w of softWarns) {
    console.warn(`[constellation:bake] soft budget: ${w}`);
  }
  if (failures.length) {
    throw new Error(`Constellation bake over budget:\n${failures.join('\n')}`);
  }
  console.log('[constellation:bake] budgets ok', report);
}

function verifyLayoutParity() {
  const layoutPath = join(ROOT, 'components/marketing/constellationLayout.ts');
  const src = readFileSync(layoutPath, 'utf8');
  const expected = {
    web_serp: { x: 50, y: 12 },
    google_aio: { x: 88, y: 42 },
    chatgpt: { x: 50, y: 88 },
    perplexity: { x: 12, y: 42 },
  };
  for (const [id, pos] of Object.entries(expected)) {
    const re = new RegExp(`${id}:\\s*\\{\\s*x:\\s*${pos.x},\\s*y:\\s*${pos.y}\\s*\\}`);
    if (!re.test(src)) {
      throw new Error(`Layout parity failed for ${id}; update bake script + constellationLayout.ts together`);
    }
  }
  const py = readFileSync(PY, 'utf8');
  for (const [id, pos] of Object.entries(expected)) {
    const re = new RegExp(`"${id}":\\s*\\(${pos.x}\\.0,\\s*${pos.y}\\.0\\)`);
    if (!re.test(py)) {
      throw new Error(`Blender NODE_POS drift for ${id}`);
    }
  }
  console.log('[constellation:bake] layout parity ok');
}

function verifyRequiredOutputs() {
  const need = [
    'manifest.json',
    'og-visibility-field.png',
    'field-idle.webp',
    'field-sample.webp',
    'field-hero.webp',
  ];
  for (const name of need) {
    if (!existsSync(join(OUT, name))) {
      throw new Error(`Missing required bake output: ${name}`);
    }
  }
  if (!existsSync(join(ARCHIVE, 'visibility-field.glb'))) {
    throw new Error('Missing archive GLB at design/constellation/visibility-field.glb');
  }
  // hero-nodes is optional until a bake lands the transparent plate (suite-10x V1).
  if (!existsSync(join(OUT, 'field-hero-nodes.webp'))) {
    console.warn(
      '[constellation:bake] optional field-hero-nodes.webp not present yet; dual-layer hero falls back to single plate'
    );
  }
}

async function main() {
  const mode = process.argv.includes('--check-only') ? 'check' : 'bake';
  verifyLayoutParity();

  if (mode === 'check') {
    verifyRequiredOutputs();
    checkBudgets();
    console.log('[constellation:bake] check-only passed');
    return;
  }

  const blender = findBlender();
  if (!blender) {
    console.error(
      '[constellation:bake] Blender not found. Set BLENDER_BIN or install Blender 5.2. Committed assets under public/brand/constellation/ remain deployable without regen.'
    );
    process.exit(1);
  }

  runBlender(blender);
  await optimizeOutputs();
  const manifestPath = join(OUT, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.files = {
      idle: 'field-idle.webp',
      sample: 'field-sample.webp',
      hero: 'field-hero.webp',
      og: 'og-visibility-field.png',
    };
    if (existsSync(join(OUT, 'field-hero-nodes.webp'))) {
      manifest.files.hero_nodes = 'field-hero-nodes.webp';
    }
    manifest.archive_glb = 'design/constellation/visibility-field.glb';
    manifest.runtime = 'SVG + Canvas2D only; GLB is archive/authoring';
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  verifyRequiredOutputs();
  checkBudgets();
  console.log('[constellation:bake] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
