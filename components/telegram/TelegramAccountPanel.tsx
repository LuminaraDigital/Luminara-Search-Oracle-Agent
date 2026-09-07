import React, { useEffect, useState } from 'react';
import { TonConnectButton, useTonWallet } from '@tonconnect/ui-react';
import { isInTelegram, getTelegramUserUnsafe, payWithStars, haptic } from '../../services/telegram/tma';
import { telegramAuth, createStarsInvoice, getServerHealthSync, type TelegramSession } from '../../services/apiClient';

interface Props {
  compact?: boolean;
}

/**
 * Shows who is signed in through Telegram, their plan, Telegram Stars checkout, and a TON wallet connect.
 * Identity shown here comes from the server-validated session, not from client launch params.
 */
export const TelegramAccountPanel: React.FC<Props> = ({ compact }) => {
  const [session, setSession] = useState<TelegramSession | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const wallet = useTonWallet();
  const plans = getServerHealthSync().plans;
  const inTg = isInTelegram();

  const refresh = async () => {
    try {
      setSession(await telegramAuth());
    } catch {
      setSession(null);
    }
  };

  useEffect(() => {
    if (inTg) refresh();
  }, [inTg]);

  const subscribe = async (planId: string) => {
    setBusyPlan(planId);
    setStatus(null);
    try {
      const url = await createStarsInvoice(planId);
      const result = await payWithStars(url);
      haptic(result === 'paid' ? 'success' : 'light');
      if (result === 'paid') {
        setStatus('Payment received. Activating your plan…');
        // The bot receives successful_payment a moment later; poll a few times.
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 1500));
          await refresh();
        }
        setStatus(null);
      } else if (result === 'cancelled') {
        setStatus('Checkout cancelled.');
      } else if (result === 'failed') {
        setStatus('Payment failed. Nothing was charged.');
      }
    } catch (e: any) {
      haptic('error');
      setStatus(e?.message || 'Could not start checkout.');
    } finally {
      setBusyPlan(null);
    }
  };

  const unsafeUser = getTelegramUserUnsafe();
  const user = session?.user ?? (unsafeUser ? { id: unsafeUser.id, first_name: unsafeUser.first_name, username: unsafeUser.username, photo_url: unsafeUser.photo_url } : null);
  const sub = session?.subscription;
  const active = sub && sub.expiresAt > Date.now();

  if (!inTg && !wallet) {
    return (
      <div className="glass-morphism rounded-2xl border border-white/10 p-5 space-y-3">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#BF953F]">Telegram &amp; TON</p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Open Luminara inside Telegram to pay with Stars and keep your audits on your account. You can also connect a TON wallet here.
        </p>
        <TonConnectButton />
      </div>
    );
  }

  return (
    <div className={`glass-morphism rounded-2xl border border-[#BF953F]/30 ${compact ? 'p-4 space-y-3' : 'p-5 space-y-4'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {user?.photo_url ? (
            <img src={user.photo_url} alt="" className="w-9 h-9 rounded-full border border-[#BF953F]/40" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[#BF953F]/20 border border-[#BF953F]/40 flex items-center justify-center text-[11px] font-black text-[#FCF6BA]">
              {(user?.first_name || 'T').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">{user?.first_name || 'Telegram user'}{user?.username ? <span className="text-gray-500 font-normal"> @{user.username}</span> : null}</p>
            <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
              {session ? 'Verified by server' : 'Signing in…'}
            </p>
          </div>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${active ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-white/5 border-white/10 text-gray-400'}`}>
          {active ? plans[sub!.plan]?.title || sub!.plan : 'Free'}
        </span>
      </div>

      {active && (
        <p className="text-[11px] text-gray-400">Active until {new Date(sub!.expiresAt).toLocaleDateString()}.</p>
      )}

      {Object.keys(plans).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(plans).map(([id, p]) => (
            <button
              key={id}
              onClick={() => subscribe(id)}
              disabled={busyPlan !== null}
              className="text-left p-3 rounded-xl border border-[#BF953F]/30 bg-[#BF953F]/5 hover:bg-[#BF953F]/15 transition-all disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#FCF6BA]">{p.title}</span>
                <span className="text-[11px] font-mono text-[#BF953F]">{p.stars.toLocaleString()} ⭐</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1 leading-snug">{p.description}</p>
              <p className="text-[9px] uppercase tracking-widest font-black text-[#BF953F] mt-2">{busyPlan === id ? 'Opening checkout…' : `${active && sub!.plan === id ? 'Extend' : 'Subscribe'} · ${p.days} days`}</p>
            </button>
          ))}
        </div>
      )}

      {status && <p className="text-[11px] text-amber-300" role="status">{status}</p>}

      <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/5">
        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">TON wallet</span>
        <TonConnectButton />
      </div>
      {wallet && (
        <p className="text-[10px] font-mono text-gray-500 truncate">Connected: {wallet.account.address}</p>
      )}
    </div>
  );
};
