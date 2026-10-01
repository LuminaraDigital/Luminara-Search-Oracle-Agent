/**
 * Cron dispatch for the Worker's scheduled() handler.
 * Each expression in wrangler.jsonc `triggers.crons` maps to the jobs it owns, so adding a cron
 * for a new job never re-runs the others. Keep CRON_JOBS in step with wrangler.jsonc.
 * An unmapped expression runs every job (the behaviour before dispatch existed), so a renamed
 * cron cannot silently stop Sentinel or the privacy purge; a cron that should run fewer jobs
 * must be mapped here explicitly.
 */

export type ScheduledJobName = 'sentinel' | 'privacy_purge';

export const ALL_SCHEDULED_JOBS: readonly ScheduledJobName[] = ['sentinel', 'privacy_purge'];

/** Daily 08:00 UTC: Drift Sentinel scan and the expired privacy-delete purge. */
export const DAILY_CRON = '0 8 * * *';

const CRON_JOBS: Record<string, readonly ScheduledJobName[]> = {
  [DAILY_CRON]: ['sentinel', 'privacy_purge'],
};

function cronKey(cron: string): string {
  return String(cron || '').trim().replace(/\s+/g, ' ');
}

/** True when the expression has an explicit entry in CRON_JOBS. */
export function isCronMapped(cron: string): boolean {
  return Object.hasOwn(CRON_JOBS, cronKey(cron));
}

/** Jobs owned by a cron expression. An unmapped expression gets every job (the caller logs it). */
export function jobsForCron(cron: string): ScheduledJobName[] {
  return isCronMapped(cron) ? [...CRON_JOBS[cronKey(cron)]] : [...ALL_SCHEDULED_JOBS];
}
