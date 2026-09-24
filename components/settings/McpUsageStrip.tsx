import React, { useEffect, useState } from 'react';
import { entitlementsFor } from '../../services/plans/planEntitlements';
import { fetchQuotaStatus, getCurrentQuotaSync, apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';

type CatalogueTool = { name: string; description: string; creditClass: 'free' | 'paid' };

const FALLBACK_CATALOGUE: CatalogueTool[] = [
  { name: 'whoami', description: 'Account and plan', creditClass: 'free' },
  { name: 'list_projects', description: 'List SEO projects', creditClass: 'free' },
  { name: 'create_project', description: 'Create a project', creditClass: 'free' },
  { name: 'get_project_context', description: 'Read project memory', creditClass: 'free' },
  { name: 'update_project_context', description: 'Update project memory', creditClass: 'free' },
  { name: 'list_reports', description: 'List agent reports', creditClass: 'free' },
  { name: 'get_report', description: 'Fetch one report', creditClass: 'free' },
  { name: 'save_report', description: 'Save an agent report', creditClass: 'free' },
  { name: 'research_keywords', description: 'Keyword ideas (DFS)', creditClass: 'paid' },
  { name: 'get_domain_overview', description: 'Domain overview (DFS)', creditClass: 'paid' },
  { name: 'get_serp_results', description: 'SERP snapshot (DFS)', creditClass: 'paid' },
  { name: 'get_backlinks_overview', description: 'Backlinks summary (DFS)', creditClass: 'paid' },
];

/**
 * Thin Settings strip: plan MCP entitlements + free vs paid tool catalogue.
 */
export const McpUsageStrip: React.FC = () => {
  const [plan, setPlan] = useState<string>('free');
  const [tools, setTools] = useState<CatalogueTool[]>(FALLBACK_CATALOGUE);
  const [mcpAccessRequired, setMcpAccessRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const q = (await fetchQuotaStatus()) || getCurrentQuotaSync();
      if (!cancelled && q?.plan) setPlan(q.plan);
      const base = apiBase();
      if (!base) return;
      try {
        const r = await workerFetchWithAuthRetry(`${base}/api/api-keys`, { method: 'GET' });
        if (r.status === 403) {
          const data = (await r.json().catch(() => ({}))) as { code?: string };
          if (!cancelled && data.code === 'MCP_ACCESS_REQUIRED') {
            setMcpAccessRequired(true);
          }
          return;
        }
        if (!r.ok) return;
        const data = (await r.json()) as { tools?: CatalogueTool[] };
        if (!cancelled && Array.isArray(data.tools) && data.tools.length) {
          setMcpAccessRequired(false);
          setTools(
            data.tools.map((t) => ({
              name: t.name,
              description: t.description,
              creditClass: t.creditClass === 'paid' ? 'paid' : 'free',
            })),
          );
        }
      } catch {
        // Keep fallback catalogue offline / unsigned-in.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const caps = entitlementsFor(plan);
  const freeTools = tools.filter((t) => t.creditClass === 'free');
  const paidTools = tools.filter((t) => t.creditClass === 'paid');

  return (
    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-gray-200 tracking-wide">MCP agent access</p>
        <span className="text-[9px] font-mono uppercase text-gray-400">{plan || 'free'}</span>
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed">
        Endpoint: <span className="font-mono text-gray-300">/api/mcp</span>
        {' · '}
        Free tools: {caps.mcpAccess ? 'Growth+ yes' : 'upgrade to Growth+'}
        {' · '}
        Paid research: {caps.apiAccess ? 'Agency hosted or BYOK' : 'BYOK DataForSEO or Agency'}
      </p>
      {mcpAccessRequired ? (
        <p className="text-[11px] text-warning-300 leading-relaxed" role="status">
          MCP access requires Growth or Agency. Upgrade to unlock the free MCP tool catalogue and agent API keys.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
          <div>
            <p className="text-gray-500 uppercase mb-1">Free ({freeTools.length})</p>
            <ul className="space-y-0.5 text-gray-300">
              {freeTools.map((t) => (
                <li key={t.name} title={t.description}>
                  {t.name}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-gray-500 uppercase mb-1">Paid ({paidTools.length})</p>
            <ul className="space-y-0.5 text-gray-300">
              {paidTools.map((t) => (
                <li key={t.name} title={t.description}>
                  {t.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <p className="text-[10px] text-gray-500">
        Docs: /docs/mcp.html · Plugin: plugins/luminara
      </p>
    </div>
  );
};
