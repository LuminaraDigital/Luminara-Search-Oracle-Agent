import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain ESM module without types
import { parseYamlSubset } from '../evals/yaml-subset.mjs';

const RUNNER = path.resolve(__dirname, '..', 'evals', 'run-evals.mjs');

const PASSING_CASE = `
- name: fixture-pass
  evidenceNumbers:
    - 54
  response: |
    According to the audit ([link](https://example.com/a)), your visibility score is 54.
    That number matches the recorded evidence bundle.
  expect:
    ok: true
    maxBlock: 0
    mustContain:
      - visibility score is 54
`;

const FAILING_CASE = `
- name: fixture-fail
  evidenceNumbers: []
  response: |
    The crawl shows visibility score: not_measured for this property.
    The visibility score is 72 regardless, claims the dishonest model.
  expect:
    ok: true
    mustContain:
      - this substring is absent
`;

function makeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'evals-fixture-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

describe('evals runner (spawned)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('exits 0 when all cases pass', () => {
    const dir = makeDir({ 'pass.yaml': PASSING_CASE });
    dirs.push(dir);
    const out = execFileSync(process.execPath, [RUNNER, '--dir', dir], {
      encoding: 'utf8',
    });
    expect(out).toContain('1 cases, 1 passed, 0 failed');
  });

  it('exits non-zero when a case fails', () => {
    const dir = makeDir({ 'fail.yaml': FAILING_CASE });
    dirs.push(dir);
    let code = 0;
    let out = '';
    try {
      out = execFileSync(process.execPath, [RUNNER, '--dir', dir], {
        encoding: 'utf8',
      });
    } catch (err: any) {
      code = err.status ?? -1;
      out = String(err.stdout ?? '');
    }
    expect(code).not.toBe(0);
    expect(out).toContain('0 passed, 1 failed');
  });
});

describe('parseYamlSubset', () => {
  it('parses a list of maps with scalars and coercion', () => {
    const items = parseYamlSubset(`
- name: a
  count: 3
  flag: true
  label: "quoted \\"value\\""
- name: b
  flag: false
`);
    expect(items).toEqual([
      { name: 'a', count: 3, flag: true, label: 'quoted "value"' },
      { name: 'b', flag: false },
    ]);
  });

  it('parses block scalars preserving newlines and stripping common indent', () => {
    const items = parseYamlSubset(`
- name: a
  response: |
    line one
    line two
      indented
  after: done
`);
    expect(items[0].response).toBe('line one\nline two\n  indented');
    expect(items[0].after).toBe('done');
  });

  it('parses nested provider and expect maps plus list values', () => {
    const items = parseYamlSubset(`
- name: a
  provider:
    model: recorded-fixture
  evidenceNumbers:
    - 54
    - 31.5
  expect:
    ok: true
    maxBlock: 0
    mustContain:
      - hello
    mustNotContain:
      - goodbye
`);
    expect(items[0].provider).toEqual({ model: 'recorded-fixture' });
    expect(items[0].evidenceNumbers).toEqual([54, 31.5]);
    expect(items[0].expect).toEqual({
      ok: true,
      maxBlock: 0,
      mustContain: ['hello'],
      mustNotContain: ['goodbye'],
    });
  });

  it('parses an inline empty list', () => {
    const items = parseYamlSubset(`- name: a\n  evidenceNumbers: []\n`);
    expect(items[0].evidenceNumbers).toEqual([]);
  });

  it('throws on unsupported syntax', () => {
    expect(() => parseYamlSubset('name: no-list-at-top\n')).toThrow();
    expect(() => parseYamlSubset('- name: a\n  tags: {x: 1}\n')).not.toThrow();
    expect(() => parseYamlSubset('- name: a\n  unknown:\n    deep: 1\n')).toThrow(
      /Empty value/,
    );
  });
});
