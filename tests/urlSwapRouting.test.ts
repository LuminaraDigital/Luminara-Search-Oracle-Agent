import { describe, it, expect } from 'vitest';
import { parseUrlSwapRoute } from '../utils/urlSwapRouting';
import { AppView } from '../types';

describe('URL-Swap Route Parser (parseUrlSwapRoute)', () => {
  it('parses /audit/:domain and maps to AppView.INSTANT_AUDIT with AEO focus', () => {
    const route = parseUrlSwapRoute('/audit/stripe.com');
    expect(route).toEqual({
      view: AppView.INSTANT_AUDIT,
      targetUrl: 'stripe.com',
      focus: 'AEO',
    });
  });

  it('parses /geo/:target and sets focus to GEO', () => {
    const route = parseUrlSwapRoute('/geo/github.com/facebook/react');
    expect(route).toEqual({
      view: AppView.INSTANT_AUDIT,
      targetUrl: 'github.com/facebook/react',
      focus: 'GEO',
    });
  });

  it('parses /seo/:target and sets focus to SEO', () => {
    const route = parseUrlSwapRoute('/seo/example.com');
    expect(route).toEqual({
      view: AppView.INSTANT_AUDIT,
      targetUrl: 'example.com',
      focus: 'SEO',
    });
  });

  it('parses /aeo/:target with full protocol encoding', () => {
    const route = parseUrlSwapRoute('/aeo/https%3A%2F%2Fluminaradigital.io');
    expect(route).toEqual({
      view: AppView.INSTANT_AUDIT,
      targetUrl: 'https://luminaradigital.io',
      focus: 'AEO',
    });
  });

  it('handles /audit with no target specified', () => {
    const route = parseUrlSwapRoute('/audit');
    expect(route).toEqual({
      view: AppView.INSTANT_AUDIT,
      targetUrl: undefined,
      focus: 'AEO',
    });
  });

  it('returns null for non-audit application routes', () => {
    expect(parseUrlSwapRoute('/dashboard')).toBeNull();
    expect(parseUrlSwapRoute('/privacy')).toBeNull();
    expect(parseUrlSwapRoute('/terms')).toBeNull();
    expect(parseUrlSwapRoute('')).toBeNull();
  });
});
