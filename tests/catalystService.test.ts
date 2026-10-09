import { describe, it, expect } from 'vitest';
import { buildCatalystTimeline, KNOWN_PLATFORM_CATALYSTS } from '../services/visibility/catalystService';

describe('catalystService', () => {
  it('combines platform catalysts with brand actions chronologically', () => {
    const timeline = buildCatalystTimeline({
      brandActions: [
        {
          actionId: 'deploy-schema',
          title: 'Organization JSON-LD Deployed',
          timestamp: new Date('2026-09-20T12:00:00Z').getTime(),
          description: 'Deployed verified Schema.org entity metadata',
        },
      ],
      mindshareDelta: 15,
    });

    expect(timeline.length).toBe(KNOWN_PLATFORM_CATALYSTS.length + 1);
    expect(timeline[0].timestamp).toBeGreaterThanOrEqual(timeline[1].timestamp);

    const brandEvent = timeline.find((c) => c.origin === 'brand');
    expect(brandEvent).toBeDefined();
    expect(brandEvent?.impact?.deltaPercent).toBe(15);
    expect(brandEvent?.title).toBe('Organization JSON-LD Deployed');
  });
});
