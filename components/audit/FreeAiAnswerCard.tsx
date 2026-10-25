import React, { useEffect, useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';

interface CitedSource {
  title: string;
  url: string;
}

interface FreeAnswer {
  hidden?: boolean;
  label?: string;
  question?: string;
  answer?: string;
  agencies?: string[];
  userNamed?: boolean;
  sources?: CitedSource[];
  answeredAt?: string;
  fix?: string;
}

/** Source URLs come from search results: only web pages become links, opened outside the app. */
export function CitedSourceList({ sources }: { sources: CitedSource[] }) {
  return (
    <ul className="text-xs space-y-1">
      {sources.map((source) => (
        <li key={source.url}>
          {/^https?:\/\//i.test(source.url) ? (
            <a className="text-gold-light underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
          ) : source.title}
        </li>
      ))}
    </ul>
  );
}

export const FreeAiAnswerCard: React.FC<{ suburb: string; state: string; brandName: string }> = ({ suburb, state, brandName }) => {
  const [answer, setAnswer] = useState<FreeAnswer | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void workerFetchWithAuthRetry(`${apiBase()}/api/audit/free-answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suburb, state, brandName }),
    })
      .then(async (res) => (res.ok ? (await res.json()) as FreeAnswer : null))
      .then((body) => {
        if (live) setAnswer(body && body.hidden !== true && body.answer ? body : { hidden: true });
      })
      .catch(() => {
        if (live) setAnswer({ hidden: true });
      });
    return () => {
      live = false;
    };
  }, [suburb, state, brandName]);

  if (!answer || answer.hidden || !answer.answer || !answer.fix) return null;

  const when = answer.answeredAt
    ? new Date(answer.answeredAt).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Australia/Melbourne',
    })
    : '';

  return (
    <section className="glass-morphism rounded-xl border border-gold/30 p-4 space-y-3" aria-label={answer.label}>
      <h2 className="text-sm font-bold text-gold-light">{answer.label}</h2>
      <p className="text-xs text-gray-400">{answer.question}</p>
      <p className="text-sm text-white whitespace-pre-wrap">{answer.answer}</p>
      <p className="text-xs text-gray-300">
        Agencies named: {answer.agencies && answer.agencies.length > 0 ? answer.agencies.join(', ') : 'none in the sources'}
      </p>
      <p className="text-xs text-gray-300">
        {answer.userNamed ? 'Your agency is named in this answer.' : 'Your agency is not named in this answer.'}
      </p>
      {answer.sources && answer.sources.length > 0 ? <CitedSourceList sources={answer.sources} /> : null}
      {when ? <p className="text-[11px] text-gray-500">Answered {when}</p> : null}
      <div>
        <p className="text-xs font-bold text-white mb-1">Paste-ready fix</p>
        <p className="text-[11px] text-gray-400 mb-2">Add this to the page for {suburb}. areaServed is the suburb.</p>
        <pre className="text-[11px] text-gray-200 bg-black/50 rounded-lg p-3 overflow-x-auto">{answer.fix}</pre>
        <button
          type="button"
          className="mt-2 px-3 py-1.5 rounded-lg border border-gold/40 text-xs text-gold-light focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          onClick={() => {
            void navigator.clipboard.writeText(answer.fix || '').then(() => setCopied(true)).catch(() => setCopied(false));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </section>
  );
};
