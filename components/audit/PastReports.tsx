import React, { useEffect, useState } from 'react';
import { AUDIT_ACTIVITY_EVENT } from '../../services/audit/auditActivity';
import { auditHistoryService, type AuditHistoryEntry } from '../../services/audit/auditHistoryService';
import { forgetWinShare, revokeWinPage, winShareFor } from '../../services/share/winShareClient';
import { auditFromHash, auditReportHash } from '../../services/audit/auditReportUrl';
import { formatAuClock, formatAuDate } from '../../utils/formatAuDate';

interface PastReportsProps {
  onOpen: (entry: AuditHistoryEntry) => void;
}

/** Saved audits. New audit clears the screen and leaves these in place. */
export const PastReports: React.FC<PastReportsProps> = ({ onOpen }) => {
  const [items, setItems] = useState<AuditHistoryEntry[]>(() => auditHistoryService.list({ limit: 8 }));
  const [wins, setWins] = useState<Record<string, string>>(() => {
    const ids: Record<string, string> = {};
    for (const item of auditHistoryService.list({ limit: 8 })) {
      const winId = winShareFor(item.id);
      if (winId) ids[item.id] = winId;
    }
    return ids;
  });
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      const next = auditHistoryService.list({ limit: 8 });
      setItems(next);
      const ids: Record<string, string> = {};
      for (const item of next) {
        const winId = winShareFor(item.id);
        if (winId) ids[item.id] = winId;
      }
      setWins(ids);
    };
    refresh();
    const saved = auditFromHash(window.location.hash);
    if (saved) onOpen(saved);
    window.addEventListener(AUDIT_ACTIVITY_EVENT, refresh);
    return () => window.removeEventListener(AUDIT_ACTIVITY_EVENT, refresh);
  }, []);

  if (items.length === 0) return null;

  return (
    <section aria-label="Past reports" className="mb-6 text-left">
      <h2 className="text-xs font-semibold tracking-wide text-gray-400 mb-2">Past reports</h2>
      <ul className="space-y-1.5 list-none m-0 p-0">
        {items.map((item) => (
          <li key={item.id} className="flex items-stretch gap-2">
            <a
              href={`/${auditReportHash(item.id)}`}
              onClick={(event) => {
                event.preventDefault();
                onOpen(item);
              }}
              className="min-h-11 flex-1 rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-gray-200 hover:border-gold/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              <span className="font-medium">{item.domain}</span>
              <span className="text-gray-400"> · {formatAuDate(item.measuredAt)} {formatAuClock(item.measuredAt)} · {item.focus}</span>
            </a>
            {wins[item.id] && (
              <button
                type="button"
                className="min-h-11 rounded-lg border border-white/15 px-3 text-sm text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                onClick={() => {
                  const winId = wins[item.id];
                  void revokeWinPage(winId).then((result) => {
                    if (!result.ok) {
                      setNote(result.error || 'Could not revoke the public page.');
                      return;
                    }
                    forgetWinShare(item.id);
                    setWins((current) => {
                      const next = { ...current };
                      delete next[item.id];
                      return next;
                    });
                    setNote('Public page revoked.');
                  });
                }}
              >
                Revoke public page
              </button>
            )}
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-sm text-gray-300" role="status">{note}</p>}
    </section>
  );
};
