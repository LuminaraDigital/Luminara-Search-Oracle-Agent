import React, { useEffect, useState } from 'react';
import { subscribeQuota, fetchQuotaStatus, openPaywallModal, type QuotaInfo } from '../../services/apiClient';
import { useAppAuth } from '../../services/auth/useAppAuth';
import { labsToggleVisible } from '../../services/ui/labsAccess';

interface Props {
  className?: string;
  showIcon?: boolean;
}

export const UsageQuotaBadge: React.FC<Props> = ({ className = '', showIcon = true }) => {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const auth = useAppAuth();

  useEffect(() => {
    if (!auth.loading && auth.authenticated) void fetchQuotaStatus();
    return subscribeQuota(q => setQuota(q));
  }, [auth.loading, auth.authenticated]);

  // Dev build only, so a header check can show the free-quota badge without a Firebase session.
  useEffect(() => {
    if (!labsToggleVisible()) return;
    const onPreview = (event: Event) => {
      if (!('detail' in event)) return;
      const detail = event.detail;
      if (typeof detail !== 'object' || detail == null) return;
      if (!('limit' in detail) || !('remaining' in detail)) return;
      const limit = Number(detail.limit);
      const remaining = Number(detail.remaining);
      if (!Number.isFinite(limit) || !Number.isFinite(remaining)) return;
      setQuota({
        limit,
        used: Math.max(0, limit - remaining),
        remaining,
        resetSec: 0,
        isUnlimited: false,
      });
    };
    window.addEventListener('luminara-quota-preview', onPreview);
    return () => window.removeEventListener('luminara-quota-preview', onPreview);
  }, []);

  if (!quota) {
    return null;
  }

  if (quota.isUnlimited) {
    return (
      <button
        onClick={() => openPaywallModal('You have an active plan. The free daily cap is lifted.')}
        data-testid="quota-badge"
        data-header-item="quota"
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap bg-gradient-to-r from-gold/20 to-gold-dark/20 text-gold border border-gold/40 hover:bg-gold/30 transition-all ${className}`}
        title="Active plan: the free daily cap is lifted."
      >
        {showIcon && <span>⭐</span>}
        <span>Plan active</span>
      </button>
    );
  }

  const bonus = quota.bonusRemaining ?? 0;
  const isLow = quota.remaining + bonus <= 5;
  const isOut = quota.remaining <= 0 && bonus <= 0;

  return (
    <button
      onClick={() => openPaywallModal(isOut ? 'Daily limit reached. Upgrade for unlimited queries.' : 'Upgrade to remove the daily limit.')}
      data-testid="quota-badge"
      data-header-item="quota"
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider whitespace-nowrap transition-all border ${
        isOut
          ? 'bg-danger-500/15 text-danger-400 border-danger-500/30 animate-pulse'
          : isLow
          ? 'bg-warning-500/10 text-warning-300 border-warning-500/30'
          : 'bg-white/5 text-gray-300 border-white/10 hover:border-gold/40 hover:text-white'
      } ${className}`}
      title={`${quota.remaining} of ${quota.limit} free daily queries remaining today.${bonus > 0 ? ` Invite credits left: ${bonus}.` : ''} Click to upgrade.`}
    >
      {showIcon && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOut ? 'bg-danger-400' : isLow ? 'bg-warning-400' : 'bg-gold'}`} />
      )}
      <span>{isOut ? `0 left of ${quota.limit} (Limit reached)` : `${quota.remaining} left of ${quota.limit} Daily`}{bonus > 0 ? ` + ${bonus} invite` : ''}</span>
      <span className="text-[9px] font-black text-gold uppercase tracking-widest ml-0.5">Upgrade</span>
    </button>
  );
};
