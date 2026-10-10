import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_SCHEDULED_JOBS, DAILY_CRON, isCronMapped, jobsForCron } from '../worker/scheduledJobs';

/** Every expression listed under a `"crons": [...]` key in wrangler.jsonc (top level and per env). */
function configuredCrons(): string[] {
  const text = readFileSync(resolve(__dirname, '..', 'wrangler.jsonc'), 'utf8');
  const found: string[] = [];
  for (const block of text.matchAll(/"crons"\s*:\s*\[([^\]]*)\]/g)) {
    for (const expr of block[1].matchAll(/"([^"]+)"/g)) found.push(expr[1]);
  }
  return found;
}

describe('jobsForCron', () => {
  it('runs Sentinel, the privacy purge, and the domain re-check on the daily cron', () => {
    expect(DAILY_CRON).toBe('0 8 * * *');
    expect(isCronMapped('0 8 * * *')).toBe(true);
    expect(jobsForCron('0 8 * * *')).toEqual(['sentinel', 'privacy_purge', 'domain_recheck']);
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(jobsForCron('  0  8 * * * ')).toEqual(['sentinel', 'privacy_purge', 'domain_recheck']);
  });

  it.each([
    ['a future anchor drainer cron', '*/5 * * * *'],
    ['another daily time', '0 9 * * *'],
    ['an empty string', ''],
    ['an object prototype key', 'constructor'],
  ])('runs no job for %s, flagged as unmapped', (_label, cron) => {
    expect(isCronMapped(cron)).toBe(false);
    expect(jobsForCron(cron)).toEqual([]);
  });

  it('gives every known job an owner among the configured crons, now that an unmapped cron runs none', () => {
    const owned = new Set(configuredCrons().flatMap((cron) => jobsForCron(cron)));
    expect([...owned].sort()).toEqual([...ALL_SCHEDULED_JOBS].sort());
  });

  it('returns a fresh array so callers cannot mutate the mapping', () => {
    jobsForCron(DAILY_CRON).push('sentinel');
    expect(jobsForCron(DAILY_CRON)).toEqual(['sentinel', 'privacy_purge', 'domain_recheck']);
  });

  it('gives every cron configured in wrangler.jsonc an explicit map entry', () => {
    const crons = configuredCrons();
    expect(crons).toContain(DAILY_CRON);
    for (const cron of crons) expect(isCronMapped(cron), `cron "${cron}" has no explicit map entry`).toBe(true);
  });
});
