import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ICONS } from '../../constants';
import { brandNameFor, readableStem } from '../../services/audit/brandName';
import type { BoardFinding } from '../../services/audit/findingBoardService';
import {
  comparisonOutlineDraft,
  llmsTxtDraft,
  organizationJsonLd,
} from '../../services/audit/fixPackCopy';
import {
  buildVerifiedRemediationPrBundle,
  type VerifiedPrHandoffBundle,
} from '../../services/deployment/remediationTierRouter';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';
import { firstVerifiedRivalFromReport } from './CompetitorMap';

interface SelfDrivingHabitatBarProps {
  domain: string;
  brandName: string;
  primary: BoardFinding | null;
  reportMarkdown?: string;
  verifyBy: string;
}

type HabitatTab = 'handoff' | 'compiler' | 'habitat';

interface PendingActionRequestItem {
  id: string;
  tool_name: string;
  project_id: string | null;
  status: string;
  created_at: number;
}

interface HabitatRunItem {
  run_id: string;
  surface: string;
  status: string;
  started_at: number;
}

interface HabitatStatusPayload {
  pendingRequests: PendingActionRequestItem[];
  recentRuns: HabitatRunItem[];
  budget?: {
    state?: string;
    spentCents?: number;
  };
  compiledRules: string[];
}

function habitatFetch(path: string, init?: RequestInit): Promise<Response> {
  return workerFetchWithAuthRetry(`${apiBase()}/api${path}`, init);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return habitatFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const SelfDrivingHabitatBar: React.FC<SelfDrivingHabitatBarProps> = ({
  domain,
  brandName,
  primary,
  reportMarkdown,
  verifyBy,
}) => {
  // A response for a domain the user has left must not land on the new one.
  const domainRef = useRef(domain);
  domainRef.current = domain;
  const [activeTab, setActiveTab] = useState<HabitatTab>('handoff');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Pillar 2 & 4: Coasean Handoff state
  const [syncingHandoff, setSyncingHandoff] = useState(false);
  const [handoffSyncedNote, setHandoffSyncedNote] = useState<string | null>(null);

  // Pillar 1: Review-to-Skill Compiler state
  const [ruleInput, setRuleInput] = useState('');
  const [ruleTarget, setRuleTarget] = useState(primary?.category || 'sitewide_aeo');
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [compilingRule, setCompilingRule] = useState(false);
  const [compiledRules, setCompiledRules] = useState<string[]>([]);
  const [compilerSuccess, setCompilerSuccess] = useState<string | null>(null);

  // Pillar 3: Agent Habitat Control Plane state
  const [habitatLoading, setHabitatLoading] = useState(false);
  const [habitatError, setHabitatError] = useState<string | null>(null);
  const [habitatStatus, setHabitatStatus] = useState<HabitatStatusPayload | null>(null);
  const [mintingToken, setMintingToken] = useState(false);
  const [mintedToken, setMintedToken] = useState<{ token: string; maxRisk: string; expiresAt: number } | null>(null);
  const [maxRiskChoice, setMaxRiskChoice] = useState<'read' | 'write'>('read');
  const [denyReasonById, setDenyReasonById] = useState<Record<string, string>>({});
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const rivalName = useMemo(
    () => firstVerifiedRivalFromReport(reportMarkdown || ''),
    [reportMarkdown],
  );

  const effectiveBrand = useMemo(
    () => brandNameFor(domain, brandName) || readableStem(domain) || domain,
    [domain, brandName],
  );

  const localPrBundle: VerifiedPrHandoffBundle = useMemo(() => {
    const title = primary?.title || `Deploy llms.txt and Organization JSON-LD for ${domain}`;
    const desc = primary?.description || `Help AI answer engines cite the right facts for ${effectiveBrand}.`;
    const llms = llmsTxtDraft(domain, {
      siteName: effectiveBrand,
      description: desc,
    });
    const schema = organizationJsonLd(domain, {
      siteName: effectiveBrand,
      description: desc,
    });
    const compare = comparisonOutlineDraft(domain, { siteName: effectiveBrand, description: desc }, rivalName);
    return buildVerifiedRemediationPrBundle({
      domain,
      brandName: effectiveBrand,
      findingTitle: title,
      findingId: primary?.id || null,
      llmsTxtContent: llms,
      jsonLdContent: schema,
      comparisonMarkdown: compare,
    });
  }, [domain, effectiveBrand, primary?.id, primary?.title, primary?.description, rivalName]);

  const salesBriefText = useMemo(() => {
    const title = primary?.title || `Publish llms.txt and Organization JSON-LD for ${domain}`;
    const desc = primary?.description || `AI answer engines may cite incomplete third-party summaries for ${effectiveBrand}.`;
    return [
      `# Reputation Firewall and Front-Desk Brief: ${effectiveBrand}`,
      `Active Fix: ${title}`,
      `Risk Summary: ${desc}`,
      `Talking Point: Direct prospects to https://${domain} for current scope and pricing while the ${localPrBundle.branchName} fix goes live. Target re-check: ${verifyBy}.`,
    ].join('\n');
  }, [domain, effectiveBrand, primary?.title, primary?.description, localPrBundle.branchName, verifyBy]);

  const loadHabitatStatus = useCallback(async () => {
    setHabitatLoading(true);
    setHabitatError(null);
    try {
      const res = await habitatFetch(`/agent-habitat/status?domain=${encodeURIComponent(domain)}`);
      if (domainRef.current !== domain) return;
      if (res.status === 401) {
        setHabitatStatus(null);
        setCompiledRules([]);
        setHabitatError('Sign in to see approvals, rules and agent activity.');
        return;
      }
      if (!res.ok) throw new Error(`Status HTTP ${res.status}`);
      const data = (await res.json()) as HabitatStatusPayload;
      if (domainRef.current !== domain) return;
      setCompiledRules(data.compiledRules || []);
      setHabitatStatus({
        pendingRequests: data.pendingRequests || [],
        recentRuns: data.recentRuns || [],
        budget: data.budget,
        compiledRules: data.compiledRules || [],
      });
    } catch {
      setHabitatError('Could not load agent activity. Try again in a moment.');
    } finally {
      setHabitatLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    setCompiledRules([]);
    setHabitatStatus(null);
    setMintedToken(null);
    setHandoffSyncedNote(null);
    setCompilerSuccess(null);
    setRuleError(null);
    setHabitatError(null);
  }, [domain]);

  useEffect(() => {
    if (primary?.category) {
      setRuleTarget(primary.category);
    }
  }, [primary?.category]);

  useEffect(() => {
    if (activeTab !== 'handoff') void loadHabitatStatus();
  }, [activeTab, loadHabitatStatus]);

  const copyText = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2200);
  };

  const handleSyncCoaseanHandoff = async () => {
    if (syncingHandoff) return;
    setSyncingHandoff(true);
    setHandoffSyncedNote(null);
    try {
      const res = await postJson('/agent-habitat/handoff-packet', {
        domain,
        brandName: effectiveBrand,
        findingId: primary?.id || undefined,
        findingTitle: primary?.title || undefined,
        findingDescription: primary?.description || undefined,
        rivalName: rivalName || undefined,
        verifyByDate: verifyBy,
      });
      const body = (await res.json().catch(() => null)) as { packet?: { preparedAssetId?: string | null } } | null;
      if (domainRef.current !== domain) return;
      if (body?.packet?.preparedAssetId) {
        setHandoffSyncedNote('Saved to your account.');
      } else if (res.status === 401) {
        setHandoffSyncedNote('Sign in to save this packet. The copy buttons still work.');
      } else {
        setHandoffSyncedNote('Could not save this packet. The copy buttons still work.');
      }
    } catch {
      setHandoffSyncedNote('Could not reach the server. The copy buttons still work.');
    } finally {
      setSyncingHandoff(false);
    }
  };

  const handleCompileRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = ruleInput.replace(/\u2014/g, '-').trim();
    if (trimmed.length < 4) {
      setRuleError('Enter at least 4 characters describing the rule or correction.');
      return;
    }
    setRuleError(null);
    setCompilingRule(true);
    setCompilerSuccess(null);
    try {
      const res = await postJson('/agent-habitat/feedback-rule', {
        domain,
        reason: trimmed,
        targetToolOrAsset: ruleTarget,
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; ruleText?: string; error?: string } | null;
      if (domainRef.current !== domain) return;
      if (!body?.ok || !body.ruleText) {
        setRuleError(res.status === 401 ? 'Sign in to save rules.' : body?.error || 'Could not save this rule.');
        return;
      }
      const saved = body.ruleText;
      setCompiledRules((rules) => [saved, ...rules.filter((r) => r !== saved)]);
      setRuleInput('');
      setCompilerSuccess('Saved. Oracle chats and connected agents now follow this rule.');
    } catch {
      setRuleError('Could not reach the server. Your rule was not saved.');
    } finally {
      setCompilingRule(false);
    }
  };

  const handleMintHabitatToken = async () => {
    if (mintingToken) return;
    setMintingToken(true);
    setHabitatError(null);
    try {
      const res = await postJson('/agent-habitat/tokens', {
        domain,
        maxRisk: maxRiskChoice,
        ttlMinutes: 60,
        label: `Habitat ${domain} (${maxRiskChoice})`,
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        token?: string;
        record?: { maxRisk: string; expiresAt: number };
        error?: string;
      } | null;
      if (domainRef.current !== domain) return;
      if (!res.ok || !body?.ok || !body.token || !body.record) {
        setHabitatError(body?.error || 'Sign in on a Growth or Agency plan to create agent tokens.');
        return;
      }
      setMintedToken({
        token: body.token,
        maxRisk: body.record.maxRisk,
        expiresAt: body.record.expiresAt,
      });
    } catch {
      setHabitatError('Could not create the token. Check your connection.');
    } finally {
      setMintingToken(false);
    }
  };

  const handleDecideActionRequest = async (id: string, decision: 'approve' | 'deny') => {
    if (decidingId) return;
    setDecidingId(id);
    setHabitatError(null);
    try {
      const reason = (denyReasonById[id] || '').trim();
      const res = await postJson(
        `/mcp-action-requests/${encodeURIComponent(id)}/${decision}`,
        decision === 'deny' ? { reason, domain } : {},
      );
      if (!res.ok) {
        setHabitatError(`Could not ${decision} action request (HTTP ${res.status}).`);
        return;
      }
      await loadHabitatStatus();
    } catch {
      setHabitatError(`Network error while attempting to ${decision} action request.`);
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <div
      className="mb-6 rounded-xl border border-gold/30 bg-black/60 p-4"
      aria-label="Agent workspace"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-gold/15 border border-gold/40 text-gold-light font-bold">
            Agent workspace
          </span>
          <span className="text-xs text-gray-400">
            Hand off this fix, set rules for your agents, and control what they can do
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Agent workspace tabs">
          {(
            [
              { id: 'handoff', label: '1. Team handoff' },
              { id: 'compiler', label: `2. Rules (${compiledRules.length})` },
              { id: 'habitat', label: '3. Agent access' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono uppercase tracking-wider border transition-colors ${
                activeTab === t.id
                  ? 'border-gold/60 bg-gold/20 text-gold-light font-bold'
                  : 'border-white/10 bg-white/[0.03] text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'handoff' && (
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div>
              <span
                className={`font-mono text-[10px] uppercase tracking-wider block ${
                  localPrBundle.validationReceipt.allPassed ? 'text-green-400' : 'text-amber-400'
                }`}
              >
                Pre-flight checks: {localPrBundle.validationReceipt.allPassed ? '3 of 3 passed' : 'Attention needed'}
              </span>
              <p className="text-gray-300 mt-0.5">
                Branch <code className="text-gold-light font-mono">{localPrBundle.branchName}</code> is ready for your developer, with a front-desk brief and a 14-day retest.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copyText('gh_pr', localPrBundle.ghCliScript)}
                className="px-2.5 py-1.5 rounded-lg border border-gold/50 bg-gold/15 hover:bg-gold/25 text-gold-light font-mono text-[11px] uppercase tracking-wider transition-colors"
              >
                {copiedKey === 'gh_pr' ? 'Copied PR Script' : 'Copy PR Script'}
              </button>
              <button
                type="button"
                onClick={() => copyText('cursor_prompt', localPrBundle.cursorDeepLinkPrompt)}
                className="px-2.5 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-gray-200 font-mono text-[11px] uppercase tracking-wider transition-colors"
              >
                {copiedKey === 'cursor_prompt' ? 'Copied Agent Task' : 'Copy Cursor/MCP Task'}
              </button>
              <button
                type="button"
                onClick={() => copyText('sales_brief', salesBriefText)}
                className="px-2.5 py-1.5 rounded-lg border border-cyan-400/40 bg-cyan-400/10 hover:bg-cyan-400/20 text-cyan-200 font-mono text-[11px] uppercase tracking-wider transition-colors"
              >
                {copiedKey === 'sales_brief' ? 'Copied Sales Brief' : 'Copy Sales Brief'}
              </button>
              <button
                type="button"
                disabled={syncingHandoff}
                onClick={handleSyncCoaseanHandoff}
                className="px-2.5 py-1.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-gray-300 font-mono text-[11px] uppercase tracking-wider disabled:opacity-40"
              >
                {syncingHandoff ? 'Syncing...' : 'Save Handoff Packet'}
              </button>
            </div>
          </div>

          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {localPrBundle.validationReceipt.checks.map((chk) => (
              <li
                key={chk.id}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 flex items-start gap-2"
              >
                <ICONS.Check
                  className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${chk.passed ? 'text-green-400' : 'text-amber-400'}`}
                />
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-white block">
                    {chk.label}
                  </span>
                  <span className="text-[11px] text-gray-400">{chk.detail}</span>
                </div>
              </li>
            ))}
          </ul>

          {handoffSyncedNote && (
            <p className="text-[11px] font-mono text-gold-light">{handoffSyncedNote}</p>
          )}
        </div>
      )}

      {activeTab === 'compiler' && (
        <div className="space-y-3 text-xs">
          <form onSubmit={handleCompileRule} className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-2">
                <label
                  htmlFor="review-skill-input"
                  className="block text-[10px] font-mono uppercase tracking-wider text-gray-400 mb-1"
                >
                  Correction or rule for your agents
                </label>
                <input
                  id="review-skill-input"
                  type="text"
                  value={ruleInput}
                  onChange={(e) => {
                    setRuleInput(e.target.value);
                    if (ruleError) setRuleError(null);
                  }}
                  onBlur={() => {
                    if (ruleInput.trim().length > 0 && ruleInput.trim().length < 4) {
                      setRuleError('Enter at least 4 characters describing the rule.');
                    }
                  }}
                  placeholder="e.g. Never overwrite Elementor layout; always cite AUD pricing with GST."
                  className="w-full rounded-lg border border-white/15 bg-black/80 px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:border-gold focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="review-skill-target"
                  className="block text-[10px] font-mono uppercase tracking-wider text-gray-400 mb-1"
                >
                  Applies to
                </label>
                <div className="flex gap-2">
                  <input
                    id="review-skill-target"
                    type="text"
                    value={ruleTarget}
                    onChange={(e) => setRuleTarget(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/80 px-2.5 py-1.5 text-xs text-white focus:border-gold focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={compilingRule}
                    className="px-3 py-1.5 rounded-lg bg-gold text-black font-bold text-[11px] uppercase tracking-wider hover:bg-gold-light disabled:opacity-40 shrink-0"
                  >
                    {compilingRule ? 'Saving...' : 'Save rule'}
                  </button>
                </div>
              </div>
            </div>
            {ruleError && <p className="text-[11px] font-mono text-amber-400">{ruleError}</p>}
            {compilerSuccess && <p className="text-[11px] font-mono text-green-400">{compilerSuccess}</p>}
          </form>

          {compiledRules.length === 0 ? (
            <p className="text-[11px] text-gray-500 font-mono">
              No rules for {domain} yet. Add one above and Oracle chats and connected agents will follow it.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-36 overflow-auto">
              {compiledRules.map((rule, idx) => (
                <li
                  key={`${idx}-${rule.slice(0, 24)}`}
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-[11px] text-gray-300 font-mono"
                >
                  {rule}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'habitat' && (
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-gold-light block">
                Temporary agent token
              </span>
              <p className="text-gray-400 text-[11px]">
                A 60-minute token locked to {domain}. Use it instead of a long-lived API key.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <label htmlFor="habitat-risk-select" className="sr-only">
                What the token can do
              </label>
              <select
                id="habitat-risk-select"
                value={maxRiskChoice}
                onChange={(e) => setMaxRiskChoice(e.target.value === 'write' ? 'write' : 'read')}
                className="max-w-full rounded-lg border border-white/15 bg-black px-2.5 py-1.5 text-[11px] font-mono text-white"
              >
                <option value="read">Read only</option>
                <option value="write">Read and write (nothing destructive)</option>
              </select>
              <button
                type="button"
                disabled={mintingToken}
                onClick={handleMintHabitatToken}
                className="px-3 py-1.5 rounded-lg border border-gold/50 bg-gold/15 hover:bg-gold/25 text-gold-light font-mono text-[11px] uppercase tracking-wider disabled:opacity-40"
              >
                {mintingToken ? 'Creating...' : 'Create token'}
              </button>
            </div>
          </div>

          {mintedToken && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-[11px] text-green-300 break-all">
                Copy this now, it will not be shown again ({mintedToken.maxRisk}, 60 minutes): <code>{mintedToken.token}</code>
              </div>
              <button
                type="button"
                onClick={() => copyText('hab_token', mintedToken.token)}
                className="px-2.5 py-1 rounded border border-green-400/40 text-green-200 font-mono text-[10px] uppercase tracking-wider"
              >
                {copiedKey === 'hab_token' ? 'Copied' : 'Copy Token'}
              </button>
            </div>
          )}

          {habitatLoading && (
            <p className="text-[11px] font-mono text-gray-400">Loading agent activity...</p>
          )}
          {habitatError && (
            <p className="text-[11px] font-mono text-amber-400">{habitatError}</p>
          )}

          {habitatStatus && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400 block mb-2">
                  Waiting for your approval ({habitatStatus.pendingRequests.length})
                </span>
                {habitatStatus.pendingRequests.length === 0 ? (
                  <p className="text-[11px] text-gray-500 font-mono">
                    Nothing is waiting for your approval.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {habitatStatus.pendingRequests.map((req) => (
                      <li key={req.id} className="rounded border border-white/10 p-2 space-y-1.5">
                        <div className="flex items-center justify-between font-mono text-[11px] text-white">
                          <span>{req.tool_name}</span>
                          <span className="text-amber-300 text-[10px]">{req.status}</span>
                        </div>
                        <input
                          type="text"
                          value={denyReasonById[req.id] || ''}
                          onChange={(e) =>
                            setDenyReasonById((prev) => ({ ...prev, [req.id]: e.target.value }))
                          }
                          placeholder="Reason for denying (optional, saved as a rule)"
                          className="w-full rounded border border-white/10 bg-black px-2 py-1 text-[11px] text-gray-200"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={decidingId === req.id}
                            onClick={() => handleDecideActionRequest(req.id, 'approve')}
                            className="px-2 py-1 rounded bg-green-500/20 border border-green-500/40 text-green-300 font-mono text-[10px] uppercase"
                          >
                            Approve Once
                          </button>
                          <button
                            type="button"
                            disabled={decidingId === req.id}
                            onClick={() => handleDecideActionRequest(req.id, 'deny')}
                            className="px-2 py-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-mono text-[10px] uppercase"
                          >
                            Deny
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400 block mb-2">
                  Recent agent runs ({habitatStatus.recentRuns.length})
                </span>
                {habitatStatus.recentRuns.length === 0 ? (
                  <p className="text-[11px] text-gray-500 font-mono">
                    No agent runs recorded yet.
                  </p>
                ) : (
                  <ul className="space-y-1 max-h-28 overflow-auto">
                    {habitatStatus.recentRuns.slice(0, 6).map((run) => (
                      <li
                        key={run.run_id}
                        className="flex items-center justify-between font-mono text-[11px] text-gray-300"
                      >
                        <span>{run.surface}</span>
                        <span className="text-gray-400">{run.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
