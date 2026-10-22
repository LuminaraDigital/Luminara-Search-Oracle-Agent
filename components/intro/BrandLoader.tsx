import React from 'react';
import { PlaceLoader } from '../ui/PlaceLoader';

type BrandLoaderProps = {
  caption?: string;
  compact?: boolean;
};

/** Auth and intro wait. Same small wordmark as the boot splash. */
export const BrandLoader: React.FC<BrandLoaderProps> = ({
  caption = 'Loading…',
  compact = false,
}) => (
  <PlaceLoader label={caption} compact={compact} />
);
