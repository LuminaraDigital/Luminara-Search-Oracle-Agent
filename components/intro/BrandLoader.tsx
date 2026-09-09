import React from 'react';

type BrandLoaderProps = {
  caption?: string;
  compact?: boolean;
};

/** Shared gold mark + progress used by auth wait and intro buffering. */
export const BrandLoader: React.FC<BrandLoaderProps> = ({
  caption = 'Loading',
  compact = false,
}) => (
  <div className={`flex flex-col items-center text-center ${compact ? 'gap-3' : 'gap-4'}`}>
    <div className="relative flex items-center justify-center">
      <div
        className={`absolute rounded-full bg-[radial-gradient(circle,rgba(191,149,63,0.28)_0%,transparent_70%)] blur-md animate-pulse ${
          compact ? 'h-20 w-20' : 'h-28 w-28'
        }`}
        aria-hidden="true"
      />
      <img
        src="/favicon.png?v=20260909"
        alt=""
        width={compact ? 56 : 72}
        height={compact ? 56 : 72}
        className={`relative rounded-full object-cover shadow-[0_0_36px_rgba(191,149,63,0.35)] ${
          compact ? 'h-14 w-14' : 'h-[72px] w-[72px]'
        }`}
        draggable={false}
      />
    </div>
    <p className="text-[10px] font-black uppercase tracking-[0.45em] text-gold-light/90">Luminara Suite</p>
    <p className="text-[11px] uppercase tracking-[0.28em] text-gray-500">{caption}</p>
    <div className={`overflow-hidden rounded-full bg-white/[0.07] ${compact ? 'h-[2px] w-36' : 'h-[2px] w-44'}`}>
      <div className="h-full w-2/5 rounded-full progress-gold" />
    </div>
  </div>
);
