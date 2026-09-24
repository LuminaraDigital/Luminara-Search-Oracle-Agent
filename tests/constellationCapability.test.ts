import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasWebGL,
  isLowMemoryDevice,
  isSaveDataEnabled,
  prefersReducedMotion,
  shouldUseEnhancedConstellation,
} from '../components/marketing/constellationCapability';

function stubDesktopWindow(opts: {
  width?: number;
  reducedMotion?: boolean;
  saveData?: boolean;
  deviceMemory?: number;
  webgl?: boolean;
}) {
  const width = opts.width ?? 1280;
  const matchMedia = vi.fn((q: string) => ({
    matches: !!opts.reducedMotion && String(q).includes('prefers-reduced-motion'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const getContext = vi.fn((type: string) => {
    if (!opts.webgl) return null;
    if (type === 'webgl' || type === 'experimental-webgl') return {};
    return null;
  });
  vi.stubGlobal('window', {
    innerWidth: width,
    matchMedia,
  });
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('matchMedia', matchMedia);
  vi.stubGlobal('navigator', {
    connection: { saveData: !!opts.saveData },
    deviceMemory: opts.deviceMemory,
  });
  vi.stubGlobal('document', {
    createElement: () => ({ getContext }),
  });
}

describe('constellationCapability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects enhanced path under 768px', () => {
    stubDesktopWindow({ width: 375, webgl: true });
    expect(shouldUseEnhancedConstellation()).toBe(false);
  });

  it('rejects when prefers-reduced-motion', () => {
    stubDesktopWindow({ reducedMotion: true, webgl: true });
    expect(prefersReducedMotion()).toBe(true);
    expect(shouldUseEnhancedConstellation()).toBe(false);
  });

  it('rejects saveData', () => {
    stubDesktopWindow({ saveData: true, webgl: true });
    expect(isSaveDataEnabled()).toBe(true);
    expect(shouldUseEnhancedConstellation()).toBe(false);
  });

  it('rejects low-memory devices', () => {
    stubDesktopWindow({ deviceMemory: 2, webgl: true });
    expect(isLowMemoryDevice()).toBe(true);
    expect(shouldUseEnhancedConstellation()).toBe(false);
  });

  it('allows enhanced path when all gates pass', () => {
    stubDesktopWindow({ webgl: true });
    expect(hasWebGL()).toBe(true);
    expect(shouldUseEnhancedConstellation()).toBe(true);
  });

  it('rejects when WebGL is unavailable', () => {
    stubDesktopWindow({ webgl: false });
    expect(hasWebGL()).toBe(false);
    expect(shouldUseEnhancedConstellation()).toBe(false);
  });
});
