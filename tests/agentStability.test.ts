import { describe, it, expect } from 'vitest';
import {
  RepeatDetector,
  buildCallKey,
} from '../services/agentCore/repeatDetector';
import { TurnWatchdog } from '../services/agentCore/turnWatchdog';

describe('RepeatDetector', () => {
  it('normalizes tool call signatures correctly', () => {
    expect(buildCallKey('firecrawl_scrape', 'https://example.com')).toBe(
      'firecrawl_scrape:https://example.com'
    );
    expect(buildCallKey('firecrawl_scrape', '  https://example.com   \n')).toBe(
      'firecrawl_scrape:https://example.com'
    );
    expect(buildCallKey('tavily_search', '')).toBeNull();
    expect(buildCallKey('tavily_search', 'tavily_search')).toBeNull();
  });

  it('detects tool call loops crossing defined thresholds', () => {
    const detector = new RepeatDetector({ thresholds: [2, 4] });
    const thread = 'audit-session-1';
    const key = 'tavily_search:acme brand citations';

    const r1 = detector.record(thread, key);
    expect(r1.count).toBe(1);
    expect(r1.threshold).toBeUndefined();
    expect(r1.isLoop).toBe(false);

    const r2 = detector.record(thread, key);
    expect(r2.count).toBe(2);
    expect(r2.threshold).toBe(2);
    expect(r2.isLoop).toBe(false);

    const r3 = detector.record(thread, key);
    expect(r3.count).toBe(3);
    expect(r3.threshold).toBeUndefined();
    expect(r3.isLoop).toBe(false);

    const r4 = detector.record(thread, key);
    expect(r4.count).toBe(4);
    expect(r4.threshold).toBe(4);
    expect(r4.isLoop).toBe(true);
  });

  it('settles and cleans up thread memory after turn completion', () => {
    const detector = new RepeatDetector({ thresholds: [3] });
    const thread = 'audit-session-2';
    const key = 'probe_serp:query';

    detector.record(thread, key);
    detector.record(thread, key);
    detector.settle(thread);

    const fresh = detector.record(thread, key);
    expect(fresh.count).toBe(1);
  });
});

describe('TurnWatchdog', () => {
  it('triggers stall callback when a turn is silent beyond stallMs', () => {
    let currentTime = 1000;
    const stalledTurns: string[] = [];

    const watchdog = new TurnWatchdog({
      stallMs: 5000,
      checkMs: 1000,
      now: () => currentTime,
      onStall: (t) => stalledTurns.push(t.threadId),
    });

    watchdog.watch('thread-alpha', 'agent-aeo');
    expect(watchdog.isWatching('thread-alpha')).toBe(true);

    // Advance 3 seconds - no stall
    currentTime += 3000;
    watchdog.sweep();
    expect(stalledTurns).toHaveLength(0);

    // Touch at 4 seconds
    currentTime += 1000;
    watchdog.touch('thread-alpha');

    // Advance 4 seconds (elapsed 4s since touch) - still under 5s stallMs
    currentTime += 4000;
    watchdog.sweep();
    expect(stalledTurns).toHaveLength(0);

    // Advance 2 more seconds (6s total since touch) - should stall
    currentTime += 2000;
    watchdog.sweep();
    expect(stalledTurns).toEqual(['thread-alpha']);
    expect(watchdog.isWatching('thread-alpha')).toBe(false);
  });

  it('exempts turns waiting on human approval from stalling', () => {
    let currentTime = 10000;
    const stalledTurns: string[] = [];

    const watchdog = new TurnWatchdog({
      stallMs: 5000,
      checkMs: 1000,
      now: () => currentTime,
      onStall: (t) => stalledTurns.push(t.threadId),
    });

    watchdog.watch('thread-beta', 'agent-paid-research');
    watchdog.setWaitingOnHuman('thread-beta', true);

    // Advance by 30 seconds - human is reviewing Paid Tool permission
    currentTime += 30000;
    watchdog.sweep();
    expect(stalledTurns).toHaveLength(0);
    expect(watchdog.isWatching('thread-beta')).toBe(true);

    // Human approves or denies: waitingOnHuman set to false
    watchdog.setWaitingOnHuman('thread-beta', false);

    // Advance 6 seconds of silence after decision - now it stalls
    currentTime += 6000;
    watchdog.sweep();
    expect(stalledTurns).toEqual(['thread-beta']);
  });
});
