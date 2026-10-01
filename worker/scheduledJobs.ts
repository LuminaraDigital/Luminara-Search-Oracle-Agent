/**
 * Cron dispatch for the Worker's scheduled() handler.
 * Each expression in wrangler.jsonc `triggers.crons` maps to the jobs it owns, so adding a cron
 * for a new job never re-runs the others. Keep CRON_JOBS in step with wrangler.jsonc.
 */

export type ScheduledJobName = 'sentinel' | 'privacy_purge';

/** Daily 08:00 UTC: Drift Sentinel scan and the expired privacy-delete purge. */
export const DAILY_CRON = '0 8 * * *';

const CRON_JOBS: Record<string, readonly ScheduledJobName[]> = {
  [DAILY_CRON]: ['sentinel', 'privacy_purge'],
};

/** Jobs owned by a cron expression. An unknown expression owns none (the caller logs it). */
export function jobsForCron(cron: string): ScheduledJobName[] {
  const key = String(cron || '').trim().replace(/\s+/g, ' ');
  return Object.hasOwn(CRON_JOBS, key) ? [...CRON_JOBS[key]] : [];
}
