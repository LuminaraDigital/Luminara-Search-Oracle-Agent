import React, { useState, useEffect } from 'react';
import { AgentMatrixPanel } from './AgentMatrixPanel';
import { CliTerminalPanel } from './CliTerminalPanel';
import { SkillsHubPanel } from './SkillsHubPanel';
import { TestingHarnessPanel } from './TestingHarnessPanel';
import { TriagePanel } from './TriagePanel';
import { ThemingStudioPanel } from './ThemingStudioPanel';
import { VfsStudioPanel } from './VfsStudioPanel';
import { ContextGraphPanel } from './ContextGraphPanel';
import { SwitchyardPanel } from './SwitchyardPanel';
import { AppView, BusinessDNA } from '../../types';

interface ArchyHarnessViewProps {
  onNavigate: (view: AppView) => void;
  dna?: BusinessDNA | null;
  onOpenOmnibar?: () => void;
}

type HarnessTab = 'agents' | 'switchyard' | 'graph' | 'vfs' | 'cli' | 'skills' | 'testing' | 'triage' | 'theming';

const HARNESS_TAB_KEY = 'luminara_harness_tab';

function readInitialTab(): HarnessTab {
  try {
    const hash = window.location.hash.toLowerCase();
    if (hash.includes('switchyard')) return 'switchyard';
    if (hash.includes('graph')) return 'graph';
    if (hash.includes('vfs')) return 'vfs';
    if (hash.includes('cli')) return 'cli';
    if (hash.includes('skills')) return 'skills';
    if (hash.includes('testing')) return 'testing';
    if (hash.includes('triage')) return 'triage';
    if (hash.includes('theming')) return 'theming';
    const t = sessionStorage.getItem(HARNESS_TAB_KEY) as HarnessTab | null;
    if (t && ['agents', 'switchyard', 'graph', 'vfs', 'cli', 'skills', 'testing', 'triage', 'theming'].includes(t)) {
      return t;
    }
  } catch {
    /* ignore */
  }
  return 'agents';
}

export const ArchyHarnessView: React.FC<ArchyHarnessViewProps> = ({
  onNavigate,
  onOpenOmnibar
}) => {
  const [activeTab, setActiveTab] = useState<HarnessTab>(readInitialTab);

  useEffect(() => {
    try {
      sessionStorage.setItem(HARNESS_TAB_KEY, activeTab);
    } catch {
      /* ignore */
    }
  }, [activeTab]);

  useEffect(() => {
    const syncTab = () => {
      const t = readInitialTab();
      setActiveTab(t);
    };
    window.addEventListener('luminara-harness-tab', syncTab);
    return () => window.removeEventListener('luminara-harness-tab', syncTab);
  }, []);

  const tabs: Array<{ id: HarnessTab; label: string; icon: string; badge?: string }> = [
    { id: 'agents', label: 'Agents & Quotas', icon: '⚡' },
    { id: 'switchyard', label: 'Switchyard Router', icon: '⮀', badge: 'NeMo' },
    { id: 'graph', label: 'Context Graph', icon: '◈', badge: 'KG' },
    { id: 'vfs', label: 'Context VFS (OpenViking)', icon: '🗂', badge: 'L0/L1/L2' },
    { id: 'cli', label: 'Command CLI', icon: '➜' },
    { id: 'skills', label: 'Universal Skills', icon: '✦' },
    { id: 'testing', label: 'Acceptance Harness', icon: '🛡', badge: '100%' },
    { id: 'triage', label: 'Crash Triage', icon: '⚕' },
    { id: 'theming', label: 'Omakase Theming', icon: '❖' }
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onNavigate(AppView.DASHBOARD)}
              className="text-xs font-mono text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <span>←</span>
              <span>Command Suite</span>
            </button>
            <span className="text-gray-600">•</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gold/20 text-gold-light border border-gold/30 font-bold uppercase">
              Luminara Archy v2.4
            </span>
          </div>
          <h1 className="text-3xl font-extrabold gold-text tracking-tight mt-2">
            Developer Harness & Agentic OS
          </h1>
          <p className="text-xs text-gray-400 mt-1 max-w-2xl">
            A comprehensive, luxury-designed development harness incorporating Omarchy's multi-agent fleet orchestrator, CLI metadata router, context graph, universal skills exporter, acceptance testing framework, crash diagnostics, and omakase theming.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {onOpenOmnibar && (
            <button
              onClick={onOpenOmnibar}
              className="px-4 py-2 rounded-xl glass-morphism border border-gold/40 hover:border-gold text-xs font-mono text-gold-light transition-all flex items-center gap-2"
            >
              <span>Omnibar</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-[10px]">Cmd+K</kbd>
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-white/5 scrollbar-none">
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-xl text-xs font-mono transition-all flex items-center gap-2 shrink-0 border ${
                isActive
                  ? 'bg-gold/20 text-gold-light border-gold/60 font-bold shadow-[0_0_20px_rgba(191,149,63,0.15)]'
                  : 'text-gray-400 hover:text-white border-transparent hover:bg-white/5'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-success-500/20 text-success-400 font-bold border border-success-500/30">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-[500px]">
        {activeTab === 'agents' && <AgentMatrixPanel />}
        {activeTab === 'switchyard' && <SwitchyardPanel />}
        {activeTab === 'graph' && <ContextGraphPanel />}
        {activeTab === 'vfs' && <VfsStudioPanel />}
        {activeTab === 'cli' && <CliTerminalPanel />}
        {activeTab === 'skills' && <SkillsHubPanel />}
        {activeTab === 'testing' && <TestingHarnessPanel />}
        {activeTab === 'triage' && <TriagePanel />}
        {activeTab === 'theming' && <ThemingStudioPanel />}
      </div>
    </div>
  );
};
