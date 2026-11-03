import { describe, expect, it } from 'vitest';
import {
  formatRange,
  formatWhen,
  googleCalendarLink,
  icsDataUrl,
  mailLink,
  scorecardIsEmpty,
  scorecardLine,
  segmentTag,
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

  it('rejects emails that could inject mailto parameters', () => {
    for (const bad of ['a@b.com?bcc=x@y.com', 'a@b.com&body=hi', 'a@b.com#x', 'a%40b@c.com', 'a b@c.com']) {
      expect(mailLink(bad)).toBeNull();
    }
  });

  it('rejects phone numbers that are too short once stripped', () => {
    expect(telLink('12 34 5')).toBeNull();
    expect(smsLink('abc')).toBeNull();
    expect(telLink('0412 345 678?x=')).toBe('tel:0412345678');
  });

  it('formats times in Melbourne time', () => {
    expect(formatWhen(Date.UTC(2026, 10, 6, 4, 0))).toBe('Fri 6 Nov, 3:00 pm');
    expect(formatRange(Date.UTC(2026, 9, 27, 13, 0), Date.UTC(2026, 10, 3, 2, 0))).toBe('Wed 28 Oct to Tue 3 Nov');
  });

  it('words scorecard lines and segment tags', () => {
    expect(scorecardLine({ enquiries: 1, qualified: 2, appraisalsBooked: 1 })).toBe('1 new enquiry \u00b7 2 ready for an appraisal \u00b7 1 appraisal booked');
    expect(scorecardLine({ enquiries: 0, qualified: 0, appraisalsBooked: 3 })).toBe('0 new enquiries \u00b7 0 ready for an appraisal \u00b7 3 appraisals booked');
    expect(segmentTag('landlord_management')).toBe('Landlord');
    expect(segmentTag('general_sme')).toBe('Other enquiry');
  });
});
