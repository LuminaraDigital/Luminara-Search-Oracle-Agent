/**
 * Copy for the weekly visibility email. It only restates signals the homepage read produced.
 */

import type { ProfileSignal, PublicProfileReport } from './publicProfileMatch';

export type WeeklySnapshot = {
  domain: string;
  readAt: number;
  pageRead: boolean;
  hasRealEstateAgent: boolean | null;
  name: ProfileSignal;
  phone: ProfileSignal;
  address: ProfileSignal;
  serviceArea: ProfileSignal;
  nextFix: string | null;
};

export type WeeklyDomainMail = {
  domain: string;
  pageRead: boolean;
  failure: string | null;
  lines: string[];
  changes: string[];
  nextFix: string | null;
  savedAuditAt: number | null;
  savedAuditSummary: string | null;
};

const SIGNALS: readonly ProfileSignal[] = ['match', 'mismatch', 'missing', 'not_measured'];

function isSignal(value: unknown): value is ProfileSignal {
  return typeof value === 'string' && (SIGNALS as readonly string[]).includes(value);
}

export function parseWeeklySnapshot(raw: unknown): WeeklySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.domain !== 'string' || !row.domain.trim()) return null;
  if (typeof row.readAt !== 'number' || !Number.isFinite(row.readAt)) return null;
  if (typeof row.pageRead !== 'boolean') return null;
  if (!(row.hasRealEstateAgent === null || typeof row.hasRealEstateAgent === 'boolean')) return null;
  if (!isSignal(row.name) || !isSignal(row.phone) || !isSignal(row.address) || !isSignal(row.serviceArea)) return null;
  if (!(row.nextFix === null || typeof row.nextFix === 'string')) return null;
  return {
    domain: row.domain,
    readAt: row.readAt,
    pageRead: row.pageRead,
    hasRealEstateAgent: row.hasRealEstateAgent,
    name: row.name,
    phone: row.phone,
    address: row.address,
    serviceArea: row.serviceArea,
    nextFix: row.nextFix,
  };
}

export function snapshotFromReport(domain: string, readAt: number, report: PublicProfileReport): WeeklySnapshot {
  return {
    domain,
    readAt,
    pageRead: true,
    hasRealEstateAgent: report.signals.hasRealEstateAgent,
    name: report.signals.name,
    phone: report.signals.phone,
    address: report.signals.address,
    serviceArea: report.signals.serviceArea,
    nextFix: report.nextFix,
  };
}

function signalWord(signal: ProfileSignal): string {
  if (signal === 'match') return 'matched the page';
  if (signal === 'mismatch') return 'did not match the page';
  if (signal === 'missing') return 'was missing';
  return 'was not measured';
}

export function diffWeekly(previous: WeeklySnapshot | null, current: WeeklySnapshot): string[] {
  if (!current.pageRead) return ['This homepage was not re-read, so a change is not measured.'];
  if (!previous || !previous.pageRead) return ['No earlier weekly read, so a change is not measured.'];
  const changes: string[] = [];
  if (previous.hasRealEstateAgent !== null && current.hasRealEstateAgent !== null && previous.hasRealEstateAgent !== current.hasRealEstateAgent) {
    changes.push(
      current.hasRealEstateAgent
        ? 'RealEstateAgent schema: it was missing, and this read found it.'
        : 'RealEstateAgent schema: the last read found it, and this read did not.',
    );
  }
  const fields: Array<[keyof Pick<WeeklySnapshot, 'name' | 'phone' | 'address' | 'serviceArea'>, string]> = [
    ['name', 'Agency name'],
    ['phone', 'Phone'],
    ['address', 'Address'],
    ['serviceArea', 'Service area'],
  ];
  for (const [key, label] of fields) {
    const before = previous[key];
    const after = current[key];
    if (before === 'not_measured' || after === 'not_measured' || before === after) continue;
    changes.push(`${label}: last week it ${signalWord(before)}. This week it ${signalWord(after)}.`);
  }
  return changes.length ? changes : ['Nothing we re-read changed.'];
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function renderWeeklyEmail(input: {
  greetingName: string | null;
  domains: WeeklyDomainMail[];
  unsubscribeHref: string;
  legalFooter: string;
  auditUrl: string;
}): { subject: string; text: string; html: string } {
  const subject = input.domains.length === 1
    ? `Weekly visibility read: ${input.domains[0].domain.replace(/[\r\n]/g, ' ').trim().slice(0, 80)}`
    : 'Weekly visibility read';
  const hello = input.greetingName ? `Hello ${input.greetingName},` : 'Hello,';
  const intro = [
    hello,
    '',
    'This week we re-read the public homepage of your saved audit. The full audit crew did not run.',
    'Estimated: none. This read does not estimate rankings or AI citations.',
    'Google Business Profile was not checked through Google. That API needs Google approval and was not called.',
  ];
  const blocks: string[] = [];
  for (const domain of input.domains) {
    const lines = [`${domain.domain}`, ''];
    if (!domain.pageRead) {
      lines.push(`Not measured. ${domain.failure || 'This homepage was not re-read.'}`);
    } else {
      lines.push(...domain.lines);
    }
    lines.push('', 'What changed:');
    for (const change of domain.changes) lines.push(`- ${change}`);
    if (domain.nextFix) lines.push('', `One next fix: ${domain.nextFix}`);
    if (domain.savedAuditAt && domain.savedAuditSummary) {
      lines.push('', `From your saved audit on ${utcDay(domain.savedAuditAt)} (not re-run in full this week): ${domain.savedAuditSummary}`);
    }
    blocks.push(lines.join('\n'));
  }
  const text = [
    subject,
    '',
    ...intro,
    '',
    blocks.join('\n\n'),
    '',
    `Open your audit: ${input.auditUrl}`,
    '',
    input.legalFooter,
    '',
    `Unsubscribe: ${input.unsubscribeHref}`,
  ].join('\n');

  const htmlBlocks = blocks.map((block) => `<p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#f7f3ea;white-space:pre-wrap;margin:0 0 16px 0;">${esc(block)}</p>`);
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#0a0a0a;color:#f7f3ea;">
<div style="max-width:560px;margin:0 auto;padding:24px;">
<p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;white-space:pre-wrap;">${esc(intro.join('\n'))}</p>
${htmlBlocks.join('\n')}
<p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;"><a href="${esc(input.auditUrl)}" style="color:#f0d78c;">Open your audit</a></p>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#c8c2b4;">${esc(input.legalFooter)}</p>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;"><a href="${esc(input.unsubscribeHref)}" style="color:#c8c2b4;">Unsubscribe</a></p>
</div>
</body>
</html>`;
  return { subject, text, html };
}
