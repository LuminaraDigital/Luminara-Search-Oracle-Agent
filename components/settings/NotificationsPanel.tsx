import React from 'react';

/** The weekly briefing is a browser flag on the decision card. This only explains that. */
export const NotificationsPanel: React.FC = () => (
  <section className="rounded-xl border border-white/10 p-4 space-y-2" aria-label="Notifications">
    <h2 className="text-sm font-bold text-white">Notifications</h2>
    <p className="text-xs text-gray-300 leading-relaxed">
      Weekly Telegram briefing stays off until you turn it on. After an audit, open the decision card and press Weekly Telegram Briefing. That choice is saved in this browser.
    </p>
  </section>
);
