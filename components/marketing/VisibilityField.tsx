import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { DemoEngineRow } from './demo/demoFixtures';
import { VisibilityConstellation as VisibilityConstellationSvg } from './VisibilityConstellation';

const VisibilityFieldCanvas = lazy(() => import('./VisibilityFieldCanvas'));

function allowCanvasField(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (window.innerWidth < 768) return false;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return false;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0 && nav.deviceMemory < 4) return false;
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('2d'));
  } catch {
    return false;
  }
}

interface VisibilityFieldProps {
  engines: DemoEngineRow[];
  domainLabel?: string;
  className?: string;
}

/**
 * Product visibility field: Canvas 2.5D when allowed, SVG otherwise.
 * No Three.js / R3F on the marketing path.
 */
export const VisibilityField: React.FC<VisibilityFieldProps> = ({ engines, domainLabel, className }) => {
  const [mode, setMode] = useState<'svg' | 'canvas'>('svg');

  const canCanvas = useMemo(() => allowCanvasField(), []);

  useEffect(() => {
    if (!canCanvas) return;
    let cancelled = false;
    let idleHandle: number | undefined;
    let timeoutHandle: number | undefined;

    const promote = () => {
      if (!cancelled) setMode('canvas');
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(promote);
    } else {
      timeoutHandle = window.setTimeout(promote, 200);
    }

    return () => {
      cancelled = true;
      if (idleHandle != null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [canCanvas]);

  if (mode === 'canvas') {
    return (
      <Suspense
        fallback={
          <VisibilityConstellationSvg engines={engines} domainLabel={domainLabel} className={className} />
        }
      >
        <VisibilityFieldCanvas
          engines={engines}
          domainLabel={domainLabel}
          className={className}
          onContextLost={() => setMode('svg')}
        />
      </Suspense>
    );
  }

  return <VisibilityConstellationSvg engines={engines} domainLabel={domainLabel} className={className} />;
};
