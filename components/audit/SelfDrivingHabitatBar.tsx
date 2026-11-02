import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

function localRulesStorageKey(domain: string): string {
  return `luminara_compiled_rules:${domain.toLowerCase()}`;
}

function readLocalRules(domain: string): string[] {
  try {
    const raw = localStorage.getItem(localRulesStorageKey(domain));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocalRules(domain: string, rules: string[]): void {
  try {
    localStorage.setItem(localRulesStorageKey(domain), JSON.stringify(rules.slice(0, 25)));
  } catch {
    /* ignore storage quota */
  }
}

export const SelfDrivingHabitatBar: React.FC<SelfDrivingHabitatBarProps> = ({
  domain,
  brandName,
  primary,
  reportMarkdown,
  verifyBy,
}) => {
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
  const [compiledRules, setCompiledRules] = useState<string[]>(() => readLocalRules(domain));
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
    const title = primary?.title || `Deploy verified llms.txt and Organization JSON-LD for ${domain}`;
    const desc = primary?.description || `Ensure AI answer engines cite verified facts for ${effectiveBrand}.`;
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
    const title = primary?.title || `Publish verified llms.txt and Organization JSON-LD for ${domain}`;
    const desc = primary?.description || `AI answer engines may cite incomplete third-party summaries for ${effectiveBrand}.`;
    return [
      `# Reputation Firewall & Front-Desk Brief: ${effectiveBrand}`,
      `Active Fix: ${title}`,
      `Risk Summary: ${desc}`,
      `Verified Talking Point: Direct prospects to https://${domain} for current scope and pricing while branch ${localPrBundle.branchName} propagates (target verification: ${verifyBy}).`,
    ].join('\n');
  }, [domain, effectiveBrand, primary?.title, primary?.description, localPrBundle.branchName, verifyBy]);

  const loadHabitatStatus = useCallback(async () => {
    setHabitatLoading(true);
    setHabitatError(null);
    try {
      const res = await fetch(`/api/agent-habitat/status?domain=${encodeURIComponent(domain)}`, {
        credentials: 'include',
      });
      if (res.status === 401) {
        setHabitatStatus({
          pendingRequests: [],
          recentRuns: [],
          compiledRules: readLocalRules(domain),
        });
        return;
      }
      if (!res.ok) {
        throw new Error(`Status HTTP ${res.status}`);
      }
      const data = (await res.json()) as HabitatStatusPayload & { ok?: boolean };
      const mergedRules = Array.from(
        new Set([...(data.compiledRules || []), ...readLocalRules(domain)]),
      );
      setCompiledRules(mergedRules);
      setHabitatStatus({
        pendingRequests: data.pendingRequests || [],
        recentRuns: data.recentRuns || [],
        budget: data.budget,
        compiledRules: mergedRules,
      });
    } catch {
      setHabitatError('Could not load live Agent Habitat telemetry. Local rules remain active.');
    } finally {
      setHabitatLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    setCompiledRules(readLocalRules(domain));
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
    if (activeTab === 'habitat') {
      void loadHabitatStatus();
    }
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
      const res = await fetch('/api/agent-habitat/handoff-packet', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain,
          brandName: effectiveBrand,
          findingId: primary?.id || undefined,
          findingTitle: primary?.title || undefined,
          findingDescription: primary?.description || undefined,
          rivalName: rivalName || undefined,
          verifyByDate: verifyBy,
        }),
      });
      if (res.ok) {
        setHandoffSyncedNote('Synced Coasean packet to account prepared assets.');
      } else {
        setHandoffSyncedNote('Ready locally (sign in to persist across devices).');
      }
    } catch {
      setHandoffSyncedNote('Ready locally (offline mode).');
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
    const optimisticRule = `[Rule from ${ruleTarget}] ${trimmed}`;
    try {
      const res = await fetch('/api/agent-habitat/feedback-rule', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain,
          reason: trimmed,
          targetToolOrAsset: ruleTarget,
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; ruleText?: string } | null;
      const finalRule = body?.ok && body.ruleText ? body.ruleText : optimisticRule;
      const next = [finalRule, ...compiledRules.filter((r) => r !== finalRule)];
      setCompiledRules(next);
      writeLocalRules(domain, next);
      setRuleInput('');
      setCompilerSuccess(
        body?.ok
          ? 'Compiled into shared Brand Memory & writing preferences.'
          : 'Saved rule locally in this browser (sign in to sync across agents).',
      );
    } catch {
      const next = [optimisticRule, ...compiledRules.filter((r) => r !== optimisticRule)];
      setCompiledRules(next);
      writeLocalRules(domain, next);
      setRuleInput('');
      setCompilerSuccess('Saved rule locally in this browser.');
    } finally {
      setCompilingRule(false);
    }
  };

  const handleMintHabitatToken = async () => {
    if (mintingToken) return;
    setMintingToken(true);
    setHabitatError(null);
    try {
      const res = await fetch('/api/agent-habitat/tokens', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain,
          maxRisk: maxRiskChoice,
          ttlMinutes: 60,
          label: `Habitat ${domain} (${maxRiskChoice})`,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        token?: string;
        record?: { maxRisk: string; expiresAt: number };
        error?: string;
      } | null;
      if (!res.ok || !body?.ok || !body.token || !body.record) {
        setHabitatError(body?.error || 'Sign in on a Growth or Agency plan to mint ephemeral Habitat tokens.');
        return;
      }
      setMintedToken({
        token: body.token,
        maxRisk: body.record.maxRisk,
        expiresAt: body.record.expiresAt,
      });
    } catch {
      setHabitatError('Could not mint Habitat token. Check network connection.');
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
      const res = await fetch(`/api/mcp-action-requests/${encodeURIComponent(id)}/${decision}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: decision === 'deny' ? JSON.stringify({ reason, domain, compileRule: Boolean(reason) }) : '{}',
      });
      if (!res.ok) {
        setHabitatError(`Could not ${decision} action request (HTTP ${res.status}).`);
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        compiledRule?: { ruleText?: string } | null;
      } | null;
      if (data?.compiledRule?.ruleText) {
        const next = [
          data.compiledRule.ruleText,
          ...compiledRules.filter((r) => r !== data.compiledRule?.ruleText),
        ];
        setCompiledRules(next);
        writeLocalRules(domain, next);
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
      aria-label="Self-Driving Agentic Loop"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-gold/15 border border-gold/40 text-gold-light font-bold">
            Self-Driving Agentic Loop
          </span>
          <span className="text-xs text-gray-400">
            Pre-verified PR handoff, Review-to-Skill compiler, and scoped Agent Habitat
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Self-Driving Agentic tabs">
          {(
            [
              { id: 'handoff', label: '1. Coasean Handoff & PR' },
              { id: 'compiler', label: `2. Review-to-Skill (${compiledRules.length})` },
              { id: 'habitat', label: '3. Agent Habitat' },
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
              <span className="font-mono text-[10px] uppercase tracking-wider text-green-400 block">
                Pre-Flight Verification: {localPrBundle.validationReceipt.allPassed ? '3/3 Checks Passed' : 'Attention Needed'}
              </span>
              <p className="text-gray-300 mt-0.5">
                Branch <code className="text-gold-light font-mono">{localPrBundle.branchName}</code> ready for 1-click engineering PR, Sales Reputation Brief, and 14-day QA retest.
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
                  Review Correction or Brand Constraint (Compiles into Shared Agent Skill)
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
                  Scope / Surface
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
                    {compilingRule ? 'Saving...' : 'Compile Rule'}
                  </button>
                </div>
              </div>
            </div>
            {ruleError && <p className="text-[11px] font-mono text-amber-400">{ruleError}</p>}
            {compilerSuccess && <p className="text-[11px] font-mono text-green-400">{compilerSuccess}</p>}
          </form>

          {compiledRules.length === 0 ? (
            <p className="text-[11px] text-gray-500 font-mono">
              No compiled review rules for {domain} yet. Add one above so future Oracle, Audit, and MCP runs inherit it automatically.
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
                Ephemeral Project-Scoped Credential (lm_hab_*)
              </span>
              <p className="text-gray-400 text-[11px]">
                Replaces long-lived static API keys with a 60-minute token locked to {domain} and a strict risk ceiling.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="habitat-risk-select" className="sr-only">
                Maximum Risk Ceiling
              </label>
              <select
                id="habitat-risk-select"
                value={maxRiskChoice}
                onChange={(e) => setMaxRiskChoice(e.target.value === 'write' ? 'write' : 'read')}
                className="rounded-lg border border-white/15 bg-black px-2.5 py-1.5 text-[11px] font-mono text-white"
              >
                <option value="read">Max Risk: read-only</option>
                <option value="write">Max Risk: write (no destructive)</option>
              </select>
              <button
                type="button"
                disabled={mintingToken}
                onClick={handleMintHabitatToken}
                className="px-3 py-1.5 rounded-lg border border-gold/50 bg-gold/15 hover:bg-gold/25 text-gold-light font-mono text-[11px] uppercase tracking-wider disabled:opacity-40"
              >
                {mintingToken ? 'Minting...' : 'Mint Scoped Token'}
              </button>
            </div>
          </div>

          {mintedToken && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-[11px] text-green-300 break-all">
                Token ({mintedToken.maxRisk}, 60m TTL): <code>{mintedToken.token}</code>
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
            <p className="text-[11px] font-mono text-gray-400">Loading Agent Habitat telemetry...</p>
          )}
          {habitatError && (
            <p className="text-[11px] font-mono text-amber-400">{habitatError}</p>
          )}

          {habitatStatus && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400 block mb-2">
                  Pending Destructive Tool Approvals ({habitatStatus.pendingRequests.length})
                </span>
                {habitatStatus.pendingRequests.length === 0 ? (
                  <p className="text-[11px] text-gray-500 font-mono">
                    Zero quarantined MCP actions awaiting human sign-off.
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
                          placeholder="Optional denial reason (compiles to skill rule)"
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
                            Deny &amp; Compile Rule
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-black/40 p-3">
                <span className="font-mono text-[10px] uppercase tracking-wider text-gray-400 block mb-2">
                  Recent Provenance Runs ({habitatStatus.recentRuns.length})
                </span>
                {habitatStatus.recentRuns.length === 0 ? (
                  <p className="text-[11px] text-gray-500 font-mono">
                    No server agent runs recorded yet for this account.
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
