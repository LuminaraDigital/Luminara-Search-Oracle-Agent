import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PDF_ASSET = /^(?:pdf|pdfService)-[^/]+\.js$|^forme_bg-[^/]+\.wasm$|\.wasm$/;

export function isPdfAsset(name) {
  const base = name.split('/').pop() || name;
  return PDF_ASSET.test(base);
}

/** Static `from "./x.js"` edges only. Dynamic `import()` is not an edge. */
export function staticJsImports(source) {
  const deps = new Set();
  for (const match of source.matchAll(/from\s*["'](\.\/[^"']+\.js)["']/g)) {
    deps.add(match[1].split('/').pop());
  }
  for (const match of source.matchAll(/(?:^|[;\n])import\s*["'](\.\/[^"']+\.js)["']/g)) {
    deps.add(match[1].split('/').pop());
  }
  return [...deps];
}

function sourceLoadsFormeWasm(source) {
  return source.includes('forme_bg');
}

/**
 * Files in the static import closure of `entryName` that are the PDF engine
 * or that evaluate the Forme WASM. `files` maps a chunk basename to its source.
 */
export function entryPdfImports(files, entryName) {
  const hits = [];
  const seen = new Set();
  const queue = [entryName.split('/').pop()];
  while (queue.length) {
    const name = queue.pop();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const source = files.get(name);
    if (source == null) continue;
    if (isPdfAsset(name) || sourceLoadsFormeWasm(source)) hits.push(name);
    for (const dep of staticJsImports(source)) {
      if (isPdfAsset(dep)) hits.push(dep);
      queue.push(dep);
    }
  }
  return [...new Set(hits)];
}

export function modulePreloadPdfHrefs(html) {
  const hrefs = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/g)) {
    const text = tag[0];
    if (!text.includes('modulepreload')) continue;
    const href = text.match(/href="([^"]+)"/);
    if (href && isPdfAsset(href[1])) hrefs.push(href[1]);
  }
  return hrefs;
}

function moduleEntrySrc(html) {
  for (const tag of html.matchAll(/<script\b[^>]*>/g)) {
    const text = tag[0];
    if (!text.includes('type="module"')) continue;
    const src = text.match(/\bsrc="([^"]+\.js)"/);
    if (src) return src[1];
  }
  return null;
}

export function entryPdfImportsFromDist(distDir) {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const src = moduleEntrySrc(html);
  if (!src) {
    throw new Error(`${distDir}/index.html has no module entry script`);
  }
  const hits = modulePreloadPdfHrefs(html).map((href) => `modulepreload ${href}`);
  const files = new Map();
  const entryBase = src.split('/').pop();
  const queue = [entryBase];
  const seen = new Set();
  while (queue.length) {
    const name = queue.pop();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const abs = join(distDir, 'assets', name);
    if (!existsSync(abs)) continue;
    const source = readFileSync(abs, 'utf8');
    files.set(name, source);
    for (const dep of staticJsImports(source)) queue.push(dep);
  }
  return [...hits, ...entryPdfImports(files, entryBase)];
}
