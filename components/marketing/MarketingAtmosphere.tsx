import React from 'react';
import { PremiumAtmosphere } from '../ui/PremiumAtmosphere';

type Intensity = 'full' | 'subtle';

/** Marketing atmosphere. Landing uses full; siblings use subtle. */
export const MarketingAtmosphere: React.FC<{ intensity?: Intensity; className?: string }> = ({
  intensity = 'full',
  className = '',
}) => <PremiumAtmosphere intensity={intensity} className={className} />;
