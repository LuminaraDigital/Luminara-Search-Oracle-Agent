import React, { useState } from 'react';
import { ICONS } from '../ui/icons';
import { Button } from '../ui/Button';
import {
  luminaraVaultService,
  type VaultPayload,
  type VaultSummary,
  type VaultExportOptions,
} from '../../services/vault/luminaraVaultService';

interface VaultManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

export const VaultManagerModal: React.FC<VaultManagerModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');

  // Export State
  const [exportPassword, setExportPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [options, setOptions] = useState<VaultExportOptions>({
    includeBrandMemory: true,
    includeBusinessDna: true,
    includeApiKeys: true,
    includeTrustDomains: true,
    includeWatchOnly: true,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importContent, setImportContent] = useState<string>('');
  const [importPassword, setImportPassword] = useState('');
  const [decryptedPayload, setDecryptedPayload] = useState<VaultPayload | null>(null);
  const [decryptedSummary, setDecryptedSummary] = useState<VaultSummary | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportError(null);
    setDecryptedPayload(null);
    setDecryptedSummary(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setImportContent(text);
    };
    reader.readAsText(file);
  };

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setExportError(null);

    if (exportPassword.length < 8) {
      setExportError('Password must be at least 8 characters long.');
      return;
    }
    if (exportPassword !== confirmPassword) {
      setExportError('Passwords do not match.');
      return;
    }

    try {
      setIsExporting(true);
      const payload = luminaraVaultService.collectPayload(options);
      const encryptedJson = await luminaraVaultService.encryptVault(payload, exportPassword);
      luminaraVaultService.downloadVaultFile(encryptedJson);
      if (onSuccess) {
        onSuccess('Vault successfully encrypted and exported.');
      }
      setExportPassword('');
      setConfirmPassword('');
      onClose();
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleInspectAndDecrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);

    if (!importContent) {
      setImportError('Please select a .luminara-vault file first.');
      return;
    }
    if (!importPassword) {
      setImportError('Please enter the vault decryption password.');
      return;
    }

    try {
      setIsDecrypting(true);
      const payload = await luminaraVaultService.decryptVault(importContent, importPassword);
      const summary = luminaraVaultService.summarizePayload(payload);
      setDecryptedPayload(payload);
      setDecryptedSummary(summary);
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Decryption failed.');
      setDecryptedPayload(null);
      setDecryptedSummary(null);
    } finally {
      setIsDecrypting(false);
    }
  };

  const handleApplyRestore = () => {
    if (!decryptedPayload) return;
    try {
      luminaraVaultService.restorePayload(decryptedPayload, importMode === 'merge');
      if (onSuccess) {
        onSuccess(
          `Vault restored successfully (${decryptedSummary?.brandMemoryCount || 0} memory items, ${
            decryptedSummary?.apiKeysCount || 0
          } keys).`,
        );
      }
      onClose();
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Restoration failed.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-xl rounded-2xl border border-gold/30 bg-surface-1 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-rule pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold/10 text-gold">
              <ICONS.Shield className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">Encrypted Luminara Brand Vault</h2>
              <p className="text-xs text-ink-2">Self-custody portable backup: AES-256-GCM encrypted</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-2 hover:bg-surface hover:text-ink transition-colors"
            aria-label="Close dialog"
          >
            <ICONS.Close className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-2 border-b border-rule pb-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('export');
              setExportError(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-mono font-medium transition-colors ${
              activeTab === 'export'
                ? 'border border-gold/40 bg-gold/15 text-gold'
                : 'text-ink-2 hover:bg-surface hover:text-ink'
            }`}
          >
            Export Vault
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('import');
              setImportError(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-mono font-medium transition-colors ${
              activeTab === 'import'
                ? 'border border-gold/40 bg-gold/15 text-gold'
                : 'text-ink-2 hover:bg-surface hover:text-ink'
            }`}
          >
            Restore Vault
          </button>
        </div>

        {/* Tab 1: Export */}
        {activeTab === 'export' && (
          <form onSubmit={handleExport} className="mt-4 space-y-4">
            <p className="text-xs text-ink-2">
              Package your Brand Memory, Business DNA, and BYOK API keys into an AES-256 encrypted file.
              The app never sends your master password to any server.
            </p>

            <div className="rounded-xl border border-rule bg-surface p-3 space-y-2">
              <span className="block text-[11px] font-mono uppercase text-ink-2">Include in Vault</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-ink">
                  <input
                    type="checkbox"
                    checked={options.includeBrandMemory}
                    onChange={(e) => setOptions({ ...options, includeBrandMemory: e.target.checked })}
                    className="rounded border-rule text-gold focus:ring-gold"
                  />
                  Brand Memory
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-ink">
                  <input
                    type="checkbox"
                    checked={options.includeBusinessDna}
                    onChange={(e) => setOptions({ ...options, includeBusinessDna: e.target.checked })}
                    className="rounded border-rule text-gold focus:ring-gold"
                  />
                  Business DNA
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-ink">
                  <input
                    type="checkbox"
                    checked={options.includeApiKeys}
                    onChange={(e) => setOptions({ ...options, includeApiKeys: e.target.checked })}
                    className="rounded border-rule text-gold focus:ring-gold"
                  />
                  BYOK API Keys
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-ink">
                  <input
                    type="checkbox"
                    checked={options.includeTrustDomains}
                    onChange={(e) => setOptions({ ...options, includeTrustDomains: e.target.checked })}
                    className="rounded border-rule text-gold focus:ring-gold"
                  />
                  Trust Domains
                </label>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono text-ink-2 mb-1">
                  Master Vault Passphrase (min 8 chars)
                </label>
                <input
                  type="password"
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  placeholder="Enter strong passphrase"
                  required
                  className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-xs text-ink placeholder-ink-2/40 focus:border-gold outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono text-ink-2 mb-1">
                  Confirm Master Passphrase
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-type passphrase"
                  required
                  className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-xs text-ink placeholder-ink-2/40 focus:border-gold outline-none font-mono"
                />
              </div>
            </div>

            {exportError && (
              <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-400 font-mono">
                {exportError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-rule">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isExporting}>
                {isExporting ? 'Encrypting...' : 'Export .luminara-vault'}
              </Button>
            </div>
          </form>
        )}

        {/* Tab 2: Import */}
        {activeTab === 'import' && (
          <div className="mt-4 space-y-4">
            {!decryptedPayload ? (
              <form onSubmit={handleInspectAndDecrypt} className="space-y-4">
                <p className="text-xs text-ink-2">
                  Restore an encrypted vault from your computer or another device.
                </p>

                <div className="rounded-xl border border-dashed border-rule bg-surface/50 p-4 text-center">
                  <input
                    type="file"
                    id="vault-file-input"
                    accept=".luminara-vault,.json"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <label htmlFor="vault-file-input" className="cursor-pointer space-y-1 block">
                    <ICONS.FileText className="mx-auto h-7 w-7 text-ink-2" />
                    <span className="block text-xs font-medium text-ink">
                      {importFile ? importFile.name : 'Click to select .luminara-vault file'}
                    </span>
                    <span className="block text-[10px] text-ink-2 font-mono">Accepts encrypted JSON container</span>
                  </label>
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-ink-2 mb-1">
                    Vault Passphrase
                  </label>
                  <input
                    type="password"
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder="Enter decryption passphrase"
                    required
                    className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-xs text-ink placeholder-ink-2/40 focus:border-gold outline-none font-mono"
                  />
                </div>

                {importError && (
                  <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-400 font-mono">
                    {importError}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-rule">
                  <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" size="sm" disabled={isDecrypting || !importContent}>
                    {isDecrypting ? 'Decrypting...' : 'Verify & Decrypt'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="space-y-4 animate-fade-in">
                <div className="rounded-xl border border-gold/40 bg-gold/10 p-3">
                  <div className="flex items-center gap-2 text-gold text-xs font-semibold">
                    <ICONS.Check className="h-4 w-4" />
                    <span>Vault Successfully Decrypted</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="flex justify-between border-b border-rule/50 pb-1">
                      <dt className="text-ink-2">Brand Memory:</dt>
                      <dd className="text-ink font-semibold">{decryptedSummary?.brandMemoryCount || 0} entries</dd>
                    </div>
                    <div className="flex justify-between border-b border-rule/50 pb-1">
                      <dt className="text-ink-2">API Keys:</dt>
                      <dd className="text-ink font-semibold">{decryptedSummary?.apiKeysCount || 0} keys</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-2">Business DNA:</dt>
                      <dd className="text-ink font-semibold">{decryptedSummary?.hasBusinessDna ? 'Included' : 'None'}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-2">Trust Domains:</dt>
                      <dd className="text-ink font-semibold">{decryptedSummary?.trustDomainsCount || 0} domains</dd>
                    </div>
                  </dl>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[11px] font-mono text-ink-2 uppercase">Restore Mode</span>
                  <div className="flex gap-3 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer text-ink">
                      <input
                        type="radio"
                        name="import-mode"
                        checked={importMode === 'merge'}
                        onChange={() => setImportMode('merge')}
                        className="text-gold focus:ring-gold"
                      />
                      <span>Merge (safely preserves existing data)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-ink">
                      <input
                        type="radio"
                        name="import-mode"
                        checked={importMode === 'replace'}
                        onChange={() => setImportMode('replace')}
                        className="text-gold focus:ring-gold"
                      />
                      <span>Replace</span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-rule">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDecryptedPayload(null);
                      setDecryptedSummary(null);
                    }}
                  >
                    Back
                  </Button>
                  <Button type="button" variant="primary" size="sm" onClick={handleApplyRestore}>
                    Apply Restore to Workspace
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
