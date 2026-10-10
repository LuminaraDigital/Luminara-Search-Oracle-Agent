/**
 * Cron dispatch for the Worker's scheduled() handler.
 * Each expression in wrangler.jsonc `triggers.crons` maps to the jobs it owns, so adding a cron
 * for a new job never re-runs the others. Keep CRON_JOBS in step with wrangler.jsonc.
 * An unmapped expression runs no job, and the scheduled() handler reports it as an error. A
 * rollback to this code under a newer cron trigger must not run every job on the new cadence,
 * so a new cron and its CRON_JOBS entry ship in the same pull request (plan rule 2.20).
 */

export type ScheduledJobName = 'sentinel' | 'privacy_purge' | 'domain_recheck';

export const ALL_SCHEDULED_JOBS: readonly ScheduledJobName[] = ['sentinel', 'privacy_purge', 'domain_recheck'];

/**
 * Daily 08:00 UTC: Drift Sentinel scan, the expired privacy-delete purge, and the
 * Trust Network domain re-check (each verified domain is re-checked every 7 days).
 */
export const DAILY_CRON = '0 8 * * *';

const CRON_JOBS: Record<string, readonly ScheduledJobName[]> = {
  [DAILY_CRON]: ['sentinel', 'privacy_purge', 'domain_recheck'],
};

function cronKey(cron: string): string {
  return String(cron || '').trim().replace(/\s+/g, ' ');
}

/** True when the expression has an explicit entry in CRON_JOBS. */
export function isCronMapped(cron: string): boolean {
  return Object.hasOwn(CRON_JOBS, cronKey(cron));
}

/** Jobs owned by a cron expression. An unmapped expression gets none (the caller reports it). */
export function jobsForCron(cron: string): ScheduledJobName[] {
  return isCronMapped(cron) ? [...CRON_JOBS[cronKey(cron)]] : [];
}
