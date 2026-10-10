import React from 'react';

export const GenUISkeleton: React.FC = () => {
  return (
    <div className="w-full my-4 p-5 rounded-2xl border border-gold/20 bg-black/40 backdrop-blur-md animate-pulse space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 bg-gold/20 rounded-md" />
        <div className="h-3 w-16 bg-white/10 rounded-full" />
      </div>
      <div className="h-8 w-3/4 bg-white/10 rounded-xl" />
      <div className="grid grid-cols-3 gap-3 pt-2">
        <div className="h-16 bg-white/5 rounded-xl border border-white/5" />
        <div className="h-16 bg-white/5 rounded-xl border border-white/5" />
        <div className="h-16 bg-white/5 rounded-xl border border-white/5" />
      </div>
    </div>
  );
};
