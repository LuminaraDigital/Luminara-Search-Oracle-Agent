import React from 'react';
import { AgentRole } from '../../services/agentCore/types';
import { CREW_PROFILES } from '../../services/agentCore/crewOrchestrator';

export interface AgentRosterBarProps {
  selectedRole: AgentRole | null;
  onSelectRole: (role: AgentRole | null) => void;
  disabled?: boolean;
}

const ROSTER_ROLES: AgentRole[] = [
  'serp_radar',
  'scout',
  'remediation_architect',
  'playbook_auditor',
  'competitor_strategist',
  'executive_translator',
  'adversarial_critic',
];

export const AgentRosterBar: React.FC<AgentRosterBarProps> = ({
  selectedRole,
  onSelectRole,
  disabled = false,
}) => {
  const activeProfile = selectedRole ? CREW_PROFILES[selectedRole] : null;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 mb-2">
      {/* Roster Horizontal Selector */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
        {/* Default: Oracle Mind */}
        <button
          type="button"
          onClick={() => onSelectRole(null)}
          disabled={disabled}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 border ${
            selectedRole === null
              ? 'bg-gold/20 text-gold-light border-gold/50 shadow-md shadow-gold/10'
              : 'bg-black/40 text-gray-400 border-white/10 hover:border-gold/30 hover:text-gray-200'
          }`}
        >
          <span>🔮</span>
          <span>Oracle Mind</span>
        </button>

        {/* Crew Specialists */}
        {ROSTER_ROLES.map((role) => {
          const profile = CREW_PROFILES[role];
          const isSelected = selectedRole === role;
          return (
            <button
              key={role}
              type="button"
              onClick={() => onSelectRole(isSelected ? null : role)}
              disabled={disabled}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 border ${
                isSelected
                  ? 'bg-gold/20 text-gold-light border-gold/50 shadow-md shadow-gold/10'
                  : 'bg-black/40 text-gray-400 border-white/10 hover:border-gold/30 hover:text-gray-200'
              }`}
            >
              <span>{profile.avatar}</span>
              <span>{profile.name}</span>
            </button>
          );
        })}
      </div>

      {/* Active Specialist Banner */}
      {activeProfile && (
        <div className="mt-1.5 px-3 py-1.5 rounded-xl bg-gold/5 border border-gold/20 flex items-center justify-between text-xs animate-fadeIn">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm shrink-0">{activeProfile.avatar}</span>
            <div className="truncate">
              <span className="font-semibold text-gold-light mr-1.5">
                {activeProfile.name}:
              </span>
              <span className="text-gray-400 truncate">
                {activeProfile.tagline} - {activeProfile.goal}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectRole(null)}
            className="text-[11px] text-gray-400 hover:text-gold shrink-0 ml-2"
          >
            Reset ✕
          </button>
        </div>
      )}
    </div>
  );
};
