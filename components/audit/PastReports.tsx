import React, { useEffect, useState } from 'react';
import { AUDIT_ACTIVITY_EVENT } from '../../services/audit/auditActivity';
import { auditHistoryService, type AuditHistoryEntry } from '../../services/audit/auditHistoryService';
import { formatAuDate } from '../../utils/formatAuDate';

interface PastReportsProps {
  onOpen: (entry: AuditHistoryEntry) => void;
}

/** Saved audits. New audit clears the screen and leaves these in place. */
export const PastReports: React.FC<PastReportsProps> = ({ onOpen }) => {
  const [items, setItems] = useState<AuditHistoryEntry[]>(() => auditHistoryService.list({ limit: 8 }));

  useEffect(() => {
    const refresh = () => setItems(auditHistoryService.list({ limit: 8 }));
    refresh();
    window.addEventListener(AUDIT_ACTIVITY_EVENT, refresh);
    return () => window.removeEventListener(AUDIT_ACTIVITY_EVENT, refresh);
  }, []);

  if (items.length === 0) return null;

  return (
    <section aria-label="Past reports" className="mb-6 text-left">
      <h2 className="text-xs font-semibold tracking-wide text-gray-400 mb-2">Past reports</h2>
      <ul className="space-y-1.5 list-none m-0 p-0">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="w-full min-h-11 rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-gray-200 hover:border-gold/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <span className="font-medium">{item.domain}</span>
              <span className="text-gray-400"> · {formatAuDate(item.measuredAt)} · {item.focus}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
