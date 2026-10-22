import { describe, expect, it } from 'vitest';
import { sameSiteHost } from '../services/audit/sameSiteHost';

describe('sameSiteHost', () => {
  it('matches the base, www, and a subdomain, and rejects a lookalike', () => {
    expect(sameSiteHost('www.movida.com.au', 'movida.com.au')).toBe(true);
    expect(sameSiteHost('booking.movida.com.au', 'www.movida.com.au')).toBe(true);
    expect(sameSiteHost('www.x.com', 'booking.x.com')).toBe(true);
    expect(sameSiteHost('evilmovida.com.au', 'movida.com.au')).toBe(false);
    expect(sameSiteHost('www.evilmovida.com.au', 'www.movida.com.au')).toBe(false);
    expect(sameSiteHost('movida.com.au.evil.com', 'movida.com.au')).toBe(false);
  });
});
