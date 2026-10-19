import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entryPdfImports, entryPdfImportsFromDist, modulePreloadPdfHrefs } from '../scripts/entrySkipsPdf.mjs';

describe('entry static graph skips the PDF engine', () => {
  it('flags an entry that static-imports the PDF chunk', () => {
    const files = new Map<string, string>([
      ['index-abc.js', 'import{_ as De}from"./pdf-JZKVPoNl.js";import{a}from"./react-1.js";'],
      ['pdf-JZKVPoNl.js', 'const sr="/assets/forme_bg-uQR90Ufo.wasm";export{Ln as _};'],
      ['react-1.js', 'export const a = 1;'],
    ]);

    expect(entryPdfImports(files, 'index-abc.js')).toEqual(['pdf-JZKVPoNl.js']);
  });

  it('allows a dynamic import of the PDF service', () => {
    const files = new Map<string, string>([
      ['index-abc.js', 'import{_ as De}from"./preload-helper-1.js";import("./pdfService-xyz.js")'],
      ['preload-helper-1.js', 'export const __vitePreload = () => {};'],
      ['pdfService-xyz.js', 'import{b}from"./pdf-JZKVPoNl.js";'],
      ['pdf-JZKVPoNl.js', 'const sr="/assets/forme_bg-hash.wasm";'],
    ]);

    expect(entryPdfImports(files, 'index-abc.js')).toEqual([]);
  });

  it('flags a middle chunk that static-imports the engine', () => {
    const files = new Map<string, string>([
      ['index-abc.js', 'import{a}from"./vendor-1.js";'],
      ['vendor-1.js', 'import{b}from"./pdf-abc.js";export const a = 1;'],
      ['pdf-abc.js', 'export const b = 1;'],
    ]);

    expect(entryPdfImports(files, 'index-abc.js')).toContain('pdf-abc.js');
  });

  it('follows the module entry, not an earlier third-party script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pdf-entry-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(
      join(dir, 'index.html'),
      '<script defer src="https://telegram.org/js/telegram-web-app.js"></script>' +
        '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
    );
    writeFileSync(join(dir, 'assets', 'index-abc.js'), 'import{_ as x}from"./pdf-abc.js";');
    writeFileSync(join(dir, 'assets', 'pdf-abc.js'), 'const sr="/assets/forme_bg-hash.wasm";');

    expect(entryPdfImportsFromDist(dir)).toEqual(['pdf-abc.js']);
  });

  it('flags a modulepreload of the wasm asset', () => {
    const html =
      '<link rel="modulepreload" crossorigin href="/assets/forme_bg-uQR90Ufo.wasm">' +
      '<link rel="modulepreload" crossorigin href="/assets/react-1.js">';

    expect(modulePreloadPdfHrefs(html)).toEqual(['/assets/forme_bg-uQR90Ufo.wasm']);
  });
});
