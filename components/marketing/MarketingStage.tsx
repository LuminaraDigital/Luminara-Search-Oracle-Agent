import React from 'react';
import { VisibilityProbe } from './VisibilityProbe';

interface MarketingStageProps {
  isAuthenticated?: boolean;
  onOpenAudit: () => void;
  onSignIn: () => void;
  onSeePricing: () => void;
}

/** Hero composition host: Workbench stage + Visibility Probe (+ lazy constellation). */
export const MarketingStage: React.FC<MarketingStageProps> = (props) => (
  <div className="relative min-w-0 w-full">
    <VisibilityProbe {...props} />
  </div>
);
