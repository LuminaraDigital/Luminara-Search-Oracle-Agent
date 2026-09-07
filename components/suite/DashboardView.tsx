import React from 'react';
import { AppView, BusinessDNA } from '../../types';
import { ICONS } from '../../constants';

interface DashboardViewProps {
  onNavigate: (view: AppView) => void;
  dna: BusinessDNA | null;
  onClearDNA?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, dna }) => {
  const protocolGroups = [
    {
      label: "Search & Visibility Intelligence",
      cards: [
        {
          id: AppView.ORACLE_AGENT,
          title: 'Oracle Agent Terminal',
          desc: 'Conversational & autonomous search simulation with Flash and Deep Think modes.',
          icon: ICONS.Terminal,
          badge: 'Core Engine',
          accent: 'text-[#FCF6BA]'
        },
        {
          id: AppView.INSTANT_AUDIT,
          title: 'Instant Search & AEO Audit',
          desc: 'Deep SERP scanner with Visibility Radar, Competitor Reality Map, and ROI arbiter.',
          icon: ICONS.Radar,
          badge: 'SEO / AEO / GEO',
          accent: 'text-[#FCF6BA]'
        }
      ]
    },
    {
      label: "Foundation & Strategic DNA",
      cards: [
        {
          id: AppView.BUSINESS_DNA,
          title: 'Strategic Business DNA',
          desc: dna ? `Linked to ${dna.name}. Sequenced genome guiding all reasoning.` : 'Scan business URL to extract mission, USP, and competitive gaps.',
          icon: ICONS.DNA,
          badge: dna ? 'Active Link' : 'Not Linked',
          accent: dna ? 'text-emerald-400' : 'text-[#BF953F]'
        },
        {
          id: AppView.VISION,
          title: 'Manifesto of Autonomy',
          desc: 'The four-step methodology and architectural principles behind Luminara Search.',
          icon: ICONS.Shield,
          badge: 'Methodology',
          accent: 'text-[#FCF6BA]'
        }
      ]
    },
    {
      label: "Predictive Intelligence & Foundation Modeling",
      cards: [
        {
          id: AppView.ORACLE_MIND,
          title: 'OracleMind SLM Studio',
          desc: 'Train, fine-tune (LoRA, DPO, GRPO), evaluate, and export custom 26M-100M domain SLMs for low-latency on-device SERP reasoning.',
          icon: ICONS.Brain,
          badge: 'Lab · Simulated',
          accent: 'text-[#FCF6BA]'
        },
        {
          id: AppView.TIMESFM_FORECAST,
          title: 'TimesFM Foundation Forecaster',
          desc: 'Zero-shot patch-based time-series foundation model with multi-quantile probabilistic cones (p10..p90) and scenario simulations.',
          icon: ICONS.TimeSeries,
          badge: 'Lab · Simulated',
          accent: 'text-[#FCF6BA]'
        },
        {
          id: AppView.DATA_ANALYST,
          title: 'Deep Intelligence Analyst',
          desc: 'Multi-modal analysis and Python synthesis of private data, metrics, and CSVs.',
          icon: ICONS.Analyst,
          badge: 'Code Execution',
          accent: 'text-[#FCF6BA]'
        }
      ]
    },
    {
      label: "Adversarial Ops & Market Operations",
      cards: [
        {
          id: AppView.STRESS_TEST,
          title: 'Red Team Stress Test',
          desc: 'Adversarial predator simulation testing your business strategy against market forces.',
          icon: ICONS.Stress,
          badge: 'Thinking Budget',
          accent: 'text-[#FCF6BA]'
        },
        {
          id: AppView.RESEARCH,
          title: 'Global Grounding Engine',
          desc: 'Live multi-source market intelligence with Google Search and Google Maps.',
          icon: ICONS.Research,
          badge: 'Maps & Web',
          accent: 'text-[#FCF6BA]'
        },
        {
          id: AppView.ORGANIZER,
          title: 'Strategic Structuring',
          desc: 'Transform raw notes and concepts into executive Business Plans and Timelines.',
          icon: ICONS.Organizer,
          badge: 'Executive Synthesis',
          accent: 'text-[#FCF6BA]'
        }
      ]
    },
    {
      label: "Developer Harness & Autonomous OS (Luminara Archy)",
      cards: [
        {
          id: AppView.HARNESS,
          title: 'Luminara Archy Harness',
          desc: 'Comprehensive developer harness with multi-agent fleet quotas, CLI metadata router, universal skills exporter, acceptance testing, and crash triage.',
          icon: ICONS.Terminal,
          badge: 'Archy Studio',
          accent: 'text-[#FCF6BA]'
        },
        {
          id: AppView.HARNESS,
          title: 'Viking Context VFS OS',
          desc: `Hierarchical agent context database with L0/L1/L2 multi-resolution distillation, Directory Recursive Retrieval, and 6-category self-evolving memory.`,
          icon: ICONS.FileText,
          badge: 'OpenViking VFS',
          accent: 'text-[#FCF6BA]'
        },
        {
          id: AppView.HARNESS,
          title: 'Luminara Context Graph',
          desc: 'AEO entity knowledge graph with decision provenance, conflict detection, hybrid VFS retrieval, and Organization JSON-LD export.',
          icon: ICONS.Radar,
          badge: 'KG / Provenance',
          accent: 'text-[#FCF6BA]',
          harnessTab: 'graph'
        }
      ]
    }
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      {/* Executive Command Header */}
      <div className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-white/10 pb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="w-8 h-[1px] bg-[#BF953F]"></span>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-[#FCF6BA]">Executive Command Center</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Luminara Search Suite
          </h1>
          <p className="text-xs text-gray-400 mt-1 max-w-xl leading-relaxed">
            Unified strategic platform replacing expensive agency retainers with continuous search intelligence and autonomous agentic workflows.
          </p>
        </div>

        {/* DNA Status Widget */}
        <div className="glass-morphism rounded-2xl p-4 border border-[#BF953F]/30 flex items-center gap-4 shrink-0 bg-black/60">
          <div className={`w-3 h-3 rounded-full ${dna ? 'bg-emerald-400 shadow-[0_0_12px_#10B981]' : 'bg-[#BF953F] animate-pulse'}`}></div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Strategic Genome</div>
            <div className="text-xs font-bold text-white">
              {dna ? dna.name : 'System Standby'}
            </div>
          </div>
          <button
            onClick={() => onNavigate(AppView.BUSINESS_DNA)}
            className="px-3 py-1.5 rounded-lg bg-[#BF953F]/10 border border-[#BF953F]/30 text-[9px] font-bold uppercase tracking-wider text-[#FCF6BA] hover:bg-[#BF953F]/20 transition-all"
          >
            {dna ? 'Inspect' : 'Sequence'}
          </button>
        </div>
      </div>

      {/* Protocol Groups Grid */}
      <div className="space-y-10">
        {protocolGroups.map((group, gIdx) => (
          <div key={gIdx} className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[#BF953F]">{group.label}</span>
              <div className="flex-1 h-[1px] bg-white/5"></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {group.cards.map((card) => {
                const IconComponent = card.icon;
                const harnessTab = (card as { harnessTab?: string }).harnessTab;
                return (
                  <div
                    key={card.title}
                    onClick={() => {
                      if (harnessTab) {
                        try {
                          sessionStorage.setItem('luminara_harness_tab', harnessTab);
                          window.dispatchEvent(new Event('luminara-harness-tab'));
                        } catch {
                          /* ignore */
                        }
                      } else if (card.id === AppView.HARNESS && card.title.includes('VFS')) {
                        try {
                          sessionStorage.setItem('luminara_harness_tab', 'vfs');
                          window.dispatchEvent(new Event('luminara-harness-tab'));
                        } catch {
                          /* ignore */
                        }
                      }
                      onNavigate(card.id);
                    }}
                    className="glass-morphism rounded-2xl border border-white/10 hover:border-[#BF953F]/50 p-6 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-[#BF953F]/5 group bg-black/40"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-3 rounded-xl bg-[#BF953F]/10 border border-[#BF953F]/30 text-[#FCF6BA] group-hover:scale-110 transition-transform">
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[9px] font-mono uppercase tracking-widest text-gray-400 group-hover:text-[#FCF6BA] transition-colors">
                        {card.badge}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-white mb-1.5 group-hover:text-[#FCF6BA] transition-colors flex items-center justify-between">
                      <span>{card.title}</span>
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity text-xs">&rarr;</span>
                    </h3>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      {card.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
