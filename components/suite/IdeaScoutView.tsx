import React, { useEffect, useState } from 'react';
import type { IdeaScoutCard } from '../../services/ideaScout/rules';
import {
  continuumAuditStartParam,
  parseIdeaScoutRequest,
  validateIdeaScoutCard,
} from '../../services/ideaScout/rules';
import { createIdeaScout, fetchIdeaScout, linkIdeaScout } from '../../services/ideaScout/ideaScoutClient';

interface IdeaScoutViewProps {
  launchIdeaId?: string;
  onRunAudit: (hostname: string, ideaId?: string) => void;
}

const PERCENT_RE = /\d+(?:\.\d+)?\s*%/;

function StatusLine({ status }: { status: string }) {
  const label = status === 'fetched'
    ? 'Fetched from the public page. Title and headings only. Not a ranking.'
    : 'Not measured.';
  return <p className="text-[10px] uppercase tracking-wider text-gold-light">{label}</p>;
}

export const IdeaScoutView: React.FC<IdeaScoutViewProps> = ({ launchIdeaId, onRunAudit }) => {
  const [idea, setIdea] = useState('');
  const [niche, setNiche] = useState('');
  const [urls, setUrls] = useState(['', '', '']);
  const [pulseOptIn, setPulseOptIn] = useState(false);
  const [cardId, setCardId] = useState<string | undefined>(launchIdeaId);
  const [card, setCard] = useState<IdeaScoutCard | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);

  useEffect(() => {
    if (!launchIdeaId) return;
    let cancelled = false;
    setLoading(true);
    void fetchIdeaScout(launchIdeaId).then((loaded) => {
      if (cancelled) return;
      setLoading(false);
      if (!loaded.ok) {
        setError(loaded.error);
        return;
      }
      const verdict = validateIdeaScoutCard(loaded.card);
      if (!verdict.ok || PERCENT_RE.test(JSON.stringify(loaded.card))) {
        setError('Stored card failed honesty checks.');
        return;
      }
      setCard(verdict.card);
      setCardId(loaded.id);
      if (loaded.niche) setNiche(loaded.niche);
    });
    return () => { cancelled = true; };
  }, [launchIdeaId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsed = parseIdeaScoutRequest({
      idea,
      niche: niche.trim() || undefined,
      competitorUrls: urls,
      pulseOptIn,
    });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setLoading(true);
    const created = await createIdeaScout({
      idea: parsed.idea,
      niche: parsed.niche || undefined,
      competitorUrls: parsed.competitorUrls,
      pulseOptIn: parsed.pulseOptIn,
    });
    setLoading(false);
    if (!created.ok) {
      setError(created.status === 401
        ? 'Sign in with Telegram or your web account. Anonymous browsers do not use hosted keys.'
        : created.error);
      return;
    }
    const verdict = validateIdeaScoutCard(created.result.card);
    if (!verdict.ok || PERCENT_RE.test(JSON.stringify(created.result.card))) {
      setError('The card included a percentage and was discarded.');
      return;
    }
    setCard(verdict.card);
    setCardId(created.result.id);
    setRemaining(created.result.ideaCardsRemaining);
  };

  const handoff = async () => {
    setDomainError(null);
    const startParam = continuumAuditStartParam(domain);
    if (!startParam) {
      setDomainError('Use a public site hostname. Local and private hosts are rejected.');
      return;
    }
    const host = startParam.slice('audit_'.length);
    if (cardId) {
      await linkIdeaScout({ id: cardId, domain: host, measurementStatus: 'not_measured', evidencePresent: false });
    }
    onRunAudit(host, cardId);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 animate-in fade-in duration-700">
      <div className="mb-8 border-b border-white/10 pb-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold mb-3">Idea Scout</p>
        <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">No domain yet</h1>
        <p className="text-sm text-gray-400 mt-2 max-w-2xl leading-relaxed">
          Describe the idea. The card is a hypothesis, not a measured ranking. Free accounts get 2 hosted cards per UTC day.
          Anonymous browsers do not use hosted keys.
        </p>
      </div>

      <form onSubmit={(event) => { void submit(event); }} className="glass-morphism rounded-2xl border border-white/10 p-6 bg-black/50 space-y-4 mb-8">
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Idea</span>
          <textarea
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            required
            minLength={8}
            maxLength={500}
            rows={4}
            placeholder="A clinic booking tool that answers after-hours questions."
            className="mt-2 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-gold"
          />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Niche (optional)</span>
          <input
            value={niche}
            onChange={(event) => setNiche(event.target.value)}
            maxLength={80}
            placeholder="dental clinics"
            className="mt-2 w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-gold"
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Competitor URLs (optional, up to 3)</legend>
          {urls.map((value, index) => (
            <input
              key={index}
              value={value}
              onChange={(event) => {
                const next = [...urls];
                next[index] = event.target.value;
                setUrls(next);
              }}
              inputMode="url"
              placeholder="https://example.com"
              aria-label={`Competitor URL ${index + 1}`}
              className="w-full rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-gold"
            />
          ))}
        </fieldset>
        <label className="flex items-start gap-3 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={pulseOptIn}
            onChange={(event) => setPulseOptIn(event.target.checked)}
            className="mt-1"
          />
          <span>Store a Niche Pulse reminder for this niche. The bot sends it when you ask /pulse. It does not send on a schedule.</span>
        </label>
        {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-gold to-gold-dark text-black text-[11px] font-black uppercase tracking-wider disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
        >
          {loading ? 'Building card' : 'Build idea card'}
        </button>
        {remaining != null && (
          <p className="text-[11px] text-gray-400">{remaining} free hosted card{remaining === 1 ? '' : 's'} left today.</p>
        )}
      </form>

      {card && (
        <article className="space-y-4" aria-label="Idea Scout card">
          <section className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/40">
            <h2 className="text-sm font-bold text-white mb-2">Problem</h2>
            <p className="text-sm text-gray-300 leading-relaxed">{card.problem}</p>
          </section>
          <section className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/40">
            <h2 className="text-sm font-bold text-white mb-1">Who might ask an assistant</h2>
            <p className="text-[10px] uppercase tracking-wider text-gold-light">Model inference, not a measurement.</p>
            <p className="text-sm text-gray-300 mt-2">{card.whoAsksAi.persona}</p>
            <ul className="mt-2 space-y-1 text-sm text-gray-400">
              {card.whoAsksAi.promptPatterns.map((pattern) => <li key={pattern}>{pattern}</li>)}
            </ul>
          </section>
          <section className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/40">
            <h2 className="text-sm font-bold text-white mb-1">Competitor pages</h2>
            <StatusLine status={card.competitorCitation.status} />
            {card.competitorCitation.snapshots.length === 0 && (
              <p className="text-sm text-gray-400 mt-2">No competitor URL was fetched.</p>
            )}
            <ul className="mt-3 space-y-3">
              {card.competitorCitation.snapshots.map((row) => (
                <li key={row.url} className="text-sm text-gray-300">
                  <p className="font-bold text-white">{row.hostname}</p>
                  <p>{row.fetchStatus === 'fetched' ? (row.title || 'Title not measured') : 'Not measured.'}</p>
                  {row.headings.length > 0 && (
                    <p className="text-gray-400">{row.headings.join(' / ')}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/40">
            <h2 className="text-sm font-bold text-white mb-2">Content bets</h2>
            <ol className="space-y-2 text-sm text-gray-300 list-decimal pl-4">
              {card.contentBets.map((bet) => (
                <li key={bet.hypothesis}>
                  <span className="text-[10px] uppercase tracking-wider text-gold-light">Hypothesis. </span>
                  {bet.hypothesis}
                </li>
              ))}
            </ol>
          </section>
          <section className="glass-morphism rounded-2xl border border-white/10 p-5 bg-black/40">
            <h2 className="text-sm font-bold text-white mb-2">Site checklist</h2>
            <ul className="space-y-2 text-sm text-gray-300">
              {card.siteChecklist.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3">
                  <span>{item.label}</span>
                  <span className="text-[10px] uppercase tracking-wider text-gray-400 shrink-0">Not measured</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="glass-morphism rounded-2xl border border-gold/40 p-5 bg-black/50">
            <h2 className="text-sm font-bold text-white mb-2">I have a domain</h2>
            <p className="text-xs text-gray-400 mb-3">This opens Instant Audit for that public hostname. It does not invent a score.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                placeholder="stripe.com"
                aria-label="Domain for Instant Audit"
                className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-gold"
              />
              <button
                type="button"
                onClick={() => { void handoff(); }}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-gold to-gold-dark text-black text-[11px] font-black uppercase tracking-wider focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                Run Instant Audit
              </button>
            </div>
            {domainError && <p className="text-sm text-red-300 mt-2" role="alert">{domainError}</p>}
          </section>
        </article>
      )}
    </div>
  );
};
