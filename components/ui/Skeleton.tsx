import React from 'react';
import { PlaceLoader } from './PlaceLoader';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

/**
 * Primitive geometric skeleton block with a subtle pulse animation using neutral surface tokens.
 */
export const Skeleton: React.FC<SkeletonProps> = ({ className = '', ...props }) => (
  <div
    aria-hidden="true"
    className={`animate-pulse rounded-lg bg-white/[0.06] ${className}`}
    {...props}
  />
);

export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className = '',
}) => (
  <div aria-hidden="true" className={`space-y-2.5 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        className={`h-3.5 ${i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full'}`}
      />
    ))}
  </div>
);

export const SkeletonCard: React.FC<{ className?: string; children?: React.ReactNode }> = ({
  className = '',
  children,
}) => (
  <div
    aria-hidden="true"
    className={`glass-morphism rounded-2xl border border-white/10 p-6 space-y-4 ${className}`}
  >
    {children || (
      <>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
        <SkeletonText lines={2} />
      </>
    )}
  </div>
);

/**
 * Geometric skeleton mirroring the Audit Report layout (Action Bar, Score/Verdict, 2-col Metrics, Fix List).
 * Explicit min-height ensures Cumulative Layout Shift (CLS) is zero.
 */
export const AuditReportSkeleton: React.FC<{ message?: string }> = ({
  message = 'Loading…',
}) => (
  <div
    role="status"
    aria-label={message}
    aria-busy="true"
    className="space-y-6 min-h-[600px] animate-in fade-in duration-300"
  >
    {/* Stage banner with pulse shimmer */}
    <div className="glass-morphism rounded-2xl border border-gold/40 p-5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-2.5 h-2.5 rounded-full bg-gold animate-ping shrink-0" />
        <span className="text-xs font-mono text-gold-light font-medium">
          {message}
        </span>
      </div>
      <div className="w-28 sm:w-48 h-1.5 bg-white/10 rounded-full overflow-hidden shrink-0">
        <div className="h-full bg-gradient-to-r from-gold to-gold-light rounded-full animate-pulse w-3/4" />
      </div>
    </div>

    {/* Action Bar Skeleton */}
    <div className="glass-morphism rounded-2xl border border-white/10 p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
      <div className="flex items-center gap-3 w-full sm:w-auto">
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
        <Skeleton className="h-8 w-28 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
    </div>

    {/* Verdict Card Skeleton */}
    <div className="glass-morphism rounded-3xl border border-gold/20 p-6 sm:p-8 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2 w-1/2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-3/4" />
        </div>
        <Skeleton className="h-14 w-14 rounded-2xl" />
      </div>
      <SkeletonText lines={3} />
    </div>

    {/* 2-Column Metrics Radar & Competitor Map Grid */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="glass-morphism rounded-3xl border border-white/10 p-6 space-y-4 min-h-[280px]">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
        <div className="flex items-center justify-center py-6">
          <Skeleton className="w-40 h-40 rounded-full" />
        </div>
        <div className="grid grid-cols-3 gap-2 pt-2">
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
      </div>

      <div className="glass-morphism rounded-3xl border border-white/10 p-6 space-y-4 min-h-[280px]">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
        <div className="space-y-3 py-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* Prioritized Task List Skeleton */}
    <div className="glass-morphism rounded-3xl border border-white/10 p-6 space-y-4">
      <Skeleton className="h-5 w-44 mb-4" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col sm:flex-row justify-between gap-3">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <Skeleton className="h-7 w-20 rounded-lg shrink-0" />
        </div>
      ))}
    </div>
  </div>
);

/**
 * Geometric skeleton mirroring the Strategic Business DNA View.
 */
export const BusinessDnaSkeleton: React.FC = () => (
  <div
    role="status"
    aria-label="Loading business profile"
    aria-busy="true"
    className="max-w-4xl mx-auto px-4 py-8 space-y-8 min-h-[500px] animate-in fade-in duration-300"
  >
    <div className="text-center space-y-3">
      <Skeleton className="h-6 w-32 rounded-full mx-auto" />
      <Skeleton className="h-9 w-64 mx-auto" />
      <Skeleton className="h-4 w-80 max-w-full mx-auto" />
    </div>

    <div className="glass-morphism rounded-2xl border border-white/10 p-6 sm:p-8 space-y-4">
      <Skeleton className="h-3 w-40" />
      <div className="flex gap-3">
        <Skeleton className="h-11 flex-1 rounded-xl" />
        <Skeleton className="h-11 w-32 rounded-xl" />
      </div>
    </div>

    <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-6">
      <div className="flex justify-between items-center pb-4 border-b border-white/10">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

/**
 * Geometric skeleton mirroring the Brand Memory Vault.
 */
export const BrandMemorySkeleton: React.FC = () => (
  <div
    role="status"
    aria-label="Loading brand memory"
    aria-busy="true"
    className="max-w-5xl mx-auto space-y-6 min-h-[500px] animate-in fade-in duration-300"
  >
    <div className="flex flex-col md:flex-row justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24 rounded-xl" />
        <Skeleton className="h-9 w-32 rounded-xl" />
      </div>
    </div>

    <div className="flex gap-2 p-1.5 rounded-2xl bg-black/40 border border-white/10 overflow-x-auto">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-24 rounded-xl shrink-0" />
      ))}
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="p-5 rounded-2xl border border-white/10 bg-white/[0.02] space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  </div>
);

/**
 * Geometric skeleton mirroring Data Analyst / Synthesis views.
 */
export const SynthesisSkeleton: React.FC<{ title?: string }> = ({
  title = 'Synthesizing data models…',
}) => (
  <div
    role="status"
    aria-label={title}
    aria-busy="true"
    className="glass-morphism rounded-2xl border border-gold/30 p-6 sm:p-8 space-y-6 animate-in fade-in duration-300"
  >
    <div className="flex items-center justify-between border-b border-white/10 pb-4">
      <div className="flex items-center gap-3">
        <div className="w-2.5 h-2.5 rounded-full bg-gold animate-pulse" />
        <span className="text-xs font-medium text-gold-light">
          {title}
        </span>
      </div>
      <Skeleton className="h-4 w-20 rounded-full" />
    </div>
    <div className="space-y-4">
      <SkeletonText lines={4} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
      <SkeletonText lines={3} />
    </div>
  </div>
);

/**
 * Geometric skeleton mirroring Verification / Receipt / Teaser cards.
 */
export const VerificationCardSkeleton: React.FC<{ title?: string }> = ({
  title = 'Verifying cryptographic record…',
}) => (
  <div
    role="status"
    aria-label={title}
    aria-busy="true"
    className="max-w-2xl mx-auto px-4 py-8 space-y-5 min-h-[360px] animate-in fade-in duration-300"
  >
    <div className="glass-morphism rounded-2xl border border-gold/30 p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-gold animate-pulse shrink-0" />
          <span className="text-xs font-mono text-gold-light font-medium">
            {title}
          </span>
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-7 w-2/3" />
      <SkeletonText lines={3} />
      <div className="grid grid-cols-2 gap-3 pt-2">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    </div>
  </div>
);

/** Route wait. Callers still pass a view name. The sentence on screen is always Loading…. */
export const ViewSkeleton: React.FC<{ viewName?: string }> = ({ viewName = 'workspace' }) => (
  <div data-view={viewName}>
    <PlaceLoader label="Loading…" fill />
  </div>
);

export default Skeleton;

