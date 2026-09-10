import React from 'react';
import { AgentActivityEvent, AgentRole, AgentStatus } from '../../services/agentCore/types';
import { CREW_PROFILES } from '../../services/agentCore/crewOrchestrator';

interface AgentMissionControlProps {
  events: AgentActivityEvent[];
  isComplete: boolean;
  onViewAttestation?: () => void;
  hasAttestation?: boolean;
}

export const AgentMissionControl: React.FC<AgentMissionControlProps> = ({
  events,
  isComplete,
  onViewAttestation,
  hasAttestation,
}) => {
  // Find latest status for each role
  const roleStatuses = React.useMemo(() => {
    const map: Record<AgentRole, { status: AgentStatus; message: string; timestamp: number }> = {
      scout: { status: 'idle', message: 'Standing by to crawl target URL…', timestamp: 0 },
      serp_radar: { status: 'idle', message: 'Standing by to probe live search engines…', timestamp: 0 },
      playbook_auditor: { status: 'idle', message: 'Waiting for scraped evidence…', timestamp: 0 },
      competitor_strategist: { status: 'idle', message: 'Waiting for search intelligence…', timestamp: 0 },
      adversarial_critic: { status: 'idle', message: 'Waiting to cross-examine findings…', timestamp: 0 },
      remediation_architect: { status: 'idle', message: 'Waiting for verified findings…', timestamp: 0 },
      executive_translator: { status: 'idle', message: 'Waiting for technical synthesis…', timestamp: 0 },
    };

    events.forEach((ev) => {
      if (map[ev.agentRole]) {
        map[ev.agentRole] = {
          status: ev.status,
          message: ev.message,
          timestamp: ev.timestamp,
        };
      }
    });

    return map;
  }, [events]);

  const latestEvent = events.length > 0 ? events[events.length - 1] : null;
  const completedCount = Object.values(roleStatuses).filter((r) => r.status === 'completed').length;
  const progressPercent = Math.min(100, Math.round((completedCount / 7) * 100));

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 mb-8 shadow-2xl backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              {!isComplete ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </>
              ) : (
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
              )}
            </span>
            <h3 className="text-base font-semibold text-white tracking-wide">
              Autonomous Search Crew Mission Control
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {isComplete
              ? 'Multi-agent audit complete. 100% verified against ground-truth evidence.'
              : 'Autonomous specialist agents actively collaborating on your audit…'}
          </p>
        </div>

        {/* Action badge */}
        {isComplete && hasAttestation && onViewAttestation && (
          <button
            onClick={onViewAttestation}
            className="self-start sm:self-auto inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium transition-colors"
          >
            <span>🛡️</span>
            <span>View Verified On-Chain Attestation</span>
          </button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mt-4 mb-4">
        <div className="flex justify-between text-xs text-slate-400 mb-1.5 font-mono">
          <span>PIPELINE PROGRESS</span>
          <span>{progressPercent}% COMPLETE</span>
        </div>
        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 transition-all duration-500 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Live Agent Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-4">
        {(Object.keys(CREW_PROFILES) as AgentRole[]).map((role) => {
          const profile = CREW_PROFILES[role];
          const state = roleStatuses[role];
          const isRunning = state.status === 'running' || state.status === 'reflecting';
          const isDone = state.status === 'completed';

          return (
            <div
              key={role}
              className={`p-3 rounded-lg border transition-all text-left flex flex-col justify-between ${
                isRunning
                  ? 'bg-indigo-950/40 border-indigo-500/60 shadow-lg shadow-indigo-500/10'
                  : isDone
                  ? 'bg-slate-800/40 border-slate-700/60'
                  : 'bg-slate-900/40 border-slate-800/40 opacity-60'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{profile.avatar}</span>
                    <div>
                      <h4 className="text-xs font-semibold text-slate-200 leading-tight">
                        {profile.name}
                      </h4>
                      <p className="text-[10px] text-slate-400 leading-none">{profile.tagline}</p>
                    </div>
                  </div>

                  {/* Status Indicator */}
                  {isRunning && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 animate-pulse">
                      {state.status === 'reflecting' ? 'Reflecting' : 'Running'}
                    </span>
                  )}
                  {isDone && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      ✓ Done
                    </span>
                  )}
                  {state.status === 'idle' && (
                    <span className="text-[10px] text-slate-500">Queued</span>
                  )}
                </div>

                <p className="text-[11px] text-slate-300 line-clamp-2 leading-relaxed">
                  {state.message}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Stream Ticker */}
      {latestEvent && !isComplete && (
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-400 font-mono">
          <span className="text-indigo-400">⚡ LIVE TICKER:</span>
          <span className="text-slate-200 truncate">{latestEvent.message}</span>
        </div>
      )}
    </div>
  );
};
