import React, { useState, useEffect } from 'react';
import { themingService, THEMES } from '../../services/harness/themingService';
import { reminderService } from '../../services/harness/reminderService';
import { ThemeId, HarnessReminder, LuminaraTheme } from '../../types';

export const ThemingStudioPanel: React.FC = () => {
  const [currentTheme, setCurrentTheme] = useState<LuminaraTheme>(themingService.getTheme());
  const [reminders, setReminders] = useState<HarnessReminder[]>([]);
  const [reminderLabel, setReminderLabel] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState<number>(15);

  useEffect(() => {
    const updateTheme = (t: LuminaraTheme) => setCurrentTheme(t);
    const updateRem = (rems: HarnessReminder[]) => setReminders(rems);

    setReminders(reminderService.getReminders());
    const unsubTheme = themingService.subscribe(updateTheme);
    const unsubRem = reminderService.subscribe(updateRem);

    return () => {
      unsubTheme();
      unsubRem();
    };
  }, []);

  const handleSelectTheme = (id: ThemeId) => {
    const t = themingService.setTheme(id);
    setCurrentTheme(t);
  };

  const handleAddReminder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reminderLabel.trim()) return;
    reminderService.addReminder(reminderLabel, reminderMinutes);
    setReminderLabel('');
  };

  const themeList = Object.values(THEMES);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Top Banner */}
      <div className="glass-morphism rounded-2xl border border-[#BF953F]/30 p-6 bg-black/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.3em] px-2.5 py-0.5 rounded-full bg-[#BF953F]/20 text-[#FCF6BA] border border-[#BF953F]/40 font-black">
            OMAKASE THEMING & ALARMS
          </span>
          <h2 className="text-2xl font-bold gold-text tracking-tight mt-2">
            Luxury Design Palettes & Desktop Reminders
          </h2>
          <p className="text-gray-400 text-xs mt-1 max-w-2xl">
            Custom styling inspired by Omarchy's <code>colors.toml</code> system. Switch between five obsidian glassmorphic palettes with live CSS root variable updates, and manage background task reminders.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] font-mono text-gray-400 uppercase">Active Theme</div>
            <div className="text-sm font-bold text-[#FCF6BA]">{currentTheme.name}</div>
          </div>
          <button
            onClick={() => themingService.cycleTheme()}
            className="px-3 py-2 rounded-xl bg-[#BF953F]/20 hover:bg-[#BF953F]/30 border border-[#BF953F]/40 text-xs font-mono text-[#FCF6BA] transition-all"
          >
            Cycle Theme ↻
          </button>
        </div>
      </div>

      {/* Themes Grid */}
      <div className="space-y-3">
        <div className="text-xs font-mono uppercase tracking-wider text-gray-400 px-1">
          Curated Luxury Themes (5 Presets)
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {themeList.map(theme => {
            const isSelected = currentTheme.id === theme.id;
            return (
              <div
                key={theme.id}
                onClick={() => handleSelectTheme(theme.id)}
                className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between relative overflow-hidden ${
                  isSelected
                    ? 'bg-[#BF953F]/20 border-[#BF953F] shadow-[0_0_25px_rgba(191,149,63,0.25)] scale-[1.02]'
                    : 'glass-morphism border-white/10 hover:border-[#BF953F]/40 bg-black/50 hover:scale-[1.01]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-white">{theme.name}</span>
                    {isSelected && (
                      <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-[#BF953F] text-black font-bold">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mb-4 line-clamp-2">
                    {theme.tagline}
                  </p>
                </div>

                {/* Color Swatches */}
                <div className="flex items-center gap-1.5 p-2 rounded-xl bg-black/60 border border-white/5">
                  {theme.previewColors.map((col, idx) => (
                    <div
                      key={idx}
                      className="w-5 h-5 rounded-full border border-white/10 shadow-inner"
                      style={{ backgroundColor: col }}
                      title={col}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Reminders & Task Schedulers Studio */}
      <div className="glass-morphism rounded-2xl border border-white/10 p-6 bg-black/70 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span>Harness Task Reminders & Alarms</span>
              <span className="text-xs font-mono text-[#FCF6BA] px-2 py-0.5 rounded bg-[#BF953F]/20 border border-[#BF953F]/30">
                CLI: luminara reminder
              </span>
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Replaces manual alarms with persistent in-browser background task schedules (e.g. re-crawl competitor SERP in 30 minutes).
            </p>
          </div>

          {reminders.length > 0 && (
            <button
              onClick={() => reminderService.clearAll()}
              className="text-[10px] font-mono uppercase tracking-wider text-gray-400 hover:text-red-400 transition-colors"
            >
              Clear All Reminders
            </button>
          )}
        </div>

        {/* Schedule Creation Form */}
        <form onSubmit={handleAddReminder} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <div className="sm:col-span-8">
            <input
              type="text"
              value={reminderLabel}
              onChange={e => setReminderLabel(e.target.value)}
              placeholder='e.g., "Re-crawl Stripe vs Square AEO SERP metrics" or "Export PyTorch model weights"'
              className="w-full bg-black/60 border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none focus:border-[#BF953F]"
            />
          </div>

          <div className="sm:col-span-2">
            <select
              value={reminderMinutes}
              onChange={e => setReminderMinutes(Number(e.target.value))}
              className="w-full bg-black/60 border border-white/10 rounded-xl p-3 text-xs text-white font-mono focus:outline-none focus:border-[#BF953F]"
            >
              <option value={5}>5 Minutes</option>
              <option value={15}>15 Minutes</option>
              <option value={30}>30 Minutes</option>
              <option value={60}>1 Hour</option>
              <option value={120}>2 Hours</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={!reminderLabel.trim()}
              className="w-full h-full py-3 rounded-xl bg-[#BF953F] hover:bg-[#AA771C] text-black font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40"
            >
              Set Timer
            </button>
          </div>
        </form>

        {/* Active Reminders List */}
        <div className="space-y-2">
          <div className="text-xs font-mono uppercase tracking-wider text-gray-400">
            Scheduled Reminders ({reminders.length})
          </div>

          {reminders.length === 0 ? (
            <div className="p-4 rounded-xl border border-white/5 bg-white/[0.01] text-xs font-mono text-gray-500 text-center">
              No active reminders. Schedule one using the form above or via Omnibar (<code>Cmd+K</code>).
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {reminders.map(rem => {
                const remainingMinutes = Math.max(0, Math.round((rem.dueAt - Date.now()) / 60000));
                return (
                  <div
                    key={rem.id}
                    className="p-3 rounded-xl border border-white/5 bg-black/50 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => reminderService.markCompleted(rem.id)}
                        className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                          rem.completed ? 'bg-emerald-500 border-emerald-500 text-black text-[10px]' : 'border-gray-500 hover:border-white'
                        }`}
                      >
                        {rem.completed && '✓'}
                      </button>
                      <div>
                        <div className={`text-xs font-bold ${rem.completed ? 'line-through text-gray-500' : 'text-white'}`}>
                          {rem.label}
                        </div>
                        <div className="text-[10px] font-mono text-gray-400">
                          Due in {remainingMinutes} min ({new Date(rem.dueAt).toLocaleTimeString()})
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => reminderService.deleteReminder(rem.id)}
                      className="text-gray-500 hover:text-red-400 text-xs px-2 py-1 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
