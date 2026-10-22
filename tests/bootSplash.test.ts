import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissBootSplash } from '../services/intro/bootSplash';

function splashEl() {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  let removeTimers = 0;
  return {
    classList: {
      contains: (name: string) => classes.has(name),
      add: (name: string) => { classes.add(name); },
    },
    setAttribute: (name: string, value: string) => { attrs.set(name, value); },
    addEventListener: () => { removeTimers += 1; },
    remove: () => {},
    attrs,
    get removeTimers() { return removeTimers; },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dismissBootSplash', () => {
  it('exits once, waits out a delay, and ignores a missing splash', () => {
    vi.useFakeTimers();
    const el = splashEl();
    vi.stubGlobal('document', { getElementById: () => el });

    dismissBootSplash(200);
    expect(el.classList.contains('boot-splash--exit')).toBe(false);
    vi.advanceTimersByTime(200);
    expect(el.classList.contains('boot-splash--exit')).toBe(true);
    expect(el.attrs.get('aria-busy')).toBe('false');
    expect(el.removeTimers).toBe(1);

    dismissBootSplash(0);
    expect(el.removeTimers).toBe(1);

    vi.stubGlobal('document', { getElementById: () => null });
    expect(() => dismissBootSplash(0)).not.toThrow();
  });

  it('holds the splash until React, snaps the fade when motion is reduced, and marks 404', () => {
    const early = readFileSync('public/boot-splash.js', 'utf8');
    const entry = readFileSync('index.tsx', 'utf8');
    const html = readFileSync('index.html', 'utf8');
    expect(early).toContain('setTimeout(window.__dismissBootSplash, 12000)');
    expect(early).not.toContain('1500');
    expect(entry).not.toContain('1500');
    expect(entry).toContain('dismissBootSplash(0)');
    const motion = html.slice(html.indexOf('prefers-reduced-motion'));
    expect(motion).toMatch(/#boot-splash\s*\{[^}]*transition:\s*none/);
    expect(html).toContain('html.lx-skip-splash #boot-splash { display: none; }');
    expect(html).toContain('html.lx-skip-splash #root:empty');
    expect(html).not.toContain('boot-mark.webp');
    expect(html).not.toContain('Preparing your workspace');
    expect(html).toContain('boot-splash--hold');
    expect(html).toContain('Loading…');
    expect(early).toContain('}, 300);');
    const scene = html.slice(html.indexOf('class="lx-line"'), html.indexOf('class="lx-pin"'));
    expect(scene.length).toBeGreaterThan(20);
    expect(scene.length).toBeLessThan(800);
  });
});
