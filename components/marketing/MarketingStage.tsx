import React, { useCallback, useState } from 'react';
import { VisibilityFieldHero } from './VisibilityFieldHero';
import { VisibilityProbe } from './VisibilityProbe';

interface MarketingStageProps {
  isAuthenticated?: boolean;
  onOpenAudit: () => void;
  onSignIn: () => void;
  onSeePricing: () => void;
}

/**
 * Immersive Workbench: parallax Blender Visibility Field + interactive Probe.
 * Product engines only. Interaction remains SVG/Canvas (no Three on marketing).
 */
export const MarketingStage: React.FC<MarketingStageProps> = (props) => {
  const [resultsLit, setResultsLit] = useState(false);
  const onResultsLitChange = useCallback((lit: boolean) => setResultsLit(lit), []);

  return (
    <div className="relative min-w-0 w-full">
      <div className="relative min-h-[32rem] sm:min-h-[36rem]">
        <VisibilityFieldHero className="z-0" resultsLit={resultsLit} />
        <div className="relative z-[1] pt-5 sm:pt-7 pb-2">
          <VisibilityProbe {...props} onResultsLitChange={onResultsLitChange} />
        </div>
      </div>
      <p className="mt-3 text-[11px] text-[var(--color-ink-2)] leading-relaxed max-w-prose">
        Move over the stage for depth. Run a scout to light engines one by one. Click a node or row
        to focus Google, AI Overviews, ChatGPT, or Perplexity. Sample statuses only; no invented scores.
      </p>
    </div>
  );
};
