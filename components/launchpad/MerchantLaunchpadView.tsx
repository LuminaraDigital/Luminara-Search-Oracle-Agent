import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LAUNCHPAD_DISCLAIMER,
  LAUNCHPAD_LIMITS,
  scanCampaignCompliance,
  type CampaignType,
  type ComplianceScanResult,
} from '../../services/launchpad/compliance';
import {
  LAUNCHPAD_CHAINS,
  explorerAddressUrl,
  type LaunchpadChain,
} from '../../services/launchpad/contracts';
import {
  launchpadClient,
  type LaunchpadCampaign,
  type LaunchpadConfig,
  type LaunchpadVoucher,
} from '../../services/launchpad/launchpadClient';
import { DeployPanel } from './DeployPanel';
import { EscrowPanel } from './EscrowPanel';

interface MerchantLaunchpadViewProps {
  onRunAudit?: (hostname: string) => void;
}

type Tab = 'explore' | 'create' | 'mine' | 'redeem';

const inputCls = 'w-full bg-surface border border-rule rounded-lg px-3 py-2 text-sm text-ink focus:border-gold outline-none';
const labelCls = 'block text-xs font-mono text-ink-2 mb-1';
const primaryBtn = 'px-4 py-2 bg-gold hover:bg-gold-light text-surface font-mono text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const ghostBtn = 'px-3 py-1.5 border border-rule hover:border-gold text-ink-2 hover:text-ink font-mono text-xs rounded-lg transition-colors';

function formatFiat(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return <p role="alert" className="p-3 bg-surface border border-red-500/40 rounded-lg text-red-400 text-xs font-mono">{text}</p>;
}

function CampaignCard({ c, onRunAudit, footer }: { c: LaunchpadCampaign; onRunAudit?: (h: string) => void; footer?: React.ReactNode }) {
  const chainCfg = LAUNCHPAD_CHAINS[c.chain][c.network];
  return (
    <article className="bg-surface-1 border border-rule rounded-xl p-5 flex flex-col justify-between gap-4">
      <div>
        <div className="flex items-center justify-between text-xs font-mono text-ink-2 mb-1 gap-2">
          <span className="text-gold uppercase truncate">{c.business_name}</span>
          <span className="px-2 py-0.5 rounded bg-surface border border-rule text-[10px] shrink-0">
            {c.campaign_type === 'closed_loop_loyalty' ? 'Loyalty voucher' : 'Pre-order'}
          </span>
        </div>
        <h3 className="text-base font-semibold text-ink line-clamp-2">{c.title}</h3>
        <p className="text-xs text-ink-2 mt-2 line-clamp-4">{c.description}</p>
      </div>
      <dl className="text-xs font-mono space-y-1 pt-2 border-t border-rule">
        <div className="flex justify-between"><dt className="text-ink-2">Target</dt><dd>{c.target_fiat_cents > 0 ? formatFiat(c.target_fiat_cents, c.fiat_currency) : 'None set'}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-2">Raised</dt><dd className="text-ink-2">Not measured (read on-chain)</dd></div>
        <div className="flex justify-between"><dt className="text-ink-2">Network</dt><dd>{chainCfg.chainName}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-2">Expiry</dt><dd>{c.voucher_expiry_months ? `${c.voucher_expiry_months} months` : 'No expiry'}</dd></div>
        {c.contract_address && (
          <div className="flex justify-between gap-2">
            <dt className="text-ink-2">Contract</dt>
            <dd className="truncate">
              <a className="text-gold-light hover:underline" href={explorerAddressUrl(c.chain, c.network, c.contract_address)} target="_blank" rel="noopener noreferrer">
                {c.contract_address.slice(0, 8)}...{c.contract_address.slice(-6)}
              </a>
            </dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {c.domain && onRunAudit && (
          <button type="button" className={ghostBtn} onClick={() => onRunAudit(c.domain!)}>Audit {c.domain}</button>
        )}
        {footer}
      </div>
    </article>
  );
}

export const MerchantLaunchpadView: React.FC<MerchantLaunchpadViewProps> = ({ onRunAudit }) => {
  const [tab, setTab] = useState<Tab>('explore');

  // Explore + mine
  const [publicCampaigns, setPublicCampaigns] = useState<LaunchpadCampaign[] | null>(null);
  const [myCampaigns, setMyCampaigns] = useState<LaunchpadCampaign[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const loadPublic = useCallback(async () => {
    setListError(null);
    const r = await launchpadClient.listPublic();
    if (r.ok) setPublicCampaigns(r.campaigns);
    else { setPublicCampaigns([]); setListError(r.error); }
  }, []);

  const loadMine = useCallback(async () => {
    setListError(null);
    const r = await launchpadClient.listMine();
    if (r.ok) setMyCampaigns(r.campaigns);
    else { setMyCampaigns([]); setListError(r.status === 401 ? 'Sign in to see your campaigns.' : r.error); }
  }, []);

  useEffect(() => { void loadPublic(); }, [loadPublic]);
  useEffect(() => { if (tab === 'mine') void loadMine(); }, [tab, loadMine]);

  // Create form
  const [bizName, setBizName] = useState('');
  const [abnNzbn, setAbnNzbn] = useState('');
  const [domain, setDomain] = useState('');
  const [country, setCountry] = useState<'AU' | 'NZ'>('AU');
  const [campaignType, setCampaignType] = useState<CampaignType>('closed_loop_loyalty');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetFiat, setTargetFiat] = useState('5000');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [chain, setChain] = useState<LaunchpadChain>('xdc');
  const [expiry, setExpiry] = useState<'none' | '36' | '60'>('36');
  const [milestones, setMilestones] = useState([
    { title: 'Ingredients and stock purchased', payoutPercentage: 50 },
    { title: 'Orders delivered to customers', payoutPercentage: 50 },
  ]);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const compliance: ComplianceScanResult | null = useMemo(() => {
    if (!bizName && !title && !description) return null;
    return scanCampaignCompliance({
      businessName: bizName,
      title,
      description,
      campaignType,
      milestones: campaignType === 'milestone_preorder' ? milestones : undefined,
    });
  }, [bizName, title, description, campaignType, milestones]);

  const milestoneTotal = milestones.reduce((a, m) => a + (Number.isFinite(m.payoutPercentage) ? m.payoutPercentage : 0), 0);
  const targetCents = Math.round(Number(targetFiat) * 100);
  const targetValid = Number.isFinite(targetCents) && targetCents >= 0 && targetCents <= LAUNCHPAD_LIMITS.targetFiatCentsMax;
  const canSubmit = Boolean(compliance?.approved) && termsAccepted && targetValid && !creating;

  async function handleCreate() {
    if (!canSubmit) return;
    setCreating(true);
    setCreateError(null);
    const r = await launchpadClient.create({
      businessName: bizName,
      abnNzbn: abnNzbn || undefined,
      domain: domain || undefined,
      country,
      campaignType,
      title,
      description,
      chain,
      network: 'testnet',
      tokenSymbol: tokenSymbol || undefined,
      targetFiatCents: targetCents,
      fiatCurrency: country === 'NZ' ? 'NZD' : 'AUD',
      voucherExpiryMonths: expiry === 'none' ? undefined : Number(expiry),
      milestones: campaignType === 'milestone_preorder' ? milestones : undefined,
      termsAccepted: true,
    });
    setCreating(false);
    if (r.ok) setCreatedId(r.campaignId);
    else setCreateError(r.status === 401 ? 'Sign in to save a campaign.' : r.error);
  }

  const [registerFor, setRegisterFor] = useState<string | null>(null);
  const [config, setConfig] = useState<LaunchpadConfig | null>(null);
  const [issueFor, setIssueFor] = useState<string | null>(null);
  const [itemDesc, setItemDesc] = useState('');
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const [mineBusy, setMineBusy] = useState(false);

  useEffect(() => {
    void launchpadClient.config().then((r) => {
      if (r.ok) setConfig(r);
    });
  }, []);

  async function handleIssue(id: string) {
    setMineBusy(true); setMineError(null); setIssuedCode(null);
    const r = await launchpadClient.issueVoucher(id, itemDesc);
    setMineBusy(false);
    if (r.ok) { setIssuedCode(r.voucherCode); setItemDesc(''); }
    else setMineError(r.error);
  }

  // Redeem
  const [code, setCode] = useState('');
  const [voucher, setVoucher] = useState<LaunchpadVoucher | null>(null);
  const [redeemMsg, setRedeemMsg] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemBusy, setRedeemBusy] = useState(false);

  async function handleLookup() {
    setRedeemBusy(true); setRedeemError(null); setRedeemMsg(null); setVoucher(null);
    const r = await launchpadClient.lookupVoucher(code.trim());
    setRedeemBusy(false);
    if (r.ok) setVoucher(r.voucher);
    else setRedeemError(r.status === 401 ? 'Sign in as the issuing business to check vouchers.' : r.error);
  }

  async function handleRedeem() {
    if (!voucher) return;
    setRedeemBusy(true); setRedeemError(null);
    const r = await launchpadClient.redeemVoucher(voucher.voucher_code);
    setRedeemBusy(false);
    if (r.ok) { setRedeemMsg('Voucher redeemed.'); setVoucher({ ...voucher, status: 'redeemed', redeemed_at: r.redeemedAt }); }
    else setRedeemError(r.error);
  }

  const tabs: Array<[Tab, string]> = [['explore', 'Explore'], ['create', 'Create campaign'], ['mine', 'My campaigns'], ['redeem', 'Redeem at counter']];
  const factoryReady = (config?.factories?.[chain]?.testnet ?? LAUNCHPAD_CHAINS[chain].testnet.factoryAddress) !== null;

  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-6 space-y-6 text-ink">
      <header className="bg-surface-1 border border-rule rounded-xl p-6">
        <span className="inline-flex px-2.5 py-0.5 rounded-full bg-surface text-warning-300 border border-rule text-[10px] font-mono mb-2">TESTNET PREVIEW</span>
        <h1 className="text-2xl md:text-3xl font-display text-gold-light">SMB Launchpad</h1>
        <p className="text-ink-2 text-sm max-w-2xl mt-1">
          Loyalty vouchers and milestone pre-orders for Australian and New Zealand small businesses. Contracts deploy from
          your own wallet. Luminara never holds your funds.
        </p>
        <nav className="flex flex-wrap border-b border-rule mt-6 gap-x-6 text-sm" aria-label="Launchpad sections">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
              className={`pb-3 font-mono transition-colors ${tab === id ? 'border-b-2 border-gold text-gold-light font-semibold' : 'text-ink-2 hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'explore' && (
        <section className="space-y-4">
          <ErrorLine text={listError} />
          {publicCampaigns === null ? (
            <p className="p-8 text-center text-ink-2 font-mono text-sm">Loading campaigns...</p>
          ) : publicCampaigns.length === 0 ? (
            <p className="p-8 text-center bg-surface-1 border border-rule rounded-xl text-ink-2 font-mono text-sm">
              No live campaigns yet. Campaigns appear here after the business deploys its contract.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {publicCampaigns.map((c) => (
                <CampaignCard key={c.id} c={c} onRunAudit={onRunAudit}
                  footer={c.campaign_type === 'milestone_preorder' ? <EscrowPanel campaign={c} /> : undefined} />
              ))}
            </div>
          )}
          <p className="text-[11px] text-ink-2 max-w-3xl">{LAUNCHPAD_DISCLAIMER}</p>
        </section>
      )}

      {tab === 'create' && (
        <section className="bg-surface-1 border border-rule rounded-xl p-6 space-y-6">
          {createdId ? (
            <div className="p-6 bg-surface border border-gold rounded-xl space-y-3">
              <h2 className="text-lg font-display text-gold-light">Draft saved</h2>
              <p className="text-xs text-ink-2">Campaign <span className="font-mono text-gold">{createdId}</span> is saved but not public.</p>
              <ol className="text-xs text-ink-2 list-decimal pl-5 space-y-1">
                <li>Deploy your contract from your own wallet{factoryReady ? '.' : ' (the audited factory is not deployed on this network yet, so this step is not open).'}</li>
                <li>Open My campaigns and register the contract address. The campaign then goes live.</li>
              </ol>
              <div className="flex gap-3 pt-2">
                <button type="button" className={primaryBtn} onClick={() => { setCreatedId(null); setTab('mine'); }}>My campaigns</button>
                {domain && onRunAudit && <button type="button" className={ghostBtn} onClick={() => onRunAudit(domain)}>Audit {domain}</button>}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-4">
                <div>
                  <label className={labelCls} htmlFor="lp-biz">Business name</label>
                  <input id="lp-biz" className={inputCls} maxLength={LAUNCHPAD_LIMITS.businessNameMax} value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="Fitzroy Specialty Roasters" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} htmlFor="lp-country">Country</label>
                    <select id="lp-country" className={inputCls} value={country} onChange={(e) => setCountry(e.target.value as 'AU' | 'NZ')}>
                      <option value="AU">Australia (AUD)</option>
                      <option value="NZ">New Zealand (NZD)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="lp-abn">ABN or NZBN (optional)</label>
                    <input id="lp-abn" className={inputCls} value={abnNzbn} onChange={(e) => setAbnNzbn(e.target.value)} placeholder="51 824 753 556" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} htmlFor="lp-domain">Website (optional)</label>
                    <input id="lp-domain" className={inputCls} value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} placeholder="example.com.au" />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="lp-type">Campaign type</label>
                    <select id="lp-type" className={inputCls} value={campaignType} onChange={(e) => setCampaignType(e.target.value as CampaignType)}>
                      <option value="closed_loop_loyalty">Loyalty voucher</option>
                      <option value="milestone_preorder">Milestone pre-order</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls} htmlFor="lp-title">Campaign title</label>
                  <input id="lp-title" className={inputCls} maxLength={LAUNCHPAD_LIMITS.titleMax} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reserve blend pre-order vouchers" />
                </div>
                <div>
                  <label className={labelCls} htmlFor="lp-desc">What customers get and how they redeem it</label>
                  <textarea id="lp-desc" rows={4} className={inputCls} maxLength={LAUNCHPAD_LIMITS.descriptionMax} value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder="Each voucher is redeemable for one 1kg bag of coffee, collected in store or delivered." />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls} htmlFor="lp-target">Target ({country === 'NZ' ? 'NZD' : 'AUD'})</label>
                    <input id="lp-target" type="number" min={0} className={inputCls} value={targetFiat} onChange={(e) => setTargetFiat(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="lp-symbol">Token symbol</label>
                    <input id="lp-symbol" className={`${inputCls} font-mono`} maxLength={8} value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ROAST" />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="lp-expiry">Voucher expiry</label>
                    <select id="lp-expiry" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value as typeof expiry)}>
                      <option value="36">3 years</option>
                      <option value="60">5 years</option>
                      <option value="none">No expiry</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={labelCls} htmlFor="lp-chain">Network (testnet while contracts are in audit)</label>
                  <select id="lp-chain" className={inputCls} value={chain} onChange={(e) => setChain(e.target.value as LaunchpadChain)}>
                    <option value="xdc">{LAUNCHPAD_CHAINS.xdc.testnet.chainName}</option>
                    <option value="polygon">{LAUNCHPAD_CHAINS.polygon.testnet.chainName}</option>
                  </select>
                </div>
                {campaignType === 'milestone_preorder' && (
                  <fieldset className="border border-rule rounded-lg p-3 bg-surface space-y-2">
                    <legend className="text-xs font-mono text-gold-light px-1">Delivery milestones (total {milestoneTotal}%)</legend>
                    {milestones.map((m, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-ink-2 w-4">{idx + 1}.</span>
                        <input aria-label={`Milestone ${idx + 1} title`} className="flex-1 bg-surface-1 border border-rule px-2 py-1 rounded text-ink" value={m.title}
                          onChange={(e) => setMilestones(milestones.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))} />
                        <input aria-label={`Milestone ${idx + 1} payout percent`} type="number" min={1} max={100} className="w-16 bg-surface-1 border border-rule px-2 py-1 rounded text-ink" value={m.payoutPercentage}
                          onChange={(e) => setMilestones(milestones.map((x, i) => (i === idx ? { ...x, payoutPercentage: Math.trunc(Number(e.target.value)) } : x)))} />
                        <span>%</span>
                        {milestones.length > 1 && (
                          <button type="button" aria-label={`Remove milestone ${idx + 1}`} className="text-ink-2 hover:text-red-400" onClick={() => setMilestones(milestones.filter((_, i) => i !== idx))}>x</button>
                        )}
                      </div>
                    ))}
                    {milestones.length < LAUNCHPAD_LIMITS.milestonesMax && (
                      <button type="button" className={ghostBtn} onClick={() => setMilestones([...milestones, { title: '', payoutPercentage: 0 }])}>Add milestone</button>
                    )}
                  </fieldset>
                )}
              </div>

              <div className="flex flex-col justify-between bg-surface border border-rule rounded-xl p-5 gap-4">
                <div className="space-y-3" aria-live="polite">
                  <p className="text-xs font-mono text-ink-2 uppercase tracking-wider">Copy check (rule-based, not legal advice)</p>
                  {compliance ? (
                    <>
                      <p className={`p-3 rounded-lg border text-xs font-mono ${compliance.approved ? 'border-green-500/40 text-green-400' : 'border-red-500/40 text-red-400'}`}>
                        {compliance.approved ? 'Passes the copy check' : compliance.status === 'rejected' ? 'Investment language found' : 'Needs more detail'}
                      </p>
                      {compliance.flaggedTerms.length > 0 && (
                        <ul className="p-3 border border-red-500/30 rounded-lg text-xs text-red-300 font-mono list-disc pl-6">
                          {compliance.flaggedTerms.map((t) => <li key={t}>{t}</li>)}
                        </ul>
                      )}
                      {(compliance.reasons.length > 0 || compliance.suggestedEdits.length > 0) && (
                        <ul className="p-3 bg-surface-1 border border-rule rounded-lg text-xs text-ink-2 list-disc pl-6 space-y-1">
                          {[...compliance.reasons, ...compliance.suggestedEdits].map((r) => <li key={r}>{r}</li>)}
                        </ul>
                      )}
                    </>
                  ) : (
                    <p className="text-xs font-mono text-ink-2 p-6 text-center border border-dashed border-rule rounded-lg">
                      Fill in the form. Copy that promises returns, dividends, yield or price rises is blocked.
                    </p>
                  )}
                  <p className="text-[11px] text-ink-2">{LAUNCHPAD_DISCLAIMER}</p>
                </div>
                <div className="space-y-3 pt-4 border-t border-rule">
                  <ErrorLine text={createError} />
                  {!targetValid && <ErrorLine text="Target must be between 0 and 1,000,000." />}
                  <label className="flex items-start gap-2 cursor-pointer text-xs text-ink-2">
                    <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="mt-0.5" />
                    <span>
                      These vouchers are only for my business's goods or services. They are not transferable between customers,
                      cannot be cashed out, and I will not market them as an investment. I have read the <a href="/terms" className="text-gold-light underline" target="_blank" rel="noopener noreferrer">terms</a>.
                    </span>
                  </label>
                  <button type="button" disabled={!canSubmit} onClick={handleCreate} className={`w-full py-2.5 ${primaryBtn}`}>
                    {creating ? 'Saving...' : 'Save campaign draft'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'mine' && (
        <section className="space-y-4">
          <ErrorLine text={listError} />
          <ErrorLine text={mineError} />
          {issuedCode && (
            <p className="p-3 border border-gold rounded-lg text-xs font-mono">
              Voucher issued: <span className="text-gold-light text-sm select-all">{issuedCode}</span>. Give this code to the customer.
            </p>
          )}
          {myCampaigns === null ? (
            <p className="p-8 text-center text-ink-2 font-mono text-sm">Loading...</p>
          ) : myCampaigns.length === 0 ? (
            <p className="p-8 text-center bg-surface-1 border border-rule rounded-xl text-ink-2 font-mono text-sm">No campaigns yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {myCampaigns.map((c) => (
                <CampaignCard key={c.id} c={c} onRunAudit={onRunAudit} footer={
                  <div className="w-full space-y-2">
                    <p className="text-[11px] font-mono text-ink-2">Status: {c.listed_at ? 'Live' : 'Draft (register a contract to go live)'}</p>
                    {!c.listed_at && (registerFor === c.id ? (
                      <DeployPanel
                        campaign={c}
                        factoryAddress={config?.factories[c.chain][c.network] ?? null}
                        onRegistered={() => { setRegisterFor(null); void loadMine(); void loadPublic(); }}
                        onCancel={() => setRegisterFor(null)}
                      />
                    ) : (
                      <button type="button" className={ghostBtn} onClick={() => { setRegisterFor(c.id); setMineError(null); }}>Deploy from my wallet</button>
                    ))}
                    {c.listed_at && <EscrowPanel campaign={c} />}
                    {c.listed_at && (issueFor === c.id ? (
                      <div className="space-y-2">
                        <input className={inputCls} maxLength={200} placeholder="What the voucher is for (e.g. 1kg house blend)" value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} />
                        <div className="flex gap-2">
                          <button type="button" className={primaryBtn} disabled={mineBusy || !itemDesc.trim()} onClick={() => handleIssue(c.id)}>Issue voucher</button>
                          <button type="button" className={ghostBtn} onClick={() => setIssueFor(null)}>Close</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className={ghostBtn} onClick={() => { setIssueFor(c.id); setIssuedCode(null); setMineError(null); }}>Issue voucher</button>
                    ))}
                  </div>
                } />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'redeem' && (
        <section className="bg-surface-1 border border-rule rounded-xl p-6 space-y-5 max-w-xl mx-auto">
          <div>
            <h2 className="text-xl font-display text-gold-light">Redeem at the counter</h2>
            <p className="text-xs text-ink-2 mt-1">Sign in as the issuing business. You can only see and redeem your own vouchers.</p>
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void handleLookup(); }}>
            <label htmlFor="lp-code" className="sr-only">Voucher code</label>
            <input id="lp-code" className={`${inputCls} font-mono`} placeholder="VCH-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button type="submit" className={primaryBtn} disabled={redeemBusy || !code.trim()}>{redeemBusy ? 'Checking...' : 'Check'}</button>
          </form>
          <ErrorLine text={redeemError} />
          {redeemMsg && <p className="p-3 border border-green-500/40 rounded-lg text-green-400 text-xs font-mono">{redeemMsg}</p>}
          {voucher && (
            <dl className="bg-surface border border-rule rounded-xl p-4 space-y-2 font-mono text-xs">
              <div className="flex justify-between"><dt className="text-ink-2">Status</dt><dd className={voucher.status === 'issued' ? 'text-green-400' : 'text-red-400'}>{voucher.status}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Item</dt><dd className="text-gold-light">{voucher.item_description}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Campaign</dt><dd>{voucher.campaign_title}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Expires</dt><dd>{voucher.expires_at ? new Date(voucher.expires_at).toLocaleDateString('en-AU') : 'Never'}</dd></div>
              {voucher.status === 'issued' && (
                <button type="button" className={`w-full mt-2 py-2 ${primaryBtn}`} disabled={redeemBusy} onClick={handleRedeem}>Confirm redemption</button>
              )}
            </dl>
          )}
        </section>
      )}
    </div>
  );
};
