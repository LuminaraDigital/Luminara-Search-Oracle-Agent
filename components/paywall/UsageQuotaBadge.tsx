import React, { useEffect, useState } from 'react';
import { subscribeQuota, fetchQuotaStatus, openPaywallModal, type QuotaInfo } from '../../services/apiClient';

interface Props {
  className?: string;
  showIcon?: boolean;
}

export const UsageQuotaBadge: React.FC<Props> = ({ className = '', showIcon = true }) => {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);

  useEffect(() => {
    fetchQuotaStatus();
    return subscribeQuota(q => setQuota(q));
  }, []);

  if (!quota) {
    return null;
  }

  if (quota.isUnlimited) {
    return (
      <button
        onClick={() => openPaywallModal('You have an active unlimited plan.')}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-gradient-to-r from-gold/20 to-gold-dark/20 text-gold border border-gold/40 hover:bg-gold/30 transition-all ${className}`}
        title="Pro Unlimited AI Queries Active"
      >
        {showIcon && <span>⭐</span>}
        <span>Pro Unlimited</span>
      </button>
    );
  }

  const isLow = quota.remaining <= 5;
  const isOut = quota.remaining <= 0;

  return (
    <button
      onClick={() => openPaywallModal(isOut ? 'Daily limit reached. Upgrade for unlimited queries.' : 'Upgrade to remove the daily limit.')}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider transition-all border ${
        isOut
          ? 'bg-danger-500/15 text-danger-400 border-danger-500/30 animate-pulse'
          : isLow
          ? 'bg-warning-500/10 text-warning-300 border-warning-500/30'
          : 'bg-white/5 text-gray-300 border-white/10 hover:border-gold/40 hover:text-white'
      } ${className}`}
      title={`${quota.remaining} of ${quota.limit} free daily queries remaining today. Click to upgrade.`}
    >
      {showIcon && (
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOut ? 'bg-danger-400' : isLow ? 'bg-warning-400' : 'bg-gold'}`} />
      )}
      <span>{quota.remaining}/{quota.limit} Daily Queries</span>
      <span className="text-[9px] font-black text-gold uppercase tracking-widest ml-0.5">Upgrade</span>
    </button>
  );
};
