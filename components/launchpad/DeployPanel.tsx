import React, { useEffect, useState } from 'react';
import { launchpadClient, type LaunchpadCampaign, type LaunchpadMilestone } from '../../services/launchpad/launchpadClient';
import { LAUNCHPAD_CHAINS } from '../../services/launchpad/contracts';

const inputCls = 'w-full bg-surface border border-rule rounded-lg px-3 py-2 text-sm text-ink focus:border-gold outline-none';
const labelCls = 'block text-[10px] font-mono text-ink-2 mb-1';
const primaryBtn = 'px-3 py-1.5 bg-gold hover:bg-gold-light text-surface font-mono text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const ghostBtn = 'px-3 py-1.5 border border-rule hover:border-gold text-ink-2 hover:text-ink font-mono text-xs rounded-lg transition-colors disabled:opacity-50';

interface Props {
  campaign: LaunchpadCampaign;
  /** Factory for this campaign's chain/network, or null if none is deployed. */
  factoryAddress: string | null;
  onRegistered: () => void;
  onCancel: () => void;
}

/**
 * Deploy the campaign contract from the merchant's own wallet through the Luminara factory,
 * then register it. The Worker re-verifies the deployment on-chain before listing.
 */
export const DeployPanel: React.FC<Props> = ({ campaign, factoryAddress, onRegistered, onCancel }) => {
  const isPreorder = campaign.campaign_type === 'milestone_preorder';
  const symbol = LAUNCHPAD_CHAINS[campaign.chain][campaign.network].nativeSymbol;
  const [milestones, setMilestones] = useState<LaunchpadMilestone[]>([]);
  const [softCap, setSoftCap] = useState('');
  const [hardCap, setHardCap] = useState('');
  const [fundingDays, setFundingDays] = useState(14);
  const [deliveryDays, setDeliveryDays] = useState(60);
  const [challengeDays, setChallengeDays] = useState(7);
  const [initialSupply, setInitialSupply] = useState(0);
  const [maxSupply, setMaxSupply] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<{ txHash: string; contractAddress: string } | null>(null);

  useEffect(() => {
    if (!isPreorder) return;
    void launchpadClient.detail(campaign.id).then((r) => { if (r.ok) setMilestones(r.milestones); });
  }, [campaign.id, isPreorder]);

  async function register(d: { txHash: string; contractAddress: string }) {
    const r = await launchpadClient.registerContract(campaign.id, d.contractAddress, d.txHash);
    if (r.ok) onRegistered();
    else setError(`Deployed, but registration failed: ${r.error}`);
  }

  async function handleDeploy() {
    setBusy(true); setError(null);
    const w = await import('../../services/launchpad/wallet');
    try {
      await w.connectWallet();
      const common = { chain: campaign.chain, network: campaign.network, factoryAddress } as const;
      const result = isPreorder
        ? await w.deployEscrow({
            ...common, softCapNative: softCap, hardCapNative: hardCap, fundingDays, deliveryDays, challengeDays,
            milestonePercentages: milestones.map((m) => m.payout_percentage),
          })
        : await w.deployLoyaltyToken({
            ...common, name: campaign.token_name || campaign.title.slice(0, 40),
            symbol: campaign.token_symbol || 'VCHR', initialSupply, maxSupply,
          });
      setDeployed(result);
      await register(result);
    } catch (err) {
      setError(w.describeWalletError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!factoryAddress) {
    return <p className="text-[11px] font-mono text-ink-2">Deployment opens once the audited Luminara factory is live on {LAUNCHPAD_CHAINS[campaign.chain][campaign.network].chainName}.</p>;
  }

  if (deployed) {
    return (
      <div className="space-y-2 text-xs font-mono">
        <p className="text-green-400">Contract deployed at {deployed.contractAddress}.</p>
        {error && <p role="alert" className="text-red-400">{error}</p>}
        <button type="button" className={primaryBtn} disabled={busy} onClick={async () => { setBusy(true); setError(null); await register(deployed); setBusy(false); }}>Retry registration</button>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-xs">
      {isPreorder ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={labelCls} htmlFor={`sc-${campaign.id}`}>Minimum goal ({symbol})</label><input id={`sc-${campaign.id}`} className={inputCls} inputMode="decimal" value={softCap} onChange={(e) => setSoftCap(e.target.value)} /></div>
            <div><label className={labelCls} htmlFor={`hc-${campaign.id}`}>Maximum goal ({symbol})</label><input id={`hc-${campaign.id}`} className={inputCls} inputMode="decimal" value={hardCap} onChange={(e) => setHardCap(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={labelCls} htmlFor={`fd-${campaign.id}`}>Funding days</label><input id={`fd-${campaign.id}`} type="number" min={1} max={90} className={inputCls} value={fundingDays} onChange={(e) => setFundingDays(Math.trunc(Number(e.target.value)))} /></div>
            <div><label className={labelCls} htmlFor={`dd-${campaign.id}`}>Deliver within (days)</label><input id={`dd-${campaign.id}`} type="number" min={2} max={730} className={inputCls} value={deliveryDays} onChange={(e) => setDeliveryDays(Math.trunc(Number(e.target.value)))} /></div>
            <div><label className={labelCls} htmlFor={`cd-${campaign.id}`}>Objection window (days)</label><input id={`cd-${campaign.id}`} type="number" min={1} max={30} className={inputCls} value={challengeDays} onChange={(e) => setChallengeDays(Math.trunc(Number(e.target.value)))} /></div>
          </div>
          <p className="text-[10px] text-ink-2">Milestone shares come from your saved draft: {milestones.map((m) => `${m.payout_percentage}%`).join(' / ') || 'loading...'}. Backers can object during the window after each milestone proof. The platform fee is set by the factory and shown in your wallet.</p>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls} htmlFor={`is-${campaign.id}`}>Initial supply (to you)</label><input id={`is-${campaign.id}`} type="number" min={0} className={inputCls} value={initialSupply} onChange={(e) => setInitialSupply(Math.trunc(Number(e.target.value)))} /></div>
          <div><label className={labelCls} htmlFor={`ms-${campaign.id}`}>Maximum supply</label><input id={`ms-${campaign.id}`} type="number" min={1} className={inputCls} value={maxSupply} onChange={(e) => setMaxSupply(Math.trunc(Number(e.target.value)))} /></div>
        </div>
      )}
      {error && <p role="alert" className="font-mono text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={primaryBtn} disabled={busy || (isPreorder && (!softCap || !hardCap || milestones.length === 0))} onClick={handleDeploy}>{busy ? 'Waiting for wallet...' : 'Deploy from my wallet'}</button>
        <button type="button" className={ghostBtn} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};
