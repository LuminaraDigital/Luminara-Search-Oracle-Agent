#!/usr/bin/env node
/**
 * Luminara Suite - License Key Generator & Vault Manager
 *
 * Generates formatted, cryptographically random license keys for:
 * - 3-day Growth Sprint trial passes
 * - 7-day VIP / Partner passes
 * - 30-day Starter, Growth, and Pro/Agency plans
 * - 365-day Annual Enterprise subscriptions
 *
 * Usage:
 *   node scripts/generate-license-keys.mjs
 *   node scripts/generate-license-keys.mjs --plan=growth --days=3 --count=10
 *   node scripts/generate-license-keys.mjs --plan=agency --days=30 --count=5 --export=keys.json
 */

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

function randomChars(len = 4) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Base32 unambiguous charset (no 0, O, 1, I)
  const bytes = randomBytes(len);
  let str = '';
  for (let i = 0; i < len; i++) {
    str += chars[bytes[i] % chars.length];
  }
  return str;
}

export function generateKey(plan, durationDays) {
  const normPlan = String(plan || 'growth').toLowerCase().trim();
  const tag = normPlan === 'agency' ? 'PRO' : normPlan.toUpperCase().slice(0, 7);
  const p1 = randomChars(4);
  const p2 = randomChars(4);
  return `LUM-${tag}-${durationDays}D-${p1}-${p2}`;
}

export function generateBatch(plan, durationDays, count, campaign = 'direct_mint') {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const key = generateKey(plan, durationDays);
    keys.push({
      key,
      plan,
      durationDays,
      isTrial: durationDays <= 7,
      campaign,
      createdAt: new Date().toISOString(),
    });
  }
  return keys;
}

// CLI execution
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/')) || process.argv[1]?.includes('generate-license-keys')) {
  const args = Object.fromEntries(
    process.argv.slice(2).map(arg => {
      const [k, v] = arg.replace(/^--/, '').split('=');
      return [k, v ?? true];
    })
  );

  const plan = args.plan || 'growth';
  const days = parseInt(args.days || '3', 10);
  const count = parseInt(args.count || '10', 10);
  const campaign = args.campaign || 'cli_mint';

  console.log(`\n🔑 Luminara License Key Generator`);
  console.log(`---------------------------------`);
  console.log(`Plan: ${plan.toUpperCase()} | Duration: ${days} days | Count: ${count}\n`);

  const keys = generateBatch(plan, days, count, campaign);
  keys.forEach((k, idx) => {
    console.log(`${String(idx + 1).padStart(2, ' ')}. ${k.key}`);
  });

  if (args.export) {
    writeFileSync(String(args.export), JSON.stringify(keys, null, 2), 'utf-8');
    console.log(`\n💾 Exported ${count} keys to ${args.export}`);
  }
  console.log('\n');
}
