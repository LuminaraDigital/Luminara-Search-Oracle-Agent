import React, { useEffect, useState } from 'react';
import { ICONS } from '../ui/icons';
import { Button } from '../ui/Button';
import { autoLockService } from '../../services/security/autoLockService';

export const LockScreenOverlay: React.FC = () => {
  const [isLocked, setIsLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const unsubscribe = autoLockService.subscribe((locked) => {
      setIsLocked(locked);
      if (locked) {
        setPin('');
        setError(null);
      }
    });
    return unsubscribe;
  }, []);

  if (!isLocked) return null;

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const ok = await autoLockService.unlock(pin);
      if (!ok) {
        setError('Incorrect PIN. Please try again.');
        setPin('');
      }
    } catch {
      setError('Unlock failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-sm rounded-2xl border border-gold/40 bg-surface-1 p-6 text-center shadow-2xl space-y-5">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-gold/40 bg-gold/10 text-gold shadow-inner">
          <ICONS.Shield className="h-7 w-7" />
        </div>

        <div>
          <h2 className="text-lg font-semibold text-ink">Session Locked</h2>
          <p className="mt-1 text-xs text-ink-2">
            Luminara was locked due to inactivity. Enter your security PIN to resume.
          </p>
        </div>

        <form onSubmit={handleUnlock} className="space-y-4">
          <div>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(null);
              }}
              placeholder="Enter PIN"
              className="w-full rounded-xl border border-rule bg-surface px-4 py-2.5 text-center text-lg tracking-widest text-ink placeholder-ink-2/40 focus:border-gold outline-none font-mono"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-400 font-mono">
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full justify-center"
            disabled={isSubmitting || !pin}
          >
            {isSubmitting ? 'Verifying...' : 'Unlock Workspace'}
          </Button>
        </form>
      </div>
    </div>
  );
};
