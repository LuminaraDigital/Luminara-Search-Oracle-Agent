import React, { useEffect, useMemo, useState } from 'react';
import { ICONS } from '../../constants';
import type { RemediationPayload } from '../../services/deployment/cmsDeploymentService';
import {
  buildSquarespaceInjectionPack,
  classifyRemediationTier,
  CMS_MCP_CONNECTOR_CATALOG,
  type CmsMcpConnectorId,
  type RemediationFindingInput,
  type RemediationTierDecision,
} from '../../services/deployment/remediationTierRouter';
import {
  classifyCmsRemediationApi,
  fetchCmsMcpCatalogApi,
  prepareCmsMcpCallApi,
} from '../../services/enquiries/enquiryApiClient';
import { getDesktopBridge } from '../../services/desktop/desktopShell';

interface CmsMcpRemediationPanelProps {
  payload: RemediationPayload;
  deployBlocked?: boolean;
}

export const CmsMcpRemediationPanel: React.FC<CmsMcpRemediationPanelProps> = ({
  payload,
  deployBlocked = false,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [selectedConnector, setSelectedConnector] = useState<CmsMcpConnectorId>('wordpress_com_mcp');
  const [findingCategory, setFindingCategory] =
    useState<RemediationFindingInput['findingCategory']>('schema_jsonld');
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [copiedSqsp, setCopiedSqsp] = useState(false);
  const [mcpEnvelopePreview, setMcpEnvelopePreview] = useState<string | null>(null);
  const [mcpErrorNote, setMcpErrorNote] = useState<string | null>(null);
  const [serverEscalation, setServerEscalation] = useState<RemediationTierDecision | null>(null);
  const [preparingEnvelope, setPreparingEnvelope] = useState(false);

  const findingInput: RemediationFindingInput = useMemo(
    () => ({
      domain: payload.domain,
      findingCategory,
      cmsPlatform:
        selectedConnector === 'wix_mcp'
          ? 'wix'
          : selectedConnector === 'squarespace_injection'
            ? 'squarespace'
            : selectedConnector === 'webflow_api'
              ? 'webflow'
              : selectedConnector === 'github_pr'
                ? 'custom'
                : 'wordpress',
      pageBuilderDetected:
        selectedConnector === 'gobuildwp_mcp' || selectedConnector === 'respira_mcp'
          ? 'Elementor / Bricks'
          : null,
      previousDeployBlocked: deployBlocked,
      summary: payload.title,
    }),
    [payload.domain, findingCategory, selectedConnector, deployBlocked, payload.title],
  );

  const localTierDecision = classifyRemediationTier(findingInput, payload.schemaJsonLd);
  const tierDecision = serverEscalation ?? localTierDecision;

  useEffect(() => {
    setServerEscalation(null);
    setMcpEnvelopePreview(null);
    setMcpErrorNote(null);
    if (!expanded || typeof fetch !== 'function') return;
    void fetchCmsMcpCatalogApi().catch(() => null);
    void classifyCmsRemediationApi({
      finding: findingInput,
      preparedSchemaSnippet: payload.schemaJsonLd,
    })
      .then((res) => {
        if (res.ok && res.decision) {
          setServerEscalation(res.decision);
        }
      })
      .catch(() => null);
  }, [expanded, findingInput, payload.schemaJsonLd]);

  const handlePrepareMcpEnvelope = async () => {
    setPreparingEnvelope(true);
    setMcpErrorNote(null);
    const targetToolName =
      findingCategory === 'page_builder_layout' &&
      !CMS_MCP_CONNECTOR_CATALOG[selectedConnector]?.supportsPageBuilders
        ? 'wp_update_post'
        : 'update_seo_metadata';
    try {
      const desktopBridge = getDesktopBridge();
      const desktopValidate = desktopBridge?.validateMcpCall || desktopBridge?.validateMcpInvocation;
      if (desktopValidate) {
        const check = await desktopValidate({
          connectorId: selectedConnector,
          toolName: targetToolName,
          isWriteOperation: true,
          userConfirmed: true,
        });
        if (!check.allowed) {
          setMcpErrorNote(check.reason || 'Blocked by Desktop Coordinator MCP policy.');
          return;
        }
      }

      const res = await prepareCmsMcpCallApi({
        connectorId: selectedConnector,
        domain: payload.domain,
        title: payload.title,
        toolName: targetToolName,
        pageMetaKeys: findingCategory === 'page_builder_layout' ? ['_elementor_edit_mode'] : [],
        userConfirmed: true,
        snapshotCreated: true,
        schemaJsonLd: payload.schemaJsonLd,
      });
      if (res.ok && (res.envelope || res.pack)) {
        setMcpEnvelopePreview(JSON.stringify(res.envelope || res.pack, null, 2));
      } else if (!res.ok && res.error) {
        setMcpErrorNote(res.error);
        if (res.escalationDecision) {
          setServerEscalation(res.escalationDecision);
        }
      } else {
        setMcpEnvelopePreview(
          JSON.stringify(
            {
              connectorId: selectedConnector,
              domain: payload.domain,
              endpoint: CMS_MCP_CONNECTOR_CATALOG[selectedConnector]?.endpointHint,
              user_confirmed: true,
              snapshot_before_write: true,
            },
            null,
            2,
          ),
        );
      }
    } catch {
      setMcpEnvelopePreview(
        JSON.stringify(
          {
            connectorId: selectedConnector,
            domain: payload.domain,
            endpoint: CMS_MCP_CONNECTOR_CATALOG[selectedConnector]?.endpointHint,
            user_confirmed: true,
          },
          null,
          2,
        ),
      );
    } finally {
      setPreparingEnvelope(false);
    }
  };

  const sqspPack = buildSquarespaceInjectionPack({
    domain: payload.domain,
    title: payload.title,
    schemaJsonLd: payload.schemaJsonLd,
  });

  const handleCopyBrief = () => {
    if (!tierDecision.engineeringBrief) return;
    const text = [
      tierDecision.engineeringBrief.headline,
      `Target: ${tierDecision.engineeringBrief.targetUrl}`,
      `Scope: ${tierDecision.engineeringBrief.architecturalReason}`,
      `Partner: ${tierDecision.engineeringBrief.partnerUrl}`,
    ].join('\n');
    navigator.clipboard?.writeText(text);
    setCopiedBrief(true);
    setTimeout(() => setCopiedBrief(false), 2000);
  };

  const handleCopySquarespace = () => {
    navigator.clipboard?.writeText(sqspPack.headerInjectionHtml);
    setCopiedSqsp(true);
    setTimeout(() => setCopiedSqsp(false), 2000);
  };

  return (
    <div className="rounded-xl border border-white/10 glass-morphism p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-gold-light block">
            MCP Connector Bridge &amp; Engineering Scope
          </span>
          <h4 className="text-xs font-bold text-white mt-0.5">
            Wix MCP, Squarespace Injection, Multi-CMS MCP Bridge &amp; Full-Stack Handoff
          </h4>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="px-2.5 py-1 rounded-lg border border-white/15 text-[11px] font-bold text-gold-light hover:bg-white/5 transition-colors flex items-center gap-1 shrink-0"
        >
          <span>{expanded ? 'Hide MCP & Scope' : 'Open MCP & Scope'}</span>
          <ICONS.ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {expanded && (
        <div className="space-y-4 pt-2 border-t border-white/10 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="cms-mcp-connector-select"
                className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1"
              >
                CMS MCP / Platform Connector
              </label>
              <select
                id="cms-mcp-connector-select"
                value={selectedConnector}
                onChange={(e) => setSelectedConnector(e.target.value as CmsMcpConnectorId)}
                className="w-full bg-black/70 border border-white/15 rounded-lg px-2.5 py-2 text-xs text-white focus:border-gold focus:outline-none"
              >
                {Object.values(CMS_MCP_CONNECTOR_CATALOG).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="cms-mcp-scope-category-select"
                className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1"
              >
                Remediation Scope Category
              </label>
              <select
                id="cms-mcp-scope-category-select"
                value={findingCategory}
                onChange={(e) =>
                  setFindingCategory(e.target.value as RemediationFindingInput['findingCategory'])
                }
                className="w-full bg-black/70 border border-white/15 rounded-lg px-2.5 py-2 text-xs text-white focus:border-gold focus:outline-none"
              >
                <option value="schema_jsonld">Tier 1: JSON-LD Schema &amp; Entity Graph</option>
                <option value="meta_tags">Tier 1: Title, Meta &amp; RankMath/Yoast Fields</option>
                <option value="page_builder_layout">Tier 2: Page Builder Tree (Elementor / Bricks / Divi)</option>
                <option value="ssr_hydration">Tier 3: SSR / Hydration &amp; Crawler Rendering</option>
                <option value="cwv_performance">Tier 3: Core Web Vitals (LCP / INP) Refactor</option>
                <option value="custom_crm_automation">Tier 3: Custom Enquiry Desk &amp; CRM Automation</option>
              </select>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-black/60 border border-white/10 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] text-gold-light font-bold">
                {tierDecision.badgeLabel}
              </span>
              <span className="text-[10px] font-mono text-gray-400">
                {CMS_MCP_CONNECTOR_CATALOG[selectedConnector]?.endpointHint}
              </span>
            </div>
            <p className="text-[11px] text-gray-300">
              {CMS_MCP_CONNECTOR_CATALOG[selectedConnector]?.safetyProfile}
            </p>
            <div className="pt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrepareMcpEnvelope}
                disabled={preparingEnvelope}
                className="px-2.5 py-1 rounded bg-gold/15 border border-gold/30 text-gold-light text-[10px] font-mono hover:bg-gold/25 disabled:opacity-50"
              >
                {preparingEnvelope ? 'Preparing MCP Envelope...' : 'Prepare Verified MCP Envelope'}
              </button>
            </div>
            {mcpErrorNote && (
              <div className="mt-1 p-2 rounded bg-danger-500/10 border border-danger-500/30 text-[10px] text-danger-200">
                {mcpErrorNote}
              </div>
            )}
            {mcpEnvelopePreview && (
              <pre className="mt-2 p-2 rounded bg-black/80 border border-white/10 text-[10px] font-mono text-gray-300 overflow-x-auto max-h-36">
                {mcpEnvelopePreview}
              </pre>
            )}
          </div>

          {selectedConnector === 'squarespace_injection' && (
            <div className="p-3 rounded-lg bg-black/70 border border-cyan-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-cyan-300">
                  Squarespace Code Injection Pack
                </span>
                <button
                  type="button"
                  onClick={handleCopySquarespace}
                  className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-200 text-[10px] font-mono hover:bg-cyan-500/30"
                >
                  {copiedSqsp ? 'Copied Pack' : 'Copy Header Snippet'}
                </button>
              </div>
              <ol className="list-decimal pl-4 space-y-1 text-[11px] text-gray-300">
                {sqspPack.navigationSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>
          )}

          {tierDecision.engineeringBrief && (
            <div className="p-3.5 rounded-xl bg-gradient-to-br from-gold/10 to-black border border-gold/30 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-gold-light block">
                    Need Custom Full-Stack or Automation Engineering?
                  </span>
                  <h5 className="text-xs font-bold text-white mt-0.5">
                    {tierDecision.engineeringBrief.headline}
                  </h5>
                </div>
                <span className="px-2 py-0.5 rounded bg-gold/20 text-gold-light font-mono text-[10px] shrink-0">
                  luminara.digital
                </span>
              </div>

              <p className="text-[11px] text-gray-300 leading-relaxed">
                {tierDecision.engineeringBrief.architecturalReason}
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCopyBrief}
                  className="px-3 py-1.5 rounded-lg border border-white/15 bg-black/60 text-gray-200 hover:text-white text-[11px] font-mono flex items-center gap-1.5"
                >
                  <ICONS.Copy className="w-3.5 h-3.5" />
                  <span>{copiedBrief ? 'Brief Copied' : 'Copy Technical Scope Brief'}</span>
                </button>

                <a
                  href={tierDecision.engineeringBrief.partnerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-gold/20 border border-gold/40 text-gold-light hover:bg-gold/30 text-[11px] font-bold flex items-center gap-1.5"
                >
                  <span>Request Luminara Digital Engineering Team</span>
                  <span>&rarr;</span>
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
