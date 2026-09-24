import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  checkNoHardcodedHexColors,
  checkNoMathRandomMetrics,
  checkNoMetricClaimsWithoutCitation,
  checkNoBannedVendorNames,
  runAllChecks,
  loadBaseline,
  filterNewViolations,
} from '../scripts/honesty-gates-lib.mjs';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'honesty-gates-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

describe('no-hardcoded-hex-colors', () => {
  it('flags a planted hex color', () => {
    write('components/Foo.tsx', 'const c = "#abc"; const d = "#aabbcc";');
    const v = checkNoHardcodedHexColors(root);
    expect(v.length).toBe(2);
    expect(v[0].rule).toBe('no-hardcoded-hex-colors');
    expect(v[0].file).toContain('components/Foo.tsx');
  });
  it('passes clean input', () => {
    write('components/Foo.tsx', 'const c = "var(--color)";');
    expect(checkNoHardcodedHexColors(root)).toEqual([]);
  });
  it('exempts constants.tsx and icons', () => {
    write('components/constants.tsx', 'const c = "#aabbcc";');
    write('components/ui/icons.tsx', 'const c = "#aabbcc";');
    expect(checkNoHardcodedHexColors(root)).toEqual([]);
  });
});

describe('no-math-random-metrics', () => {
  it('flags Math.random near metric words', () => {
    write('services/metric.ts', 'export const score = Math.random() * 100;');
    const v = checkNoMathRandomMetrics(root);
    expect(v.length).toBe(1);
    expect(v[0].rule).toBe('no-math-random-metrics');
  });
  it('passes Math.random with no metric words', () => {
    write('services/foo.ts', 'export const id = Math.random();');
    expect(checkNoMathRandomMetrics(root)).toEqual([]);
  });
});

describe('no-metric-claims-without-citation-in-prompts', () => {
  it('flags domain authority without citation language', () => {
    write('services/geminiService.ts', 'const p = `rate the domain authority of this site`;');
    const v = checkNoMetricClaimsWithoutCitation(root);
    expect(v.length).toBe(1);
    expect(v[0].rule).toBe('no-metric-claims-without-citation-in-prompts');
  });
  it('passes when citation language present', () => {
    write('services/geminiService.ts', 'const p = `rate the domain authority, else not_measured and cite the source`;');
    expect(checkNoMetricClaimsWithoutCitation(root)).toEqual([]);
  });
  it('handles missing file gracefully', () => {
    expect(checkNoMetricClaimsWithoutCitation(root)).toEqual([]);
  });
});

describe('no-banned-vendor-names', () => {
  it('flags a banned vendor word', () => {
    write('components/List.tsx', 'import x from "openfoodfacts";');
    const v = checkNoBannedVendorNames(root);
    expect(v.length).toBe(1);
    expect(v[0].rule).toBe('no-banned-vendor-names');
  });
  it('passes clean input', () => {
    write('components/List.tsx', 'import x from "axios";');
    expect(checkNoBannedVendorNames(root)).toEqual([]);
  });
});

describe('baseline filtering', () => {
  it('removes grandfathered file+rule', () => {
    write('components/Foo.tsx', 'const c = "#aabbcc";');
    const all = runAllChecks(root);
    const before = all.length;
    const key = `${all[0].file}::${all[0].rule}`.split(path.sep).join('/');
    fs.writeFileSync(
      path.join(root, '.honesty-baseline.json'),
      JSON.stringify({ violations: [{ file: all[0].file, line: 1, rule: all[0].rule }] }),
    );
    const keys = loadBaseline(path.join(root, '.honesty-baseline.json'));
    const { fresh, grandfathered } = filterNewViolations(all, keys);
    expect(grandfathered.length).toBe(before);
    expect(fresh.length).toBe(0);
  });
  it('different rule on grandfathered file still fails', () => {
    write('components/Foo.tsx', 'const c = "#aabbcc";');
    fs.writeFileSync(
      path.join(root, '.honesty-baseline.json'),
      JSON.stringify({ violations: [{ file: 'components/Foo.tsx', line: 1, rule: 'no-banned-vendor-names' }] }),
    );
    const keys = loadBaseline(path.join(root, '.honesty-baseline.json'));
    const { fresh } = filterNewViolations(runAllChecks(root), keys);
    expect(fresh.length).toBeGreaterThan(0);
  });
  it('unknown baseline file handled gracefully', () => {
    fs.writeFileSync(
      path.join(root, '.honesty-baseline.json'),
      JSON.stringify({ violations: [{ file: 'ghost/never-existed.tsx', line: 1, rule: 'no-hardcoded-hex-colors' }] }),
    );
    const keys = loadBaseline(path.join(root, '.honesty-baseline.json'));
    expect(keys.size).toBe(1);
    expect(runAllChecks(root)).toEqual([]);
  });
});
