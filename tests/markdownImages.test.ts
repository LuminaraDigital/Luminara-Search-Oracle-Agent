/** Rendered model output keeps only inline and same-site images, so a remote image cannot carry data out. */
import { describe, expect, it } from 'vitest';
import { isLocalImageSrc } from '../utils/markdown';

describe('isLocalImageSrc', () => {
  it.each([
    ['/logo.png', true],
    ['data:image/png;base64,AAAA', true],
    ['https://evil.example/p.png?d=secret', false],
    [`/${String.fromCharCode(92)}evil.example/p.png`, false],
    [`/${String.fromCharCode(92)}evil.example/p.png`, false],
    ['data:image/svg+xml;base64,AAAA', false],
    ['javascript:alert(1)', false],
    ['', false],
  ])('%s -> %s', (src, expected) => {
    expect(isLocalImageSrc(src)).toBe(expected);
  });
});
