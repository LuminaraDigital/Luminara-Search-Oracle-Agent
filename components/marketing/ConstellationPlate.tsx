import React from 'react';
import { shouldLoadConstellationPlate } from './constellationCapability';
import {
  CONSTELLATION_ASSET,
  CONSTELLATION_PLATE_OPACITY,
} from './constellationLayout';

interface ConstellationPlateProps {
  variant?: 'idle' | 'sample';
}

/**
 * Optional Blender-baked depth underlay. Gated like the enhanced field
 * (desktop, no saveData / reduced-motion / low-memory). Never LCP-critical.
 */
export const ConstellationPlate: React.FC<ConstellationPlateProps> = ({ variant = 'idle' }) => {
  if (!shouldLoadConstellationPlate()) return null;
  const src = variant === 'sample' ? CONSTELLATION_ASSET.samplePlate : CONSTELLATION_ASSET.idlePlate;
  return (
    <img
      src={src}
      alt=""
      width={1024}
      height={768}
      decoding="async"
      loading="lazy"
      fetchPriority="low"
      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      style={{ opacity: CONSTELLATION_PLATE_OPACITY }}
      aria-hidden
      onError={(ev) => {
        (ev.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
};
