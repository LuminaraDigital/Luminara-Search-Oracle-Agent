#!/usr/bin/env node
/**
 * GUI grounding CLI: protocol prompt, score JSONL, model gate, Luminara seed dump,
 * and PointerBench fetch instructions.
 *
 * Usage:
 *   npm run grounding:prompt
 *   npm run grounding:seed
 *   npm run grounding:score -- --gt path.jsonl --predictions preds.jsonl
 *   npm run grounding:gate -- --sheets 0.82 --text 0.48 --pro 0.77
 *   npm run grounding:fetch
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  POINTER_SYSTEM_PROMPT,
  LUMINARA_SURFACE_PROMPT,
  luminaraSurfaceSeed,
  buildGroundingReport,
  formatReport,
  evaluateModelGate,
  predictionsFromJsonl,
  type GroundingExample,
  type GroundingSubset,
} from './index.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  return argv[i + 1];
}

function has(name: string): boolean {
  return argv.includes(name);
}

function loadJsonl(path: string): unknown[] {
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text) as unknown[];
  return text
    .split(/\r?\n/)
    .filter((ln) => ln.trim())
    .map((ln) => JSON.parse(ln));
}

function printHelp(): void {
  console.log(`grounding-eval

  --show-system-prompt     Print PointerBench pointer system prompt
  --seed                   Print Luminara surface seed JSONL
  --write-seed <path>      Write seed JSONL to path
  --gt <path>              Ground-truth JSONL
  --predictions <path>     Predictions JSONL
  --required <list>        Comma subsets for gate (default sheets,text,pro)
  --vanity-only            Fail gate as vanity-bench-only candidate
  --sheets <0-1>           Gate input score
  --text <0-1>
  --pro <0-1>
  --luminara <0-1>
  --fetch                  Print how to download PointerBench into tmp/
  --help
`);
}

function cmdPrompt(): void {
  console.log(POINTER_SYSTEM_PROMPT);
  console.log('');
  console.log('# Luminara surface addendum');
  console.log(LUMINARA_SURFACE_PROMPT);
}

function cmdSeed(): void {
  for (const ex of luminaraSurfaceSeed()) {
    console.log(JSON.stringify(ex));
  }
}

function cmdWriteSeed(path: string): void {
  const abs = resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  const body = luminaraSurfaceSeed()
    .map((ex) => JSON.stringify(ex))
    .join('\n');
  writeFileSync(abs, body + '\n', 'utf8');
  console.log(`wrote ${abs}`);
}

function cmdScore(): void {
  const gtPath = flag('--gt');
  const predPath = flag('--predictions');
  if (!gtPath || !predPath) {
    console.error('--gt and --predictions are required');
    process.exit(2);
  }
  const examples = loadJsonl(resolve(gtPath)) as GroundingExample[];
  const predRows = loadJsonl(resolve(predPath)) as Array<{
    id: string;
    point?: [number, number];
    bbox?: [number, number, number, number];
  }>;
  const predictions = predictionsFromJsonl(predRows);
  const required = (flag('--required') ?? 'sheets,text,pro')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as GroundingSubset[];
  const report = buildGroundingReport(examples, predictions, {
    required,
    vanityBenchOnly: has('--vanity-only'),
  });
  console.log(formatReport(report));
  const out = flag('--json');
  if (out) {
    writeFileSync(resolve(out), JSON.stringify(report, null, 2), 'utf8');
    console.log(`report -> ${resolve(out)}`);
  }
  process.exit(report.gate.pass ? 0 : 1);
}

function cmdGate(): void {
  const scores: Partial<Record<GroundingSubset, number>> = {};
  for (const key of ['sheets', 'text', 'pro', 'luminara'] as const) {
    const raw = flag(`--${key}`);
    if (raw !== undefined) scores[key] = Number(raw);
  }
  const required = (flag('--required') ?? 'sheets,text,pro')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as GroundingSubset[];
  const gate = evaluateModelGate({
    scores,
    required,
    vanityBenchOnly: has('--vanity-only'),
  });
  console.log(JSON.stringify(gate, null, 2));
  process.exit(gate.pass ? 0 : 1);
}

function cmdFetch(): void {
  const dest = resolve(root, 'tmp', 'pointerbench');
  console.log(`PointerBench lives on GitHub + Hugging Face.
Clone scorers/metadata, then download PNGs into the same layout.

  gh repo clone warmwindOS/pointerbench "${dest}"
  cd "${dest}"
  huggingface-cli download WarmwindOS/pointerbench --repo-type dataset --local-dir .

Then score with the upstream eval.py, or convert metadata into our JSONL and:

  npm run grounding:score -- --gt tmp/pointerbench/.../metadata.jsonl --predictions preds.jsonl

Do not train on the public set if you treat it as a held-out ruler.
tmp/ is gitignored.`);
  if (existsSync(dest)) {
    console.log(`\nAlready present: ${dest}`);
  }
}

if (has('--help') || argv.length === 0) {
  printHelp();
  process.exit(0);
}
if (has('--show-system-prompt')) cmdPrompt();
else if (has('--seed')) cmdSeed();
else if (flag('--write-seed')) cmdWriteSeed(flag('--write-seed')!);
else if (has('--fetch')) cmdFetch();
else if (flag('--sheets') || flag('--text') || flag('--pro') || flag('--luminara')) {
  // Gate-only mode when score flags present without --gt
  if (!flag('--gt')) cmdGate();
  else cmdScore();
} else if (flag('--gt') || flag('--predictions')) cmdScore();
else {
  printHelp();
  process.exit(2);
}
