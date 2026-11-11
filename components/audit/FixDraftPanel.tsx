import React, { useState } from 'react';
import { apiBase, workerFetchWithAuthRetry } from '../../services/apiClient';
import { isFixDraftKind, type FixDraftKind } from '../../services/audit/fixDraft';

const KINDS: Array<{ id: FixDraftKind; label: string }> = [
  { id: 'suburb_page', label: 'Suburb page' },
  { id: 'agent_bio', label: 'Agent bio' },
  { id: 'about_page', label: 'About page' },
  { id: 'faq_block', label: 'FAQ block' },
  { id: 'json_ld', label: 'RealEstateAgent JSON-LD' },
];

type Fields = {
  kind: FixDraftKind;
  businessName: string;
  agentName: string;
  suburb: string;
  phone: string;
  address: string;
  serviceArea: string;
  findingTitle: string;
  domain: string;
};

export async function submitFixDraft(
  request: (url: string, init: RequestInit) => Promise<Response>,
  base: string,
  fields: Fields,
): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  const res = await request(`${base}/api/fix-drafts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; draft?: { markdown?: string } };
  if (!res.ok || !data.ok || !data.draft?.markdown) {
    return { ok: false, error: data.error || 'The draft was not created.' };
  }
  return { ok: true, markdown: data.draft.markdown };
}

type Props = {
  domain?: string;
  businessName?: string;
  suburb?: string;
  serviceArea?: string;
  findingTitle?: string;
};

/** Paste-ready draft. It spends one Ask and does not publish. */
export const FixDraftPanel: React.FC<Props> = ({ domain, businessName, suburb, serviceArea, findingTitle }) => {
  const [kind, setKind] = useState<FixDraftKind>('suburb_page');
  const [agency, setAgency] = useState(businessName || '');
  const [agent, setAgent] = useState('');
  const [place, setPlace] = useState(suburb || '');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState(serviceArea || '');
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const base = apiBase();
    if (!base) {
      setNote('Sign in to draft a fix. Drafts use one Ask.');
      return;
    }
    setBusy(true);
    setNote(null);
    void submitFixDraft(workerFetchWithAuthRetry, base, {
      kind,
      businessName: agency,
      agentName: agent,
      suburb: place,
      phone,
      address,
      serviceArea: area,
      findingTitle: findingTitle || '',
      domain: domain || '',
    }).then((result) => {
      if (!result.ok) setNote(result.error);
      else {
        setDraft(result.markdown);
        setNote('Draft only. Nothing was published.');
      }
      setBusy(false);
    });
  };

  return (
    <form onSubmit={onSubmit} className="mb-4 rounded-xl border border-white/10 p-4">
      <h2 className="text-xs font-bold uppercase tracking-wider text-gold-light">Draft a fix</h2>
      <p className="mt-1 text-sm text-gray-300">
        Paste-ready copy for an agency page. This uses one Ask. It does not publish to your site.
      </p>
      <label className="mt-3 block text-xs" htmlFor="fix-draft-kind">Page</label>
      <select
        id="fix-draft-kind"
        value={kind}
        onChange={(event) => {
          if (isFixDraftKind(event.target.value)) setKind(event.target.value);
        }}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white"
      >
        {KINDS.map((item) => (
          <option key={item.id} value={item.id}>{item.label}</option>
        ))}
      </select>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Field id="fix-draft-agency" label="Agency name" value={agency} onChange={setAgency} />
        <Field id="fix-draft-agent" label="Agent name" value={agent} onChange={setAgent} />
        <Field id="fix-draft-suburb" label="Suburb" value={place} onChange={setPlace} />
        <Field id="fix-draft-phone" label="Phone" value={phone} onChange={setPhone} />
        <Field id="fix-draft-address" label="Address" value={address} onChange={setAddress} />
        <Field id="fix-draft-area" label="Service area" value={area} onChange={setArea} />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="mt-3 rounded-lg bg-gold px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
      >
        {busy ? 'Writing the draft' : 'Write the draft'}
      </button>
      {note ? <p role="status" className="mt-2 text-sm text-gray-300">{note}</p> : null}
      {draft ? (
        <textarea
          readOnly
          value={draft}
          aria-label="Draft"
          className="mt-3 h-48 w-full rounded-lg border border-white/10 bg-black p-3 text-sm text-white"
        />
      ) : null}
    </form>
  );
};

function Field({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs" htmlFor={id}>
      {label}
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-white"
      />
    </label>
  );
}
