import React from 'react';
import { suiteCitabilityChecklist } from '../../services/audit/suiteCitabilityChecklist';

const badgeClass: Record<string, string> = {
  pass: 'border-gold/40 text-gold-light bg-gold/10',
  fail: 'border-white/20 text-gray-200 bg-white/5',
  not_measured: 'border-white/15 text-gray-400 bg-transparent',
};

function statusLabel(status: string): string {
  if (status === 'not_measured') return 'not measured';
  return status;
}

/** Suite's own crawlable assets. Status stays not measured until a probe is supplied. */
export const SuiteCitabilityChecklist: React.FC = () => {
  const items = suiteCitabilityChecklist();
  return (
    <section
      aria-label="Suite citability checklist"
      className="mb-8 rounded-2xl border border-white/10 bg-black/40 px-5 py-5"
    >
      <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-500">Suite GEO checklist</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">
        These rows are Luminara Suite's own crawlable assets. They stay not measured until a live probe of this site records them. A client scout does not fill this list, and the list is not a score.
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="text-sm text-gray-300">
            <span className={`mr-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badgeClass[item.status] || badgeClass.not_measured}`}>
              {statusLabel(item.status)}
            </span>
            <a href={item.href} className="text-gray-200 underline decoration-white/20 underline-offset-2">
              {item.label}
            </a>
            <span className="text-gray-500">. {item.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
