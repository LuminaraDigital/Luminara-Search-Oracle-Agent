import React, { useCallback, useEffect, useState } from 'react';
import { AppView } from '../../types';
import {
  completeWeeklyMission,
  fetchReferralProfile,
  type ReferralProfile,
} from '../../services/referrals/referralClient';
import { OPERATOR_STREAK_WEEKS, type MissionKey } from '../../services/referrals/rules';

interface VisibilityRetentionCardProps {
  signedIn: boolean;
  onNavigate: (view: AppView) => void;
}

/**
 * Visibility Level, invite link, and this week's missions.
 * Levels come from the Worker. This card does not invent audit scores.
 */
export const VisibilityRetentionCard: React.FC<VisibilityRetentionCardProps> = ({ signedIn, onNavigate }) => {
  const [profile, setProfile] = useState<ReferralProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!signedIn) {
      setProfile(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await fetchReferralProfile();
    setLoading(false);
    if (!result.ok) {
      setProfile(null);
      setError('Visibility Level could not be loaded.');
      return;
    }
    setProfile(result.profile);
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyInvite = async () => {
    if (!profile?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(profile.inviteUrl);
      setNote('Copied invite link.');
    } catch {
      setNote('Select the invite link below and copy it.');
    }
  };

  const finishMission = async (key: MissionKey, navigate?: AppView) => {
    setBusyKey(key);
    setNote(null);
    const result = await completeWeeklyMission(key);
    setBusyKey(null);
    if (!result.ok) {
      setNote(result.error || 'Could not update that mission.');
      return;
    }
    if (key === 'checklist_fix') {
      setNote('Marked. This does not change your audit scores.');
    }
    await load();
    if (navigate) onNavigate(navigate);
  };

  return (
    <section className="mb-10 glass-morphism rounded-2xl border border-white/10 bg-black/50 p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold mb-2">Visibility Level</p>
          {!signedIn && (
            <>
              <p className="text-2xl font-bold text-white">Explorer</p>
              <p className="text-xs text-gray-400 mt-1 max-w-xl leading-relaxed">
                Starting level until you sign in and run a scout. Sign in with Telegram or your account to get an invite link.
              </p>
            </>
          )}
          {signedIn && loading && <p className="text-sm text-gray-300">Loading Visibility Level.</p>}
          {signedIn && error && <p className="text-sm text-gray-300">{error}</p>}
          {profile && (
            <>
              <p className="text-2xl font-bold text-white">{profile.progression.label}</p>
              <p className="text-xs text-gray-400 mt-1 max-w-xl leading-relaxed">
                Scout after your first honest audit. Builder after one weekly mission. Operator after a {OPERATOR_STREAK_WEEKS}-week streak.
                Streak: {profile.progression.streakWeeks} week{profile.progression.streakWeeks === 1 ? '' : 's'}.
                Invite credits left: {profile.bonusRemaining}. No citation score is shown here.
              </p>
            </>
          )}
        </div>
        {profile?.inviteUrl && (
          <button
            type="button"
            onClick={() => { void copyInvite(); }}
            className="shrink-0 px-4 py-2 rounded-lg bg-gold/10 border border-gold/30 text-[10px] font-bold uppercase tracking-wider text-gold-light hover:bg-gold/20 transition-all focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            Copy invite link
          </button>
        )}
      </div>

      {profile?.inviteUrl && (
        <label className="block mt-4">
          <span className="text-[10px] uppercase tracking-widest text-gray-500">Invite link</span>
          <input
            readOnly
            value={profile.inviteUrl}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-gray-200 font-mono"
            aria-label="Invite link"
          />
          <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
            You both get {profile.creditsPerSide} extra hosted scouts after their first honest Instant Scout. Empty runs do not count.
          </p>
        </label>
      )}

      {profile && (
        <ul className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
          {profile.missions.map((mission) => (
            <li key={mission.key} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-white">{mission.title}</span>
                  <span className={`text-[9px] font-mono uppercase ${mission.status === 'completed' ? 'text-success-400' : 'text-gold'}`}>
                    {mission.status === 'completed' ? 'Done' : 'Open'}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{mission.detail}</p>
              </div>
              {mission.status !== 'completed' && mission.key === 'rescout' && (
                <button
                  type="button"
                  onClick={() => onNavigate(AppView.INSTANT_AUDIT)}
                  className="w-full py-2 rounded-lg border border-white/15 text-[10px] font-bold uppercase tracking-wider text-gray-200 hover:border-gold/40 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  Open Instant Scout
                </button>
              )}
              {mission.status !== 'completed' && mission.key === 'view_delta' && (
                <button
                  type="button"
                  disabled={busyKey === mission.key}
                  onClick={() => { void finishMission('view_delta', AppView.BRAND_MEMORY); }}
                  className="w-full py-2 rounded-lg bg-gradient-to-r from-gold to-gold-dark text-black text-[10px] font-black uppercase tracking-wider hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:opacity-60"
                >
                  View what changed
                </button>
              )}
              {mission.status !== 'completed' && mission.key === 'checklist_fix' && (
                <button
                  type="button"
                  disabled={busyKey === mission.key}
                  onClick={() => { void finishMission('checklist_fix'); }}
                  className="w-full py-2 rounded-lg border border-gold/30 text-[10px] font-bold uppercase tracking-wider text-gold-light hover:bg-gold/10 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:opacity-60"
                >
                  I shipped one fix
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {note && <p className="mt-3 text-[11px] text-gray-300">{note}</p>}
    </section>
  );
};
