import React from 'react';
import { AuthPanel } from './AuthPanel';
import { isInTelegram } from '../../services/telegram/tma';
import type { AppAuthState } from '../../services/auth/useAppAuth';

/**
 * Full-screen gate when product tools require an account.
 * Inside Telegram: identity comes from Mini App initData (no Firebase required).
 * On the web: Firebase email/password or Google.
 */
export const AuthRequiredScreen: React.FC<{
  auth: AppAuthState;
  onBackToMarketing?: () => void;
}> = ({ auth, onBackToMarketing }) => {
  const inTelegram = isInTelegram();

  return (
    <div className="min-h-screen bg-black text-ink flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-gold">Account required</p>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Sign in to continue</h1>
          <p className="text-sm text-gray-400 leading-relaxed">
            {inTelegram
              ? 'Inside Telegram, your Telegram account is your login. We verify it with Telegram Mini App data on every request.'
              : 'On the web, use email/password or Google. Inside the Telegram Mini App, Telegram itself is your login (Google popup is not used there).'}
          </p>
        </div>

        {auth.loading ? (
          <p className="text-center text-xs text-gray-500 uppercase tracking-widest">Checking session…</p>
        ) : inTelegram ? (
          <div className="glass-morphism rounded-2xl border border-white/10 p-5 space-y-3">
            <p className="text-sm text-gray-300 leading-relaxed">
              {auth.reason || 'Could not verify Telegram. Close this view and open Luminara again from the bot menu.'}
            </p>
          </div>
        ) : (
          <AuthPanel />
        )}

        {onBackToMarketing && !inTelegram && (
          <button
            type="button"
            onClick={onBackToMarketing}
            className="w-full text-xs text-gray-500 hover:text-gold transition-colors"
          >
            Back to home
          </button>
        )}
      </div>
    </div>
  );
};
