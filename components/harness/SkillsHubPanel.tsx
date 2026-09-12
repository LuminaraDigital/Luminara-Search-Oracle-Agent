import React, { useState } from 'react';
import { skillsGeneratorService, LUMINARA_SKILLS } from '../../services/harness/skillsGeneratorService';
import { SkillPlatform, LuminaraSkill } from '../../types';

import { downloadBlob } from '../../utils/download';
import { copyToClipboard } from '../../utils/clipboard';

export const SkillsHubPanel: React.FC = () => {
  const [selectedSkillId, setSelectedSkillId] = useState<string>(LUMINARA_SKILLS[0].id);
  const [activePlatform, setActivePlatform] = useState<SkillPlatform>('antigravity');
  const [copied, setCopied] = useState(false);

  const selectedSkill = LUMINARA_SKILLS.find(s => s.id === selectedSkillId) || LUMINARA_SKILLS[0];
  const formattedCode = skillsGeneratorService.formatForPlatform(selectedSkill, activePlatform);
  const installPath = skillsGeneratorService.getInstallPath(selectedSkill, activePlatform);

  const handleCopy = async () => {
    const success = await copyToClipboard(formattedCode);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    downloadBlob(formattedCode, `${selectedSkill.name}.md`, 'text/markdown');
  };

  const platforms: Array<{ id: SkillPlatform; name: string; icon: string }> = [
    { id: 'antigravity', name: 'Google Antigravity', icon: '✦' },
    { id: 'claude', name: 'Claude Code', icon: '✻' },
    { id: 'codex', name: 'OpenAI Codex', icon: '⌘' },
    { id: 'hermes', name: 'Hermes 3', icon: '☤' },
    { id: 'pi', name: 'Pi Mono', icon: 'π' }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner */}
      <div className="glass-morphism rounded-2xl border border-gold/30 p-6 bg-black/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-[0.3em] px-2.5 py-0.5 rounded-full bg-gold/20 text-gold-light border border-gold/40 font-black">
            UNIVERSAL SKILLS HUB
          </span>
          <h2 className="text-2xl font-bold gold-text tracking-tight mt-2">
            Cross-Agent Skills Exporter & Registry
          </h2>
          <p className="text-gray-400 text-xs mt-1 max-w-2xl">
            Package and export Luminara capabilities (Agent Conduct, AEO Audit, SLM Studio, TimesFM, DNA Sequencer, and more) as standard <code>SKILL.md</code> bundles for Antigravity, Claude Code, Codex, Hermes, and Pi.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="px-4 py-2 rounded-xl bg-gold hover:bg-gold-dark text-black font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-1.5"
          >
            <span>Download .SKILL</span>
            <span>↓</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Skill List + Platform Tabs & Code Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Skill List */}
        <div className="lg:col-span-4 space-y-2.5">
          <div className="text-xs font-mono uppercase tracking-wider text-gray-400 px-1">
            Luminara Domain Skills ({LUMINARA_SKILLS.length})
          </div>

          {LUMINARA_SKILLS.map(skill => {
            const isSelected = skill.id === selectedSkillId;
            return (
              <div
                key={skill.id}
                onClick={() => setSelectedSkillId(skill.id)}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-gold/15 border-gold shadow-[0_0_15px_rgba(191,149,63,0.15)]'
                    : 'glass-morphism border-white/5 hover:border-gold/30 bg-black/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white">{skill.title}</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                    v{skill.version}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">
                  {skill.description}
                </p>
                <div className="flex items-center gap-2 mt-3 text-[9px] font-mono text-gold-light">
                  <span>Tools: {skill.tools.length}</span>
                  <span>•</span>
                  <span>Category: {skill.category}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Platform Formatter & Markdown Viewer */}
        <div className="lg:col-span-8 space-y-4">
          {/* Platform Tab Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-3 glass-morphism rounded-xl border border-white/5 p-2 bg-black/60">
            <div className="flex flex-wrap gap-1.5">
              {platforms.map(p => (
                <button
                  key={p.id}
                  onClick={() => setActivePlatform(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5 ${
                    activePlatform === p.id
                      ? 'bg-gold/20 text-gold-light border border-gold/50 font-bold'
                      : 'text-gray-400 hover:text-white border border-transparent hover:bg-white/5'
                  }`}
                >
                  <span>{p.icon}</span>
                  <span>{p.name}</span>
                </button>
              ))}
            </div>

            <button
              onClick={handleCopy}
              className="px-3 py-1 rounded-lg border border-gold/30 bg-gold/10 hover:bg-gold/20 text-[10px] font-mono uppercase tracking-wider text-gold-light transition-all"
            >
              {copied ? 'Copied to Clipboard!' : 'Copy Skill Spec'}
            </button>
          </div>

          {/* Installation Path Banner */}
          <div className="px-4 py-2 rounded-xl bg-white/[0.02] border border-white/5 text-[11px] font-mono text-gray-400 flex items-center justify-between">
            <span>Target Path:</span>
            <code className="text-gold-light">{installPath}</code>
          </div>

          {/* Markdown Code Preview Box */}
          <div className="glass-morphism rounded-2xl border border-white/10 p-4 bg-black/90 font-mono text-xs text-gray-300 overflow-y-auto max-h-[500px] leading-relaxed whitespace-pre-wrap select-text">
            {formattedCode}
          </div>
        </div>
      </div>
    </div>
  );
};
