import React, { useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';
import { BRAND_COLOUR_EXAMPLE, contrastLabel, parseLogoUrl } from '../../services/reports/reportBrand';

export interface WorkspaceBrandFields {
  displayName: string | null;
  logoUrl: string | null;
  primaryColour: string | null;
  reportDomain: string | null;
}

export function WorkspaceBrandForm({
  workspace,
  onSaved,
}: {
  workspace: WorkspaceBrandFields;
  onSaved: (next: WorkspaceBrandFields) => void;
}) {
  const [displayName, setDisplayName] = useState(workspace.displayName || '');
  const [logoUrl, setLogoUrl] = useState(workspace.logoUrl || '');
  const [colour, setColour] = useState(workspace.primaryColour || '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const colourTrimmed = colour.trim();
  const contrast = colourTrimmed ? contrastLabel(colourTrimmed) : null;
  const colourBlocked = Boolean(contrast && !contrast.ok);
  const picker = /^#[0-9a-fA-F]{6}$/.test(colourTrimmed) ? colourTrimmed : BRAND_COLOUR_EXAMPLE;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setSaved(false);
    if (colourTrimmed && !contrast?.ok) {
      setError(contrast?.text || 'Use a colour like the example.');
      return;
    }
    if (logoUrl.trim()) {
      const logo = parseLogoUrl(logoUrl.trim());
      if (!logo.ok) {
        setError(logo.error);
        return;
      }
    }
    const base = apiBase();
    if (!base) {
      setError('Could not save the brand.');
      return;
    }
    setBusy(true);
    try {
      const response = await workerFetchWithAuthRetry(`${base}/api/workspaces/current`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          logoUrl: logoUrl.trim() || null,
          primaryColour: colourTrimmed || null,
          reportDomain: workspace.reportDomain,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        workspace?: WorkspaceBrandFields;
      };
      if (!response.ok || !body.workspace) {
        setError(body.error || 'Could not save the brand.');
        return;
      }
      onSaved(body.workspace);
      setSaved(true);
    } catch {
      setError('Could not save the brand.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-6 border-t border-[var(--color-rule)] pt-4" onSubmit={(event) => void save(event)}>
      <h3 className="text-xs font-mono uppercase tracking-[0.14em] text-[var(--color-accent)]">Report brand</h3>
      <p className="text-sm text-[var(--color-ink-2)] mt-1">
        Reports for this workspace use this name, logo, and colour.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--color-ink-2)] flex flex-col gap-1">
          Display name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={120}
            className="bg-black/60 border border-[var(--color-rule)] text-[var(--color-ink)] text-sm px-2 py-2 min-h-11"
          />
        </label>
        <label className="text-xs text-[var(--color-ink-2)] flex flex-col gap-1">
          Logo URL
          <input
            type="url"
            inputMode="url"
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            placeholder="https://cdn.example.com/logo.png"
            className="bg-black/60 border border-[var(--color-rule)] text-[var(--color-ink)] text-sm px-2 py-2 min-h-11"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <span className="text-xs text-[var(--color-ink-2)]" id="brand-colour-label">Primary colour</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-labelledby="brand-colour-label"
            value={picker}
            onChange={(event) => setColour(event.target.value)}
            className="h-11 w-14 bg-black/60 border border-[var(--color-rule)]"
          />
          <input
            aria-labelledby="brand-colour-label"
            aria-describedby="brand-contrast"
            value={colour}
            onChange={(event) => setColour(event.target.value)}
            placeholder={BRAND_COLOUR_EXAMPLE}
            className="bg-black/60 border border-[var(--color-rule)] text-[var(--color-ink)] text-sm px-2 py-2 min-h-11 w-36"
          />
        </div>
        <p id="brand-contrast" className="text-sm text-[var(--color-ink)] flex items-center gap-2">
          <span aria-hidden className="inline-block h-4 w-4 border border-[var(--color-rule)]" style={{ background: picker }} />
          {contrast ? contrast.text : 'Leave this blank to use the default gold.'}
        </p>
        {contrast?.ok && (
          <p className="text-xs text-[var(--color-ink-2)]">
            Report headers put this colour behind the name. The name is black or white so it stays readable.
          </p>
        )}
      </div>
      {error && (
        <p className="text-sm text-warning-300 mt-3" role="alert">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-sm text-[var(--color-ink)] mt-3" role="status">
          Brand saved.
        </p>
      )}
      <button type="submit" className="lx-btn lx-btn-gold mt-4" disabled={busy || colourBlocked}>
        {busy ? 'Saving' : 'Save brand'}
      </button>
    </form>
  );
}
