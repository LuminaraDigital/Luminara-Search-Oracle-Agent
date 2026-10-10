import React, { useState, useEffect } from 'react';

interface DailyStreakCardProps {
  domain: string;
  onRecheck?: () => void;
}

export const DailyStreakCard: React.FC<DailyStreakCardProps> = ({ domain, onRecheck }) => {
  const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'yourdomain.com';

  const [streakDays, setStreakDays] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    try {
      const stored = localStorage.getItem(`luminara_streak_${cleanDomain}`);
      return stored ? parseInt(stored, 10) : 1;
    } catch {
      return 1;
    }
  });

  const [reminderSet, setReminderSet] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(`luminara_reminder_${cleanDomain}`) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(`luminara_streak_${cleanDomain}`, String(streakDays));
    } catch {
      // ignore
    }
  }, [streakDays, cleanDomain]);

  const toggleReminder = () => {
    const next = !reminderSet;
    setReminderSet(next);
    try {
      localStorage.setItem(`luminara_reminder_${cleanDomain}`, String(next));
    } catch {
      // ignore
    }
  };

  const days = [1, 2, 3, 4, 5, 6, 7];

  return (
    <div className="mt-8 rounded-2xl border border-gold/30 bg-black/80 p-5 sm:p-6 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-gold animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-gold-light">
              AI Visibility Cycle : Daily Streak
            </span>
          </div>
          <h3 className="text-lg font-bold text-white tracking-tight mt-1">
            Day {streakDays} of 7-Day Verification Loop
          </h3>
          <p className="text-xs text-gray-400 mt-1 max-w-lg leading-relaxed">
            AI crawlers (GPTBot, PerplexityBot) typically update their retrieval indices over 3 to 14 days. Re-verify daily to catch your new citations as they appear.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleReminder}
            className={`px-3 py-2 rounded-lg border text-xs font-semibold tracking-wide transition-all ${
              reminderSet
                ? 'border-gold/40 text-gold-light bg-gold/10'
                : 'border-white/15 text-gray-300 hover:text-white hover:border-white/30'
            }`}
          >
            {reminderSet ? 'Daily Alert Active' : 'Enable Daily Re-check'}
          </button>
          {onRecheck && (
            <button
              type="button"
              onClick={onRecheck}
              className="px-4 py-2 rounded-lg bg-gold hover:bg-gold-light text-black text-xs font-bold uppercase tracking-wider transition-colors"
            >
              Re-check Now
            </button>
          )}
        </div>
      </div>

      {/* 7-Day Pip Progression */}
      <div className="mt-5 pt-4 border-t border-white/10">
        <div className="grid grid-cols-7 gap-2">
          {days.map((d) => {
            const isCompleted = d < streakDays;
            const isCurrent = d === streakDays;
            return (
              <div
                key={d}
                className={`rounded-lg border p-2.5 text-center transition-all ${
                  isCompleted
                    ? 'border-gold/50 bg-gold/10 text-gold-light'
                    : isCurrent
                      ? 'border-gold bg-gold/20 text-white shadow-[0_0_12px_rgba(255,215,0,0.2)]'
                      : 'border-white/10 bg-white/[0.02] text-gray-500'
                }`}
              >
                <div className="text-[10px] font-mono uppercase tracking-wider">
                  {isCompleted ? 'Done' : isCurrent ? 'Today' : `Day ${d}`}
                </div>
                <div className="text-xs font-bold mt-1">
                  {isCompleted ? '✓' : `D${d}`}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-gray-500">
          <span>Next automated index scan: In 18 hours</span>
          <span>Target: 4-week Operator status (+200 Lumens)</span>
        </div>
      </div>
    </div>
  );
};
