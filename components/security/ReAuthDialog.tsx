import React, { useState } from 'react';
import { ICONS } from '../ui/icons';
import { Button } from '../ui/Button';
import { autoLockService } from '../../services/security/autoLockService';

interface ReAuthDialogProps {
  isOpen: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ReAuthDialog: React.FC<ReAuthDialogProps> = ({
  isOpen,
  title = 'Security Confirmation',
  description = 'Please verify your PIN to authorize this sensitive action.',
  confirmLabel = 'Authorize Action',
  onConfirm,
  onCancel,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  if (!isOpen) return null;

  const hasPin = autoLockService.hasPinSet();

  const handleAuthorize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasPin) {
      onConfirm();
      return;
    }

    if (!pin) {
      setError('Please enter your PIN.');
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      const valid = await autoLockService.verifyPin(pin);
      if (valid) {
        setPin('');
        onConfirm();
      } else {
        setError('Incorrect PIN. Authorization denied.');
        setPin('');
      }
    } catch {
      setError('Verification failed. Try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-sm rounded-2xl border border-gold/30 bg-surface-1 p-5 shadow-2xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold/15 text-gold">
            <ICONS.Shield className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <p className="text-xs text-ink-2">{description}</p>
          </div>
        </div>

        <form onSubmit={handleAuthorize} className="space-y-4">
          {hasPin ? (
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
                placeholder="Enter 4+ digit PIN"
                className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-center text-base tracking-widest text-ink placeholder-ink-2/40 focus:border-gold outline-none font-mono"
              />
            </div>
          ) : (
            <div className="rounded-lg border border-rule bg-surface p-2.5 text-xs text-ink-2">
              No master PIN is configured. You can set an auto-lock PIN in Settings to guard sensitive actions.
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-red-400 font-mono text-center">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-rule">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isVerifying || (hasPin && !pin)}
            >
              {isVerifying ? 'Checking...' : confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
