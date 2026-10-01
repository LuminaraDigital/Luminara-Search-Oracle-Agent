import React from 'react';
import { MarketingCinematicStage } from './MarketingCinematicStage';

type Intensity = 'hero' | 'page' | 'full' | 'subtle';

/**
 * Marketing atmosphere entry. Maps legacy full/subtle to cinematic hero/page.
 * No glass. No gold aurora blobs.
 */
export const MarketingAtmosphere: React.FC<{ intensity?: Intensity; className?: string }> = ({
  intensity = 'page',
  className = '',
}) => {
  const mapped =
    intensity === 'full' || intensity === 'hero'
      ? 'hero'
      : 'page';
  return <MarketingCinematicStage intensity={mapped} className={className} />;
};
