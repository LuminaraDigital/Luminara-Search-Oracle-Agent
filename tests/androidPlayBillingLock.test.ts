import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'apps/android';

const FORBIDDEN = [
  /com\.android\.vending\.BILLING/i,
  /billingclient/i,
  /com\.stripe/i,
  /stripe-android/i,
  /create-checkout-session/i,
  /checkout\.stripe\.com/i,
  /\/pricing\b/i,
  /play\.google\.com/i,
];

const TEXT = /\.(kt|kts|xml|toml|properties|pro|md|gradle)$/;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'build' || name === '.gradle') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...filesUnder(path));
    else if (TEXT.test(path)) out.push(path);
  }
  return out;
}

describe('Android Play billing lock', () => {
  it('ships no Play Billing library, Stripe SDK, or checkout link', () => {
    const hits: string[] = [];
    for (const path of filesUnder(ROOT)) {
      const text = readFileSync(path, 'utf8');
      const inMain = !path.includes('/src/test/') && !path.includes('/src/androidTest/');
      for (const pattern of FORBIDDEN) {
        // Tests name /pricing only to prove share links reject it. Main source still cannot.
        if (pattern.source.includes('pricing') && !inMain) continue;
        if (pattern.test(text)) hits.push(`${path} matches ${pattern}`);
      }
      if (path.endsWith('.kt') && text.includes('Upgrade')) hits.push(`${path} contains Upgrade`);
    }
    expect(hits).toEqual([]);
  });
});
