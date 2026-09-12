import React from 'react';
import { ICONS } from '../../constants';

export const VisionView: React.FC = () => {
  const steps = [
    {
      step: '01',
      title: 'Digital DNA Sequencing',
      desc: 'Every enterprise has a unique strategic genome. We begin by sequencing your USP, target audience, and market position to provide context-aware intelligence.'
    },
    {
      step: '02',
      title: 'Adversarial Red Team Audit',
      desc: 'Your strategy meets our predator simulator. We intentionally hunt for technical debt, market saturation risks, and competitive vulnerabilities before they become fatal.'
    },
    {
      step: '03',
      title: 'Global Search Grounding',
      desc: 'Assumptions are reality-checked against real-time web SERPs and local maps to discover true citation whitespace and untapped revenue nodes.'
    },
    {
      step: '04',
      title: 'Executive Synthesis',
      desc: 'Findings are transformed into executive-ready tactical dossiers—AEO briefs, business plans, or project roadmaps organized for immediate execution.'
    }
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 animate-in fade-in duration-700 pb-20">
      <header className="mb-16 text-center relative pt-8">
        <div className="inline-flex items-center gap-4 mb-6">
          <div className="w-12 h-[1px] bg-gold/40"></div>
          <span className="text-gold-light font-black text-[10px] uppercase tracking-[0.6em]">Strategic Methodology</span>
          <div className="w-12 h-[1px] bg-gold/40"></div>
        </div>
        <h1 className="text-4xl sm:text-7xl font-light text-white mb-6 tracking-tight leading-tight">
          Intelligence <br />
          <span className="gold-text font-medium not-italic tracking-tighter">Without Compromise.</span>
        </h1>
        <p className="text-gray-400 text-base sm:text-lg font-light leading-relaxed max-w-2xl mx-auto">
          Luminara Search gives founders and teams continuous, verified search and AI visibility intelligence grounded in live data.
        </p>
      </header>

      {/* Strategic Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-20">
        <article className="glass-morphism rounded-3xl p-8 sm:p-10 space-y-6 border border-gold/30 hover:border-gold transition-all">
          <div className="w-12 h-12 rounded-2xl bg-gold/10 border border-gold/30 flex items-center justify-center text-gold-light">
            <ICONS.Shield className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">The Red Team Advantage</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            Most marketing agencies are incentivized to provide flattering reports that justify their ongoing monthly retainers. Luminara Search is designed to expose the truth. By running continuous adversarial simulations, we hunt down strategic gaps before your competitors exploit them.
          </p>
          <ul className="space-y-3 pt-2">
            {[
              "Adversarial logic stress-testing",
              "Objective revenue-linked auditing",
              "Zero monthly management retainers"
            ].map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-gray-300 text-xs font-bold uppercase tracking-wider">
                <div className="w-1.5 h-1.5 rounded-full bg-gold"></div>
                {item}
              </li>
            ))}
          </ul>
        </article>

        <article className="glass-morphism rounded-3xl p-8 sm:p-10 space-y-6 border border-gold/30 hover:border-gold transition-all">
          <div className="w-12 h-12 rounded-2xl bg-gold/10 border border-gold/30 flex items-center justify-center text-gold-light">
            <ICONS.Radar className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Grounded SERP Reality</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            AI reasoning without data is mere speculation. Our Grounded Intelligence Protocol validates every single finding against live Google Search SERPs and geospatial maps data. We don’t just speculate on rankings—we verify quotes, AI Overviews, and competitor citations.
          </p>
          <ul className="space-y-3 pt-2">
            {[
              "Live Google Search grounding",
              "AI Overviews & LLM quote verification",
              "Autonomous schema & JSON-LD architecture"
            ].map((item, i) => (
              <li key={i} className="flex items-center gap-3 text-gray-300 text-xs font-bold uppercase tracking-wider">
                <div className="w-1.5 h-1.5 rounded-full bg-gold"></div>
                {item}
              </li>
            ))}
          </ul>
        </article>
      </div>

      {/* Methodology Section */}
      <section className="py-12 border-t border-white/10">
        <div className="text-center mb-12">
          <h3 className="text-gold-light font-black text-[10px] uppercase tracking-[0.4em] mb-2">The Luminara Methodology</h3>
          <h2 className="text-3xl sm:text-4xl font-bold text-white">Four Steps to Search Sovereignty</h2>
        </div>

        <div className="space-y-6">
          {steps.map((item, idx) => (
            <div key={idx} className="glass-morphism rounded-2xl border border-white/5 hover:border-gold/40 p-6 sm:p-8 flex flex-col sm:flex-row gap-6 items-start transition-all">
              <span className="text-3xl sm:text-4xl font-black font-mono gold-text shrink-0">
                {item.step}
              </span>
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-white">{item.title}</h3>
                <p className="text-xs sm:text-sm text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
