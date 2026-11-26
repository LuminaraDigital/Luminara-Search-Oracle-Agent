import { describe, expect, it } from 'vitest';
import { findRegressions, parseNameStatus } from '../scripts/ratchets-lib.mjs';

function failed(changes: Array<{ file: string; before: string | null; after: string }>): string[] {
  return findRegressions(changes).map((r: { file: string; ratchet: { name: string } }) => `${r.file}:${r.ratchet.name}`);
}

describe('ratchets', () => {
  it('fails a file that gains an explicit any', () => {
    expect(
      failed([{ file: 'worker/a.ts', before: 'const x = y as any;', after: 'const x = y as any;\nconst z: any = 1;' }]),
    ).toEqual(['worker/a.ts:explicit-any']);
  });

  it('passes a file that keeps or lowers its count', () => {
    expect(
      failed([
        { file: 'worker/a.ts', before: 'const x = y as any;', after: 'const x = y as any;\nconst n = 1;' },
        { file: 'worker/b.ts', before: '// eslint-disable-next-line\nfoo();', after: 'foo();' },
      ]),
    ).toEqual([]);
  });

  it('counts a new file from zero', () => {
    expect(failed([{ file: 'services/new.ts', before: null, after: '// @ts-ignore\nfoo();' }])).toEqual([
      'services/new.ts:check-suppressions',
    ]);
  });

  it('leaves any and suppressions in tests alone', () => {
    expect(
      failed([{ file: 'tests/a.test.ts', before: null, after: 'const env = {} as any; // @ts-expect-error' }]),
    ).toEqual([]);
  });

  it('fails a file that crosses 1000 lines, and lets one already over it change', () => {
    const lines = (n: number) => Array.from({ length: n }, () => 'x();').join('\n');
    expect(
      failed([
        { file: 'worker/grew.ts', before: lines(1000), after: lines(1001) },
        { file: 'worker/giant.ts', before: lines(2000), after: lines(2100) },
      ]),
    ).toEqual(['worker/grew.ts:oversized-file']);
  });

  it('ignores vendored, generated and non-TypeScript files', () => {
    expect(
      failed([
        { file: '.claude/skills/x/run.ts', before: null, after: 'const a: any = 1;' },
        { file: 'worker/mcpGuides.generated.ts', before: null, after: 'const a: any = 1;' },
        { file: 'scripts/tool.mjs', before: null, after: '// eslint-disable\n' },
      ]),
    ).toEqual([]);
  });

  it('reads a renamed file against its old path', () => {
    expect(parseNameStatus('M\0a.ts\0R090\0old.ts\0new.ts\0A\0b.ts\0D\0gone.ts\0')).toEqual([
      { file: 'a.ts', baseFile: 'a.ts' },
      { file: 'new.ts', baseFile: 'old.ts' },
      { file: 'b.ts', baseFile: null },
    ]);
  });
});
