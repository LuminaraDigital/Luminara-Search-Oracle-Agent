import React from 'react';

export interface ActionCardProps {
  title?: string;
  priority?: 'High' | 'Med' | 'Low' | string;
  timeEstimate?: string;
  buttonLabel?: string;
  onClick?: () => void;
  args?: any[];
}

export const ActionCard: React.FC<ActionCardProps> = ({
  title: propTitle,
  priority: propPriority,
  timeEstimate: propTime,
  buttonLabel: propLabel,
  onClick: propOnClick,
  args,
}) => {
  const title = propTitle ?? (args?.[0] !== undefined ? String(args[0]) : 'Recommended Action');
  const priority = propPriority ?? (args?.[1] !== undefined ? String(args[1]) : 'High');
  const timeEstimate = propTime ?? (args?.[2] !== undefined ? String(args[2]) : '30 mins');
  const callback = propOnClick ?? (typeof args?.[3] === 'function' ? args[3] : undefined);
  const buttonLabel = propLabel ?? (typeof args?.[4] === 'string' ? args[4] : 'Ship This Move');

  const priorityColor =
    priority.toLowerCase() === 'high'
      ? 'border-gold/50 bg-gold/10 text-gold-light'
      : priority.toLowerCase() === 'med'
      ? 'border-info-500/30 bg-info-500/10 text-info-300'
      : 'border-white/10 bg-white/5 text-gray-400';

  return (
    <div className="p-5 my-4 rounded-2xl border border-gold/30 bg-black/60 shadow-[0_10px_30px_rgba(0,0,0,0.5)] transition-all hover:border-gold/50">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-gold font-bold">
          Weekly Decision Spine
        </span>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase ${priorityColor}`}>
            {priority} Priority
          </span>
          <span className="text-[10px] font-mono text-gray-400">
            {timeEstimate}
          </span>
        </div>
      </div>

      <h4 className="text-base font-semibold text-white mb-4 leading-snug">
        {title}
      </h4>

      <div className="flex items-center justify-between pt-3 border-t border-white/10">
        <span className="text-xs text-gray-400 font-mono">
          Single move worth shipping this week
        </span>
        <button
          type="button"
          onClick={callback}
          className="px-4 py-2 rounded-xl bg-gold/20 hover:bg-gold/30 border border-gold/40 text-gold-light text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
        >
          <span>{buttonLabel}</span>
          <span className="text-gold font-bold">&rarr;</span>
        </button>
      </div>
    </div>
  );
};
