import React from 'react';
import { ICONS } from '../../constants';

export const VisionView: React.FC = () => {
  const steps = [
    {
      title: 'Business profile',
      desc: 'Set who you are, what you sell, and who you compete with so audits stay relevant to your offer.',
    },
    {
      title: 'Site and answer checks',
      desc: 'Crawl the site and probe Google, AI Overviews, ChatGPT and Perplexity for how you show up.',
    },
    {
      title: 'Evidence first',
      desc: 'Findings cite live search or page evidence when available. Gaps are labelled not measured, not invented.',
    },
    {
      title: 'Ranked actions',
      desc: 'Leave with a short priority list you can hand to a developer or ship yourself the same week.',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 pb-20">
      <header className="mb-12 max-w-2xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold mb-4">Method</p>
        <h1 className="text-3xl sm:text-5xl font-semibold text-white mb-4 tracking-tight leading-tight">
          How audits stay honest.
        </h1>
        <p className="text-gray-400 text-base leading-relaxed">
          Luminara Suite checks search and AI answers against live data where your keys allow, then ranks what to fix first.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-14">
        <article className="rounded-2xl p-6 sm:p-8 border border-white/10 bg-[#050505] space-y-4">
          <div className="w-10 h-10 rounded-xl bg-gold/10 border border-gold/25 flex items-center justify-center text-gold">
            <ICONS.Shield className="w-5 h-5" />
          </div>
          <h2 className="text-xl font-semibold text-white">Truth over theatre</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            The product is built to surface gaps, not flattering decks. Stress checks and competitor context exist to show risk early.
          </p>
        </article>

        <article className="rounded-2xl p-6 sm:p-8 border border-white/10 bg-[#050505] space-y-4">
          <div className="w-10 h-10 rounded-xl bg-gold/10 border border-gold/25 flex items-center justify-center text-gold">
            <ICONS.Radar className="w-5 h-5" />
          </div>
          <h2 className="text-xl font-semibold text-white">Grounded when possible</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            When search or crawl credentials are connected, findings can cite real SERP and page evidence. When they are not, the UI says so.
          </p>
        </article>
      </div>

      <section className="border-t border-white/10 pt-10">
        <h2 className="text-2xl font-semibold text-white mb-8">Four steps</h2>
        <div className="space-y-6">
          {steps.map((item) => (
            <div key={item.title} className="border-t border-white/[0.06] pt-5">
              <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
