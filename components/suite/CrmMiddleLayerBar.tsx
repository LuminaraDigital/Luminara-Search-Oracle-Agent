import React, { useEffect, useState } from 'react';
import {
  fetchCrmBridgeStatus,
  promoteEnquiryToLuminaraCrm,
  requestCrmLaunchAssertion,
  submitCrmHandoffPost,
  type CrmLinkStatus,
  type CrmMode,
} from '../../services/crm/crmClient';

interface CrmMiddleLayerBarProps {
  activeEnquiryId?: string;
  onEnabledChange?: (enabled: boolean) => void;
}

/**
 * Dark-launched Agentic CRM Middle-Layer toolbar for Enquiry Desk.
 * Renders nothing when `CRM_BRIDGE_ENABLED` is off so live production UI stays untouched.
 */
export const CrmMiddleLayerBar: React.FC<CrmMiddleLayerBarProps> = ({ activeEnquiryId, onEnabledChange }) => {
  const [status, setStatus] = useState<CrmLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = React.useCallback(async () => {
    const res = await fetchCrmBridgeStatus();
    setStatus(res);
    onEnabledChange?.(Boolean(res.enabled));
    return res;
  }, [onEnabledChange]);

  useEffect(() => {
    let active = true;
    void fetchCrmBridgeStatus().then((res) => {
      if (active) {
        setStatus(res);
        onEnabledChange?.(Boolean(res.enabled));
      }
    });
    return () => {
      active = false;
    };
  }, [onEnabledChange, activeEnquiryId]);

  useEffect(() => {
    setNotice(null);
    setPendingApproval(false);
    setError(null);
  }, [activeEnquiryId]);

  if (!status?.enabled) return null;

  const launchCrm = async (crmMode: CrmMode | undefined, nextPath: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await requestCrmLaunchAssertion({
      ...(crmMode ? { crmMode } : {}),
      nextPath,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    try {
      submitCrmHandoffPost(res.handoffUrl, res.assertion);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not open Luminara CRM.');
    }
  };

  const promoteActive = async () => {
    if (!activeEnquiryId || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setPendingApproval(false);
    const res = await promoteEnquiryToLuminaraCrm(activeEnquiryId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (!status.activated) {
      void refreshStatus();
    }
    if (res.status === 'pending_approval') {
      setPendingApproval(true);
      setNotice('Staged for approval in Luminara CRM. Review and sign off in Ink.');
      return;
    }
    const receipt = res.crmReceiptCode ? ` (Receipt ${res.crmReceiptCode})` : '';
    setNotice(
      res.duplicate
        ? `Already staged in Luminara CRM as Lead #${res.crmLeadId}${receipt}.`
        : `Promoted to Luminara CRM as Lead #${res.crmLeadId}${receipt}.`,
    );
  };

  const modeLabel =
    status.link?.crmMode === 'middle_layer'
      ? `Middle Layer -> ${status.link.primaryExternalCrm || 'Connected CRM'}`
      : 'Free Startup CRM';

  return (
    <div className="p-3 rounded-xl border border-gold/30 bg-black/70 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-gold-light">
            Luminara Agentic CRM Middle Layer
          </span>
          <span className="block text-[11px] text-gray-300">
            {status.activated
              ? `Active: ${modeLabel}`
              : 'Free AI-native CRM or non-invasive copilot for HubSpot and any existing CRM.'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void launchCrm(status.activated ? undefined : 'standalone', '/admin/agent/briefing')}
            className="px-3 py-1.5 rounded-lg bg-gold text-black font-bold text-xs disabled:opacity-40"
          >
            {status.activated ? 'Open Luminara CRM' : 'Open Free CRM'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void launchCrm('middle_layer', '/admin/crm-bridge')}
            className="px-3 py-1.5 rounded-lg border border-white/20 bg-black/60 text-xs text-gray-200 hover:text-white disabled:opacity-40"
          >
            Connect HubSpot / Existing CRM
          </button>
          {activeEnquiryId && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void promoteActive()}
              className="px-3 py-1.5 rounded-lg border border-gold/40 bg-gold/15 text-gold-light text-xs font-mono disabled:opacity-40"
            >
              Promote to CRM
            </button>
          )}
        </div>
      </div>
      {notice && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-emerald-300">{notice}</p>
          {pendingApproval && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void launchCrm(undefined, '/admin/agent/approvals')}
              className="px-2.5 py-1 rounded-md border border-emerald-400/40 bg-emerald-500/15 text-[11px] font-semibold text-emerald-200 disabled:opacity-40"
            >
              Review Approval
            </button>
          )}
        </div>
      )}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
};
