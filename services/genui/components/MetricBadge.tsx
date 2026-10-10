import React from 'react';

export interface MetricBadgeProps {
  label?: string;
  value?: string | number | null;
  status?: 'verified' | 'unmeasured' | 'warning' | 'neutral';
  args?: any[];
}

export const MetricBadge: React.FC<MetricBadgeProps> = ({
  label: propLabel,
  value: propValue,
  status: propStatus,
  args,
}) => {
  const label = propLabel ?? (args?.[0] !== undefined ? String(args[0]) : 'Metric');
  const rawValue = propValue ?? args?.[1];
  const value = rawValue === null || rawValue === undefined ? 'not measured' : String(rawValue);

  const isUnmeasured =
    value.toLowerCase().includes('not measured') ||
    value.toLowerCase().includes('unknown') ||
    propStatus === 'unmeasured';

  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-mono transition-all ${
        isUnmeasured
          ? 'border-white/10 bg-white/5 text-gray-400'
          : 'border-gold/30 bg-gold/10 text-gold-light shadow-[0_0_12px_rgba(212,175,55,0.15)]'
      }`}
    >
      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{label}:</span>
      <span className={`font-bold ${isUnmeasured ? 'italic text-gray-500' : 'text-gold-light'}`}>{value}</span>
    </div>
  );
};
