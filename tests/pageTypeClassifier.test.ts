import { describe, it, expect } from 'vitest';
import {
  classifyPageType,
  extractInternalLinks,
  prioritizeUrls,
} from '../services/scraping/pageTypeClassifier';

describe('pageTypeClassifier', () => {
  it('classifies common SEO page types from path', () => {
    expect(classifyPageType('https://example.com/')).toBe('home');
    expect(classifyPageType('https://example.com/about-us')).toBe('about');
    expect(classifyPageType('https://example.com/pricing')).toBe('pricing');
    expect(classifyPageType('https://example.com/faq')).toBe('faq');
    expect(classifyPageType('https://example.com/locations/sydney')).toBe('location');
    expect(classifyPageType('https://example.com/privacy-policy')).toBe('legal');
    expect(classifyPageType('https://example.com/blog/hello')).toBe('blog');
    expect(classifyPageType('https://example.com/products/widget')).toBe('product');
  });

  it('prioritizes diverse page types under budget', () => {
    const selected = prioritizeUrls('https://example.com', [
      { url: 'https://example.com/blog/1' },
      { url: 'https://example.com/blog/2' },
      { url: 'https://example.com/blog/3' },
      { url: 'https://example.com/about' },
      { url: 'https://example.com/faq' },
      { url: 'https://example.com/products/a' },
      { url: 'https://evil.com/phishing' },
    ], { maxPages: 5 });

    expect(selected[0].pageType).toBe('home');
    expect(selected.some((s) => s.pageType === 'about')).toBe(true);
    expect(selected.some((s) => s.url.includes('evil.com'))).toBe(false);
    expect(selected.filter((s) => s.pageType === 'blog').length).toBeLessThanOrEqual(2);
    expect(selected.length).toBeLessThanOrEqual(5);
  });

  it('extracts same-host links from HTML', () => {
    const html = `
      <a href="/about">About</a>
      <a href="https://example.com/faq">FAQ</a>
      <a href="https://other.com/x">External</a>
      <a href="/logo.png">Image</a>
    `;
    const links = extractInternalLinks(html, 'https://example.com');
    expect(links).toContain('https://example.com/about');
    expect(links).toContain('https://example.com/faq');
    expect(links.some((l) => l.includes('other.com'))).toBe(false);
    expect(links.some((l) => l.endsWith('.png'))).toBe(false);
  });
});
