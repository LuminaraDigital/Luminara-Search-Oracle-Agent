import { describe, it, expect } from 'vitest';
import { watchOnlyService } from '../services/launchpad/watchOnlyService';

describe('WatchOnlyService', () => {
  it('toggles campaign watch status idempotently', () => {
    const id = 'campaign-test-123';
    const isNowWatched = watchOnlyService.toggleWatchCampaign(id);
    expect(isNowWatched).toBe(true);
    expect(watchOnlyService.isCampaignWatched(id)).toBe(true);

    const isUnwatched = watchOnlyService.toggleWatchCampaign(id);
    expect(isUnwatched).toBe(false);
    expect(watchOnlyService.isCampaignWatched(id)).toBe(false);
  });

  it('normalizes domain names when tracking', () => {
    const domain = '  HTTPS://Example.COM/test  ';
    watchOnlyService.toggleWatchDomain(domain);
    expect(watchOnlyService.isDomainWatched('https://example.com/test')).toBe(true);

    // Unwatch
    watchOnlyService.toggleWatchDomain('https://example.com/test');
    expect(watchOnlyService.isDomainWatched('https://example.com/test')).toBe(false);
  });
});
