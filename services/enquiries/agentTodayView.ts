/**
 * Pure helpers for the agent Today view: contact links, calendar links and plain-English text.
 * The app never sends a message itself, so every link here only opens the agent's own phone or mail app.
 */
import type { AgentToday } from './agentToday';

type Contact = { name: string; phone: string | null; email: string | null };
type Appraisal = Contact & { address: string | null; startAt: number; endAt: number };

export function telLink(phone: string | null): string | null {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  return digits.length >= 6 ? `tel:${digits}` : null;
}

export function smsLink(phone: string | null): string | null {
  const tel = telLink(phone);
  return tel ? `sms:${tel.slice(4)}` : null;
}

export function mailLink(email: string | null): string | null {
  const trimmed = (email ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? `mailto:${trimmed}` : null;
}

function icsStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
}

export function appraisalTitle(a: Pick<Appraisal, 'name'>): string {
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

export function waitingCount(today: Pick<AgentToday, 'needsSignOff'>): number {
  return today.needsSignOff.length;
}

export function waitingText(count: number): string {
  return count === 1 ? '1 person is waiting for your sign-off' : `${count} people are waiting for your sign-off`;
}

export function scorecardIsEmpty(scorecard: AgentToday['scorecard']): boolean {
  return scorecard.segments.every((s) => s.enquiries + s.qualified + s.appraisalsBooked === 0);
}

export function formatWhen(startAt: number, locale = 'en-AU'): string {
  return new Date(startAt).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
