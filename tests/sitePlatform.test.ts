import { describe, expect, it } from 'vitest';
import { detectSitePlatform } from '../services/audit/sitePlatform';

describe('detectSitePlatform', () => {
  const none = new Headers();

  it.each([
    ['<img src="https://static.wixstatic.com/media/a.png">', 'wix'],
    ['<script src="https://cdn.shopify.com/s/a.js"></script>', 'shopify'],
    ['<link href="https://static1.squarespace.com/static/a.css">', 'squarespace'],
    ['<html data-wf-site="abc">', 'webflow'],
    ['<link href="/wp-content/themes/a/style.css">', 'wordpress'],
    ['<meta name="generator" content="WordPress 6.8">', 'wordpress'],
    ['<p>Hello</p>', 'other'],
  ])('reads %s', (html, platform) => {
    expect(detectSitePlatform(html, none)).toBe(platform);
  });

  it('reads a platform header when the HTML has no sign', () => {
    expect(detectSitePlatform('<p>Hello</p>', new Headers({ 'x-wix-request-id': '1' }))).toBe('wix');
  });

  it('prefers the builder over a WordPress mention in page content', () => {
    expect(detectSitePlatform('<html data-wf-site="a"><a href="/wp-content/">old</a>', none)).toBe('webflow');
  });
});
