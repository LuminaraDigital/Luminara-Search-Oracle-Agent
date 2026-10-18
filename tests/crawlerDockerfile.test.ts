import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The crawler image copies files one by one, so a new local import that is not listed in the
// Dockerfile only shows up as ERR_MODULE_NOT_FOUND when the container starts.
const CRAWLER_DIR = resolve(__dirname, '../crawler');
const read = (file: string) => readFileSync(resolve(CRAWLER_DIR, file), 'utf8');

function localImports(source: string): string[] {
  const specifiers = [
    ...source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(?\s*['"](\.[^'"]+)['"]/g),
  ].map((m) => m[1]);
  return [...new Set(specifiers)];
}

function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of localImports(read(file))) {
      queue.push(posix.normalize(posix.join(posix.dirname(file), spec)));
    }
  }
  return seen;
}

function copiedSources(dockerfile: string): Set<string> {
  const copied = new Set<string>();
  for (const line of dockerfile.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    const match = line.match(/^\s*COPY\s+(.+)$/i);
    if (!match) continue;
    const args = match[1].trim().split(/\s+/).filter((arg) => !arg.startsWith('--'));
    for (const src of args.slice(0, -1)) copied.add(posix.normalize(src));
  }
  return copied;
}

describe('crawler Dockerfile', () => {
  const dockerfile = read('Dockerfile');
  const copied = copiedSources(dockerfile);

  it('copies every local module in the server import graph', () => {
    const graph = importGraph('server.mjs');
    expect(graph.size).toBeGreaterThan(1);
    for (const file of graph) expect(copied, file).toContain(file);
  });

  it('installs from the lockfile with npm ci', () => {
    expect(copied).toContain('package-lock.json');
    expect(dockerfile).toMatch(/^RUN npm ci --omit=dev\b/m);
    expect(dockerfile).not.toMatch(/\bnpm install\b/);
  });

  it('keeps the lockfile in sync with package.json so npm ci can run', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    expect(lock.packages[''].dependencies).toEqual(pkg.dependencies);
  });
});
