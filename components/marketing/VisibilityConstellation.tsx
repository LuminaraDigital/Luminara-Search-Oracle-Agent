import React, { useCallback, useEffect, useState } from 'react';
import { shouldUseEnhancedConstellation } from './constellationCapability';
import {
  VisibilityConstellationSvg,
  type VisibilityConstellationViewProps,
} from './VisibilityConstellationSvg';

type CanvasModule = typeof import('./VisibilityConstellationCanvas');
type CanvasComponent = CanvasModule['VisibilityConstellationCanvas'];

export type { VisibilityConstellationViewProps };
export { VisibilityConstellationSvg };

/**
 * Visibility Field host.
 * Default: SVG. Enhanced Canvas2D loads only after idle when capability gate passes
 * (desktop ≥768, WebGL, no reduced-motion, no saveData). Never pulls Three into the main chunk.
 */
export const VisibilityConstellation: React.FC<VisibilityConstellationViewProps> = (props) => {
  const [CanvasComp, setCanvasComp] = useState<CanvasComponent | null>(null);
  const [forceSvg, setForceSvg] = useState(false);

  const onContextLost = useCallback(() => {
    setForceSvg(true);
    setCanvasComp(null);
  }, []);

  useEffect(() => {
    if (forceSvg) return;
    if (!shouldUseEnhancedConstellation()) {
      setCanvasComp(null);
      return;
    }

    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      void import('./VisibilityConstellationCanvas')
        .then((mod) => {
          if (cancelled || !shouldUseEnhancedConstellation()) return;
          setCanvasComp(() => mod.VisibilityConstellationCanvas);
        })
        .catch(() => {
          if (!cancelled) setCanvasComp(null);
        });
    };

    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;

    if (typeof ric === 'function') {
      idleId = ric(load, { timeout: 1500 });
    } else {
      timeoutId = setTimeout(load, 200);
    }

    const onResize = () => {
      if (!shouldUseEnhancedConstellation()) setCanvasComp(null);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      if (idleId != null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) clearTimeout(timeoutId);
      window.removeEventListener('resize', onResize);
    };
  }, [forceSvg]);

  if (CanvasComp && !forceSvg) {
    return <CanvasComp {...props} onContextLost={onContextLost} />;
  }

  return <VisibilityConstellationSvg {...props} />;
};
