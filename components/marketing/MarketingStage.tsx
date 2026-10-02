import React from 'react';
import { VisibilityProbe } from './VisibilityProbe';
import type { AuditHandoff } from '../../services/activation/auditHandoff';

interface MarketingStageProps {
  isAuthenticated?: boolean;
  onOpenAudit: (handoff?: AuditHandoff) => void;
  onSignIn: (handoff?: AuditHandoff) => void;
  onSignUp?: (handoff?: AuditHandoff) => void;
  onSeePricing: () => void;
}

/** Probe only. No FieldHero plate, no glass card, no glow underlay. */
export const MarketingStage: React.FC<MarketingStageProps> = (props) => (
  <div className="relative min-w-0 w-full">
    <VisibilityProbe {...props} />
  </div>
);
