import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAILY_CRON, jobsForCron } from '../worker/scheduledJobs';

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
  it('runs Sentinel and the privacy purge on the daily cron, as before', () => {
    expect(DAILY_CRON).toBe('0 8 * * *');
    expect(jobsForCron('0 8 * * *')).toEqual(['sentinel', 'privacy_purge']);
  });

  it('tolerates surrounding and repeated whitespace', () => {
    expect(jobsForCron('  0  8 * * * ')).toEqual(['sentinel', 'privacy_purge']);
  });

  it.each([
    ['a future anchor drainer cron', '*/5 * * * *'],
    ['another daily time', '0 9 * * *'],
    ['an empty string', ''],
    ['an object prototype key', 'constructor'],
  ])('runs nothing for %s', (_label, cron) => {
    expect(jobsForCron(cron)).toEqual([]);
  });

  it('returns a fresh array so callers cannot mutate the mapping', () => {
    jobsForCron(DAILY_CRON).push('sentinel');
    expect(jobsForCron(DAILY_CRON)).toEqual(['sentinel', 'privacy_purge']);
  });

  it('maps every cron configured in wrangler.jsonc to at least one job', () => {
    const crons = configuredCrons();
    expect(crons).toContain(DAILY_CRON);
    for (const cron of crons) expect(jobsForCron(cron), `cron "${cron}" has no jobs`).not.toEqual([]);
  });
});
