import React, { useEffect, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';

/**
 * Sandboxed agent report viewer for /reports/:id
 */
export const AgentReportView: React.FC = () => {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [title, setTitle] = useState('Report');

  useEffect(() => {
    const path = window.location.pathname.replace(/\/$/, '');
    const m = path.match(/\/reports\/([^/]+)$/i);
    const id = m?.[1];
    if (!id) {
      setError('Missing report id');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const metaRes = await workerFetchWithAuthRetry(
          `${apiBase()}/api/reports/${encodeURIComponent(id)}`,
          { method: 'GET' },
        );
        if (metaRes.status === 401) {
          if (!cancelled) {
            setNeedsSignIn(true);
            setError('Sign in to view this agent report.');
          }
          return;
        }
        const meta = (await metaRes.json()) as { report?: { title?: string }; error?: string };
        if (!metaRes.ok) throw new Error(meta.error || `HTTP ${metaRes.status}`);
        if (meta.report?.title) setTitle(meta.report.title);

        const htmlRes = await workerFetchWithAuthRetry(
          `${apiBase()}/api/reports/${encodeURIComponent(id)}/html`,
          { method: 'GET' },
        );
        if (htmlRes.status === 401) {
          if (!cancelled) {
            setNeedsSignIn(true);
            setError('Sign in to view this agent report.');
          }
          return;
        }
        if (!htmlRes.ok) throw new Error(`HTML ${htmlRes.status}`);
        const text = await htmlRes.text();
        if (!cancelled) setHtml(text);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load report');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center text-gray-300">
        <h1 className="text-xl font-semibold text-white mb-2">
          {needsSignIn ? 'Sign in required' : 'Report unavailable'}
        </h1>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!html) {
    return <div className="max-w-xl mx-auto px-4 py-16 text-center text-gray-400 text-sm">Loading report…</div>;
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="border-b border-gray-200 px-4 py-2 text-xs text-gray-500 flex justify-between">
        <span>{title}</span>
        <span>Luminara</span>
      </div>
      <iframe
        title={title}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={html}
        className="w-full min-h-[calc(100vh-40px)] border-0 bg-white"
      />
    </div>
  );
};

export default AgentReportView;
