/**
 * Weekly email digest copy and send window (spec 0031). Pure: no D1, no fetch.
 * Every figure reaches the email through readingText, which attaches Measured, Estimated or
 * Not measured. Nothing here blends readings into a score.
 */
import { parseMeasuredCheckLine, scoreLine } from '../services/agentCore/auditEvidenceGate';
import { isoWeekKey } from '../services/referrals/rules';
import { clipPlain } from '../utils/clipPlain';
import { renderEmailShell, type EmailBlock } from './welcomeEmail';

export const DIGEST_FALLBACK_TZ = 'Australia/Sydney';
/** Monday is the send day. Tuesday and Wednesday catch up a definite failure or the daily cap. */
const DIGEST_DAYS = new Set(['Mon', 'Tue', 'Wed']);

/** `note` is a part of the reading that the label does not cover, such as checks that were not measured. */
export type Reading = { status: 'measured' | 'estimated'; phrase: string; note?: string } | { status: 'not_measured' };

const NOT_MEASURED: Reading = { status: 'not_measured' };
const LABEL = { measured: 'Measured', estimated: 'Estimated' } as const;
const ENGINE_NAME: Record<string, string> = {
  chatgpt: 'ChatGPT',
  google_aio: 'Google AI Overviews',
  perplexity: 'Perplexity',
};

export type DigestFix = { domain: string; title: string };

export type DigestMove =
  | { kind: 'site_checks'; domain: string; now: Reading; before: Reading | null }
  | { kind: 'citations'; domain: string; engine: string; now: Reading; before: Reading | null };

export type DigestKind = 'update' | 'quiet';

export type DigestInput = {
  greetingName: string | null;
  fix: DigestFix | null;
  moves: DigestMove[];
  /** Kind of the last digest actually sent to this user, or null. */
  lastSentKind: DigestKind | null;
};

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function digestTimeZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? timeZone : DIGEST_FALLBACK_TZ;
}

/** Whether a fire at `at` falls on a send day in the zone, and the local ISO week it belongs to. */
export function digestSchedule(at: number, timeZone: string): { due: boolean; weekKey: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const localDate = new Date(Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day'))));
  return { due: DIGEST_DAYS.has(part('weekday')), weekKey: isoWeekKey(localDate) };
}

/** Site checks from a saved report, by the report page's rule: a clean pass the text cannot prove stays Not measured. */
export function checkReading(reportText: string): Reading {
  const counts = parseMeasuredCheckLine(reportText);
  if (!counts || scoreLine(reportText, false) === 'Not measured') return NOT_MEASURED;
  const phrase = `${counts.passed} of ${counts.total} checks passed${counts.failed ? `, ${counts.failed} failed` : ''}`;
  return counts.unmeasured
    ? { status: 'measured', phrase, note: `${counts.unmeasured} not measured` }
    : { status: 'measured', phrase };
}

/** A Citation Watch run. Counts count only on a measured run with a sane cited-of-prompts pair. */
export function citationReading(run: {
  measurement_status: string;
  cited_count: number | null;
  prompt_count: number | null;
}): Reading {
  const cited = run.cited_count;
  const prompts = run.prompt_count;
  if (run.measurement_status !== 'measured' || cited == null || prompts == null) return NOT_MEASURED;
  if (!Number.isInteger(cited) || !Number.isInteger(prompts) || prompts < 1 || cited < 0 || cited > prompts) return NOT_MEASURED;
  return { status: 'measured', phrase: `cited in ${cited} of ${prompts} ${prompts === 1 ? 'prompt' : 'prompts'}` };
}

export function readingText(reading: Reading): string {
  if (reading.status === 'not_measured') return 'Not measured';
  const labelled = `${reading.phrase} (${LABEL[reading.status]})`;
  return reading.note ? `${labelled}, ${reading.note}` : labelled;
}

export function moveLine(move: DigestMove): string {
  const subject = move.kind === 'site_checks'
    ? `Site checks on ${move.domain}`
    : `${ENGINE_NAME[move.engine] || move.engine} citations for ${move.domain}`;
  const before = move.before ? `Before this week: ${readingText(move.before)}.` : 'Nothing earlier to compare.';
  return `${subject}: ${readingText(move.now)}. ${before}`;
}

/** `update` when something moved, one `quiet` email for a waiting fix, otherwise skip the week (null). */
export function digestKind(input: DigestInput): DigestKind | null {
  if (input.moves.length) return 'update';
  if (input.fix && input.lastSentKind !== 'quiet') return 'quiet';
  return null;
}

const QUIET_LINE = 'Nothing new was recorded on your account this week: no saved audit and no active Citation Watch run in the last seven days.';
const HONESTY_NOTE = 'Every number here says how we got it: Measured, Estimated, or Not measured. We never blend them into one score.';

/**
 * The fix title is audit text and may hold a figure with no label, so a title with a digit is not
 * quoted. The domain is printed as written.
 */
function fixLine(fix: DigestFix | null): string {
  if (!fix) return 'No open fix on your Fix Board. Run an audit to find the next one.';
  const title = clipPlain(fix.title, 160).replace(/[.\s]+$/, '');
  if (!title || /\d/.test(title)) return `Your top fix for ${fix.domain} is waiting on your Fix Board.`;
  return `${title} on ${fix.domain}.`;
}

function digestSubject(kind: DigestKind, hasFix: boolean): string {
  if (kind === 'quiet') return 'Your week in AI search: nothing new recorded, one fix waiting';
  return hasFix ? 'Your week in AI search: what moved and your next fix' : 'Your week in AI search: what moved';
}

export function renderDigestEmail(
  input: DigestInput,
  kind: DigestKind,
  links: { unsubscribeHref: string; fixBoardHref: string },
): { html: string; text: string; subject: string } {
  const hello = input.greetingName ? `Hello ${input.greetingName},` : 'Hello,';
  const moved: EmailBlock[] = kind === 'quiet'
    ? [{ kind: 'text', text: QUIET_LINE }]
    : input.moves.map((move) => ({ kind: 'text', text: moveLine(move) }));
  return renderEmailShell({
    subject: digestSubject(kind, Boolean(input.fix)),
    preheader: input.fix ? `Next fix: ${fixLine(input.fix)}` : 'What moved in the last seven days.',
    heading: 'Your week.',
    blocks: [
      { kind: 'text', text: `${hello} here is your weekly Luminara Suite digest: the one fix to do next and what moved in the last seven days.` },
      { kind: 'heading', text: 'Your next fix' },
      { kind: 'text', text: fixLine(input.fix) },
      { kind: 'heading', text: 'What moved' },
      ...moved,
      { kind: 'note', text: HONESTY_NOTE },
    ],
    button: { label: 'Open your Fix Board', href: links.fixBoardHref },
    unsubscribeHref: links.unsubscribeHref,
  });
}
