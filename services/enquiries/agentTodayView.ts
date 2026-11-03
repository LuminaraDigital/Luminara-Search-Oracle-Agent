/**
 * Pure helpers for the agent Today view: contact links, calendar links and plain-English text.
 * The app never sends a message itself, so every link here only opens the agent's own phone or mail app.
 */
import type { AgentToday } from './agentToday';

type Contact = { name: string; phone: string | null; email: string | null };
type Appraisal = Contact & { address: string | null; startAt: number; endAt: number };

function phoneDigits(phone: string | null): string | null {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  return digits.length >= 6 ? digits : null;
}

export function telLink(phone: string | null): string | null {
  const digits = phoneDigits(phone);
  return digits ? `tel:${digits}` : null;
}

export function smsLink(phone: string | null): string | null {
  const digits = phoneDigits(phone);
  return digits ? `sms:${digits}` : null;
}

export function mailLink(email: string | null): string | null {
  const trimmed = (email ?? '').trim();
  return /^[^\s@?&#%]+@[^\s@?&#%]+\.[^\s@?&#%]+$/.test(trimmed) ? `mailto:${trimmed}` : null;
}

function icsStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
}

function appraisalTitle(a: Pick<Appraisal, 'name'>): string {
  return `Appraisal: ${a.name}`;
}

/** Google Calendar "add event" link. Opens a pre-filled form, no sign-in needed here. */
export function googleCalendarLink(a: Appraisal): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: appraisalTitle(a),
    dates: `${icsStamp(a.startAt)}/${icsStamp(a.endAt)}`,
    location: a.address ?? '',
    details: [a.phone, a.email].filter(Boolean).join('\n'),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** .ics file as a data URL, for Apple and Outlook calendars. */
export function icsDataUrl(a: Appraisal & { appointmentId: string }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Luminara Suite//Agent Today//EN',
    'BEGIN:VEVENT',
    `UID:${a.appointmentId}@luminara.digital`,
    `DTSTAMP:${icsStamp(a.startAt)}`,
    `DTSTART:${icsStamp(a.startAt)}`,
    `DTEND:${icsStamp(a.endAt)}`,
    `SUMMARY:${icsEscape(appraisalTitle(a))}`,
    `LOCATION:${icsEscape(a.address ?? '')}`,
    `DESCRIPTION:${icsEscape([a.phone, a.email].filter(Boolean).join('\n'))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

export function waitingText(count: number): string {
  return count === 1 ? '1 person is waiting for your sign-off' : `${count} people are waiting for your sign-off`;
}

export function scorecardIsEmpty(scorecard: AgentToday['scorecard']): boolean {
  return scorecard.segments.every((s) => s.enquiries + s.qualified + s.appraisalsBooked === 0);
}

const TZ = 'Australia/Melbourne';
const DAY = { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' } as const;
const dayText = (ms: number) => new Date(ms).toLocaleDateString('en-AU', DAY).replace(',', '');

/** "Thu 6 Nov, 3:00 pm" in Melbourne time, whatever the device time zone is. */
export function formatWhen(ms: number): string {
  const day = dayText(ms);
  const time = new Date(ms).toLocaleTimeString('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
  return `${day}, ${time.toLowerCase()}`;
}

/** "Tue 28 Oct to Mon 3 Nov" */
export function formatRange(since: number, until: number): string {
  return `${dayText(since)} to ${dayText(until)}`;
}

const SEGMENT_TAGS: Record<string, string> = {
  seller_appraisal: 'Seller',
  buyer_enquiry: 'Buyer',
  landlord_management: 'Landlord',
};

export function segmentTag(segment: string): string {
  return SEGMENT_TAGS[segment] ?? 'Other enquiry';
}

type Counts = { enquiries: number; qualified: number; appraisalsBooked: number };

export function scorecardLine(s: Counts): string {
  const enquiries = s.enquiries === 1 ? '1 new enquiry' : `${s.enquiries} new enquiries`;
  const booked = s.appraisalsBooked === 1 ? '1 appraisal booked' : `${s.appraisalsBooked} appraisals booked`;
  return `${enquiries} \u00b7 ${s.qualified} ready for an appraisal \u00b7 ${booked}`;
}
