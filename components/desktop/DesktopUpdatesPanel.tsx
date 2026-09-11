import React, { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { getDesktopBridge, isDesktopShell, type DesktopUpdateStatus } from '../../services/desktop/desktopShell';

/**
 * Windows desktop shell updates (electron-updater via GitHub Releases).
 * Web/Telegram sessions never see this panel.
 */
export const DesktopUpdatesPanel: React.FC = () => {
  const bridge = getDesktopBridge();
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [shellVersion, setShellVersion] = useState('');
  const [packaged, setPackaged] = useState(false);
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    bridge.getUpdatePrefs().then((prefs) => {
      if (cancelled) return;
      setAutoUpdate(prefs.autoUpdateEnabled);
      setShellVersion(prefs.shellVersion);
      setPackaged(prefs.packaged);
    }).catch(() => undefined);
    const off = bridge.onUpdateStatus((payload) => {
      setStatus(payload);
      if (payload.status === 'preference') {
        setAutoUpdate(payload.detail === 'on');
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [bridge]);

  if (!isDesktopShell() || !bridge) return null;

  const statusLabel = (() => {
    if (!status) return packaged ? 'Ready' : 'Dev shell (updates apply in installed builds)';
    switch (status.status) {
      case 'checking': return 'Checking for updates…';
      case 'available': return `Update available: ${String(status.detail || '')}`;
      case 'not-available': return 'You are on the latest shell';
      case 'progress': return `Downloading… ${String(status.detail || 0)}%`;
      case 'downloaded': return `Update ${String(status.detail || '')} ready. Restart to install.`;
      case 'skipped': return String(status.detail || 'Skipped');
      case 'error': return `Update error: ${String(status.detail || 'unknown')}`;
      case 'preference': return autoUpdate ? 'Automatic updates on' : 'Automatic updates off';
      default: return String(status.status);
    }
  })();

  return (
    <div className="space-y-3 p-3 rounded-xl bg-white/[0.02] border border-white/5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-gray-200">Windows desktop shell</p>
          <p className="text-[10px] text-gray-500 font-mono">
            Shell {shellVersion || '…'} · App content updates with every Cloudflare deploy
          </p>
        </div>
      </div>

      <label className="flex items-center justify-between gap-3 cursor-pointer">
        <span className="text-xs text-gray-300">
          Automatic shell updates
          <span className="block text-[10px] text-gray-500 mt-0.5">
            When on, Luminara checks GitHub Releases after launch and installs on quit
          </span>
        </span>
        <input
          type="checkbox"
          checked={autoUpdate}
          onChange={async (e) => {
            const next = e.target.checked;
            setAutoUpdate(next);
            try {
              await bridge.setAutoUpdate(next);
            } catch {
              setAutoUpdate(!next);
            }
          }}
          className="accent-gold w-4 h-4"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="xs"
          loading={busy}
          className="normal-case tracking-normal"
          onClick={async () => {
            setBusy(true);
            try {
              await bridge.checkForUpdates();
            } finally {
              setBusy(false);
            }
          }}
        >
          Check for updates
        </Button>
        {status?.status === 'downloaded' && (
          <Button
            variant="primary"
            size="xs"
            className="normal-case tracking-normal"
            onClick={() => void bridge.installUpdate()}
          >
            Restart and install
          </Button>
        )}
      </div>
      <p className="text-[10px] font-mono text-gray-500">{statusLabel}</p>
    </div>
  );
};
