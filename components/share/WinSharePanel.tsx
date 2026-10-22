import React, { useState } from 'react';
import { brandNameFor } from '../../services/audit/brandName';
import { listAudits } from '../../services/audit/auditHistoryService';
import { productTelemetry } from '../../services/analytics/productTelemetry';
import {
  createWinPage,
  forgetWinShare,
  rememberWinShare,
  revokeWinPage,
} from '../../services/share/winShareClient';
import {
  publicAgencyName,
  publicWin,
  shareIntent,
  trackedWinUrl,
  winPostText,
  WIN_LINK_PLACEHOLDER,
  type ShareChannel,
  type WinClaim,
} from '../../services/share/winShare';

const buttonClass = 'min-h-11 rounded-lg px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold';

/**
 * Opens only for a measured win. The public page is created when a share action is used.
 */
export function WinSharePanel({ domain, claim }: { domain?: string; claim: WinClaim }) {
  const [hideScore, setHideScore] = useState(false);
  const [edited, setEdited] = useState(false);
  const [text, setText] = useState('');
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const agency = publicAgencyName(domain ? brandNameFor(domain) : null);
  const draft = winPostText({
    win: publicWin({ agencyName: agency, claim, hideScore, createdAt: Date.now() }),
    claim,
    link: pageUrl || WIN_LINK_PLACEHOLDER,
  });
  const shown = edited ? text : draft;
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const ensurePage = async (): Promise<string | null> => {
    if (pageUrl) return pageUrl;
    setBusy(true);
    const created = await createWinPage({ agencyName: agency, claim, hideScore });
    setBusy(false);
    if (!created.ok || !created.url || !created.id) {
      setStatus(created.error || 'Could not publish the public page.');
      return null;
    }
    setPageUrl(created.url);
    setPageId(created.id);
    const latest = domain ? listAudits({ domain })[0] : undefined;
    if (latest) rememberWinShare(latest.id, created.id);
    setStatus('Public page ready. You can revoke it from Past reports.');
    return created.url;
  };

  const publish = async (channel: ShareChannel) => {
    const url = await ensurePage();
    if (!url) return;
    const tracked = trackedWinUrl(url, channel);
    const post = shown.split(WIN_LINK_PLACEHOLDER).join(tracked);
    if (!edited) setText(post);
    setEdited(true);
    productTelemetry.track('share_clicked', { channel });
    if (channel === 'copy') {
      try {
        await navigator.clipboard.writeText(tracked);
        setStatus('Link copied. You post it yourself.');
      } catch {
        setStatus(tracked);
      }
      return;
    }
    if (channel === 'native') {
      try {
        await navigator.share({ text: post, url: tracked });
      } catch {
        /* the sheet was dismissed */
      }
      return;
    }
    window.open(shareIntent(channel, tracked, post), '_blank', 'noopener,noreferrer');
  };

  const revoke = async () => {
    if (!pageId) return;
    setBusy(true);
    const result = await revokeWinPage(pageId);
    setBusy(false);
    if (!result.ok) {
      setStatus(result.error || 'Could not revoke the public page.');
      return;
    }
    const latest = domain ? listAudits({ domain })[0] : undefined;
    if (latest) forgetWinShare(latest.id);
    setPageId(null);
    setPageUrl(null);
    setStatus('Public page revoked.');
  };

  return (
    <section className="rounded-2xl border border-gold bg-black px-4 py-4">
      <h3 className="text-lg font-semibold text-white">Share your win</h3>
      <p className="mt-2 text-base leading-relaxed text-gray-100">
        The public page shows the agency name, this result, and the date. Findings, evidence, and fixes stay off it. Edit the post, then publish it yourself.
      </p>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-gray-100">
        <input
          type="checkbox"
          checked={hideScore}
          disabled={pageUrl != null}
          onChange={(event) => {
            setHideScore(event.target.checked);
            setEdited(false);
          }}
        />
        Hide the score
      </label>
      <label htmlFor="win-post" className="mt-3 block text-sm text-gray-300">Post text. You post this yourself.</label>
      <textarea
        id="win-post"
        value={shown}
        rows={4}
        onChange={(event) => {
          setEdited(true);
          setText(event.target.value);
        }}
        className="mt-1 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-base leading-relaxed text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`${buttonClass} bg-gold text-black`} disabled={busy} onClick={() => void publish('linkedin')}>LinkedIn</button>
        <button type="button" className={`${buttonClass} border border-gold text-gold-light`} disabled={busy} onClick={() => void publish('x')}>X</button>
        <button type="button" className={`${buttonClass} border border-white/20 text-gray-100`} disabled={busy} onClick={() => void publish('copy')}>Copy link</button>
        {canNativeShare && (
          <button type="button" className={`${buttonClass} border border-white/20 text-gray-100`} disabled={busy} onClick={() => void publish('native')}>Share</button>
        )}
        {pageId && (
          <button type="button" className={`${buttonClass} border border-white/20 text-gray-100`} disabled={busy} onClick={() => void revoke()}>Revoke public page</button>
        )}
      </div>
      {status && <p className="mt-3 text-sm leading-relaxed text-gray-100" role="status">{status}</p>}
    </section>
  );
}
