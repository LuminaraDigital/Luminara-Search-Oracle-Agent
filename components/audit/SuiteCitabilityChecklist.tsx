import React from 'react';
import { citabilityStatusLabel, suiteCitabilityChecklist } from '../../services/audit/suiteCitabilityChecklist';

const badgeClass: Record<string, string> = {
  pass: 'border-gold/40 text-gold-light bg-gold/10',
  fail: 'border-white/20 text-gray-200 bg-white/5',
  not_measured: 'border-white/15 text-gray-400 bg-transparent',
};

/** Checks on the site you audit. Status stays Not measured until a probe is supplied. */
export const SuiteCitabilityChecklist: React.FC = () => {
  const items = suiteCitabilityChecklist();
  return (
    <section
      aria-label="Your site GEO checklist"
      className="mb-8 rounded-2xl border border-white/10 bg-black/40 px-5 py-5"
    >
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Your site GEO checklist</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">
        These rows are about the site you audit. They stay Not measured until a live check of that site records them. This list is not a score.
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="text-sm text-gray-300">
            <span className={`mr-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass[item.status] || badgeClass.not_measured}`}>
              {citabilityStatusLabel(item.status)}
            </span>
            <span className="text-gray-200">{item.label}</span>
            <span className="text-gray-500">. {item.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
