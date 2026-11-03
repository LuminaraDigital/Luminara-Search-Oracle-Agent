import { describe, expect, it } from 'vitest';
import {
  googleCalendarLink,
  icsDataUrl,
  mailLink,
  scorecardIsEmpty,
  smsLink,
  telLink,
  waitingText,
} from '../services/enquiries/agentTodayView';

const appraisal = {
  appointmentId: 'apt_1',
  name: 'Sam Owner',
  phone: '+61 412 345 678',
  email: 'sam@example.com.au',
  address: '12 Example St, Richmond VIC 3121',
  startAt: Date.UTC(2026, 10, 5, 0, 30),
  endAt: Date.UTC(2026, 10, 5, 1, 0),
};

describe('agent Today helpers', () => {
  it('builds tel, sms and mail links only from usable contact details', () => {
    expect(telLink('+61 412 345 678')).toBe('tel:+61412345678');
    expect(smsLink('+61 412 345 678')).toBe('sms:+61412345678');
    expect(telLink(null)).toBeNull();
    expect(telLink('12')).toBeNull();
    expect(mailLink('sam@example.com.au')).toBe('mailto:sam@example.com.au');
    expect(mailLink('not an email')).toBeNull();
  });

  it('builds a Google Calendar link with the real start and end', () => {
    const url = new URL(googleCalendarLink(appraisal));
    expect(url.searchParams.get('dates')).toBe('20261105T003000Z/20261105T010000Z');
    expect(url.searchParams.get('text')).toBe('Appraisal: Sam Owner');
    expect(url.searchParams.get('location')).toBe(appraisal.address);
  });

  it('builds an .ics data URL', () => {
    const ics = decodeURIComponent(icsDataUrl(appraisal).split(',')[1]);
    expect(ics).toContain('DTSTART:20261105T003000Z');
    expect(ics).toContain('SUMMARY:Appraisal: Sam Owner');
    expect(ics).toContain('LOCATION:12 Example St\\, Richmond VIC 3121');
  });

  it('words the waiting count and detects an empty scorecard', () => {
    expect(waitingText(1)).toBe('1 person is waiting for your sign-off');
    expect(waitingText(3)).toBe('3 people are waiting for your sign-off');
    const zero = { since: 0, until: 1, segments: [{ segment: 'seller_appraisal' as const, label: 'Sellers', enquiries: 0, qualified: 0, appraisalsBooked: 0 }] };
    expect(scorecardIsEmpty(zero)).toBe(true);
    expect(scorecardIsEmpty({ ...zero, segments: [{ ...zero.segments[0], enquiries: 2 }] })).toBe(false);
  });
});
