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
          title: 'Ask a question',
          desc: 'Chat with an analyst that checks live search results and remembers your business.',
          icon: ICONS.Terminal,
          badge: 'Core Engine',
          accent: 'text-gold-light'
        },
        {
          id: AppView.INSTANT_AUDIT,
          title: 'Audit my website',
          desc: 'See how you show up in Google and AI answers, who beats you, and what to fix first.',
          icon: ICONS.Radar,
          badge: 'SEO / AEO / GEO',
          accent: 'text-gold-light'
        }
      ]
    },
    {
      label: "Your business",
      cards: [
        {
          id: AppView.BUSINESS_DNA,
          title: 'My business profile',
          desc: dna ? `Set to ${dna.name}. Every audit and answer is tailored to it.` : 'Paste your website once. We learn what you sell, to whom, and who you compete with.',
          icon: ICONS.DNA,
          badge: dna ? 'Active Link' : 'Not Linked',
          accent: dna ? 'text-success-400' : 'text-gold'
        },
        {
          id: AppView.VISION,
          title: 'How Luminara works',
          desc: 'The four-step methodology and architectural principles behind Luminara Search.',
          icon: ICONS.Shield,
          badge: 'Methodology',
          accent: 'text-gold-light'
        }
      ]
    },
    {
      label: "Labs (technical previews, simulated numbers)",
      cards: [
        {
          id: AppView.ORACLE_MIND,
          title: 'OracleMind SLM Studio',
          desc: 'Train, fine-tune (LoRA, DPO, GRPO), evaluate, and export custom 26M-100M domain SLMs for low-latency on-device SERP reasoning.',
          icon: ICONS.Brain,
          badge: 'Lab · Simulated',
          accent: 'text-gold-light'
        },
        {
          id: AppView.TIMESFM_FORECAST,
          title: 'TimesFM Foundation Forecaster',
          desc: 'Zero-shot patch-based time-series foundation model with multi-quantile probabilistic cones (p10..p90) and scenario simulations.',
          icon: ICONS.TimeSeries,
          badge: 'Lab · Simulated',
          accent: 'text-gold-light'
        },
        {
          id: AppView.DATA_ANALYST,
          title: 'Analyse my data',
          desc: 'Multi-modal analysis and Python synthesis of private data, metrics, and CSVs.',
          icon: ICONS.Analyst,
          badge: 'Code Execution',
          accent: 'text-gold-light'
        }
      ]
    },
    {
      label: "Adversarial Ops & Market Operations",
      cards: [
        {
          id: AppView.STRESS_TEST,
          title: 'Poke holes in my plan',
          desc: 'Adversarial predator simulation testing your business strategy against market forces.',
          icon: ICONS.Stress,
          badge: 'Thinking Budget',
          accent: 'text-gold-light'
        },
        {
          id: AppView.RESEARCH,
          title: 'Research the market',
          desc: 'Live multi-source market intelligence with Google Search and Google Maps.',
          icon: ICONS.Research,
          badge: 'Maps & Web',
          accent: 'text-gold-light'
        },
        {
          id: AppView.ORGANIZER,
          title: 'Turn notes into a plan',
          desc: 'Transform raw notes and concepts into executive Business Plans and Timelines.',
          icon: ICONS.Organizer,
          badge: 'Executive Synthesis',
          accent: 'text-gold-light'
        }
      ]
    },
    {
      label: "Developer tools (Labs)",
      cards: [
        {
          id: AppView.HARNESS,
          title: 'Luminara Archy Harness',
          desc: 'Comprehensive developer harness with multi-agent fleet quotas, CLI metadata router, universal skills exporter, acceptance testing, and crash triage.',
          icon: ICONS.Terminal,
          badge: 'Archy Studio',
          accent: 'text-gold-light'
        },
        {
          id: AppView.HARNESS,
          title: 'Viking Context VFS OS',
          desc: `Hierarchical agent context database with L0/L1/L2 multi-resolution distillation, Directory Recursive Retrieval, and 6-category self-evolving memory.`,
          icon: ICONS.FileText,
          badge: 'OpenViking VFS',
          accent: 'text-gold-light'
        },
        {
          id: AppView.HARNESS,
          title: 'Luminara Context Graph',
          desc: 'AEO entity knowledge graph with decision provenance, conflict detection, hybrid VFS retrieval, and Organization JSON-LD export.',
          icon: ICONS.Radar,
          badge: 'KG / Provenance',
          accent: 'text-gold-light',
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
            <span className="w-8 h-[1px] bg-gold"></span>
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-gold-light">Home</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            What would you like to do?
          </h1>
          <p className="text-xs text-gray-400 mt-1 max-w-xl leading-relaxed">
            Start with an audit of your website, then ask follow-up questions. Add your business profile once and every answer is tailored to you.
          </p>
        </div>

        {/* DNA Status Widget */}
        <div className="glass-morphism rounded-2xl p-4 border border-gold/30 flex items-center gap-4 shrink-0 bg-black/60">
          <div className={`w-3 h-3 rounded-full ${dna ? 'bg-success-400 shadow-[0_0_12px_#10B981]' : 'bg-gold animate-pulse'}`}></div>
          <div>
            <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Business profile</div>
            <div className="text-xs font-bold text-white">
              {dna ? dna.name : 'Not set up yet'}
            </div>
          </div>
          <button
            onClick={() => onNavigate(AppView.BUSINESS_DNA)}
            className="px-3 py-1.5 rounded-lg bg-gold/10 border border-gold/30 text-[9px] font-bold uppercase tracking-wider text-gold-light hover:bg-gold/20 transition-all"
          >
            {dna ? 'View' : 'Set up'}
          </button>
        </div>
      </div>

      {/* Protocol Groups Grid */}
      <div className="space-y-10">
        {protocolGroups.map((group, gIdx) => (
          <div key={gIdx} className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gold">{group.label}</span>
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
                    className="glass-morphism rounded-2xl border border-white/10 hover:border-gold/50 p-6 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-gold/5 group bg-black/40"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-3 rounded-xl bg-gold/10 border border-gold/30 text-gold-light group-hover:scale-110 transition-transform">
                        <IconComponent className="w-5 h-5" />
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-[9px] font-mono uppercase tracking-widest text-gray-400 group-hover:text-gold-light transition-colors">
                        {card.badge}
                      </span>
                    </div>
                    <h3 className="text-base font-bold text-white mb-1.5 group-hover:text-gold-light transition-colors flex items-center justify-between">
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
