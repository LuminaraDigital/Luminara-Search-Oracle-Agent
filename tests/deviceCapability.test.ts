import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLowMemoryDevice,
  isSaveDataEnabled,
  prefersReducedMotion,
} from '../components/marketing/deviceCapability';

function stubDevice(opts: { reducedMotion?: boolean; saveData?: boolean; deviceMemory?: number }) {
  const matchMedia = vi.fn((q: string) => ({
    matches: !!opts.reducedMotion && String(q).includes('prefers-reduced-motion'),
    media: q,
  }));
  vi.stubGlobal('window', { matchMedia });
  vi.stubGlobal('navigator', {
    connection: { saveData: !!opts.saveData },
    deviceMemory: opts.deviceMemory,
  });
}

describe('deviceCapability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the reduced-motion preference', () => {
    stubDevice({ reducedMotion: true });
    expect(prefersReducedMotion()).toBe(true);
    stubDevice({ reducedMotion: false });
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reads Save-Data', () => {
    stubDevice({ saveData: true });
    expect(isSaveDataEnabled()).toBe(true);
    stubDevice({ saveData: false });
    expect(isSaveDataEnabled()).toBe(false);
  });

  it('treats under 4 GB as low memory and unknown memory as normal', () => {
    stubDevice({ deviceMemory: 2 });
    expect(isLowMemoryDevice()).toBe(true);
    stubDevice({ deviceMemory: 8 });
    expect(isLowMemoryDevice()).toBe(false);
    stubDevice({});
    expect(isLowMemoryDevice()).toBe(false);
  });

  it('is safe outside a browser', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('navigator', undefined);
    expect(prefersReducedMotion()).toBe(false);
    expect(isSaveDataEnabled()).toBe(false);
    expect(isLowMemoryDevice()).toBe(false);
  });
});
