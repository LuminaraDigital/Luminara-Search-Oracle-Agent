import React, { useCallback, useEffect, useState } from 'react';
import { launchpadClient, type LaunchpadCampaign, type OnchainEscrow } from '../../services/launchpad/launchpadClient';
import { LAUNCHPAD_CHAINS } from '../../services/launchpad/contracts';
import { formatWei } from '../../services/launchpad/format';

const inputCls = 'w-full bg-surface border border-rule rounded-lg px-3 py-2 text-sm text-ink focus:border-gold outline-none';
const primaryBtn = 'px-3 py-1.5 bg-gold hover:bg-gold-light text-surface font-mono text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const ghostBtn = 'px-3 py-1.5 border border-rule hover:border-gold text-ink-2 hover:text-ink font-mono text-xs rounded-lg transition-colors disabled:opacity-50';


type Wallet = typeof import('../../services/launchpad/wallet');

/**
 * Live escrow numbers (read from the chain by the Worker) plus the wallet actions each role can take.
 * The app never holds funds: every action is a transaction signed in the user's own wallet.
 */
export const EscrowPanel: React.FC<{ campaign: LaunchpadCampaign }> = ({ campaign }) => {
  const [snap, setSnap] = useState<OnchainEscrow | 'not_measured' | 'not_applicable' | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [proof, setProof] = useState('');
  const [notifyTarget, setNotifyTarget] = useState('');
  const [subMsg, setSubMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const symbol = LAUNCHPAD_CHAINS[campaign.chain][campaign.network].nativeSymbol;

  const refresh = useCallback(async () => {
    const r = await launchpadClient.onchain(campaign.id);
    setSnap(r.ok ? r.onchain : 'not_measured');
  }, [campaign.id]);

  async function handleSubscribe() {
    if (!notifyTarget.trim()) return;
    setBusy(true); setSubMsg(null); setMsg(null);
    const target = notifyTarget.trim();
    const channel = target.startsWith('https://') ? 'webhook' : target.startsWith('@') ? 'telegram' : 'email';
    const r = await launchpadClient.subscribe(campaign.id, {
      subscriberRef: target,
      channel,
      walletAddress: account || undefined,
    });
    setBusy(false);
    if (r.ok) {
      setSubMsg(`Alerts enabled via ${channel}.`);
      setNotifyTarget('');
    } else {
      setMsg({ ok: false, text: r.error });
    }
  }

  useEffect(() => { void refresh(); }, [refresh]);

  async function run(fn: (w: Wallet) => Promise<unknown>, success: string) {
    setBusy(true); setMsg(null);
    const w = await import('../../services/launchpad/wallet');
    try {
      await fn(w);
      setMsg({ ok: true, text: success });
      await refresh();
    } catch (err) {
      setMsg({ ok: false, text: w.describeWalletError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true); setMsg(null);
    const w = await import('../../services/launchpad/wallet');
    try { setAccount((await w.connectWallet()).address.toLowerCase()); }
    catch (err) { setMsg({ ok: false, text: w.describeWalletError(err) }); }
    finally { setBusy(false); }
  }

  if (!campaign.contract_address) return null;
  if (snap === null) return <p className="text-[11px] font-mono text-ink-2">Reading chain...</p>;
  if (snap === 'not_applicable') return null;
  if (snap === 'not_measured') {
    return <p className="text-[11px] font-mono text-ink-2">Live figures: not measured (chain unreachable). <button type="button" className="underline" onClick={() => void refresh()}>Retry</button></p>;
  }

  const chain = campaign.chain;
  const network = campaign.network;
  const escrow = campaign.contract_address;
  const now = Math.floor(Date.now() / 1000);
  const isMerchant = account !== null && account === snap.merchant;
  const idx = snap.currentMilestone;
  const pct = snap.hardCapWei !== '0' ? Number((BigInt(snap.totalPledgedWei) * 10000n) / BigInt(snap.hardCapWei)) / 100 : 0;

  return (
    <div className="w-full space-y-2 pt-2 border-t border-rule text-xs font-mono">
      <dl className="space-y-1">
        <div className="flex justify-between"><dt className="text-ink-2">State</dt><dd>{snap.state}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-2">Pledged</dt><dd>{formatWei(snap.totalPledgedWei)} {symbol}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-2">Minimum / maximum</dt><dd>{formatWei(snap.softCapWei)} / {formatWei(snap.hardCapWei)} {symbol}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-2">Funding closes</dt><dd>{new Date(snap.fundingDeadline * 1000).toLocaleDateString('en-AU')}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-2">Delivery deadline</dt><dd>{new Date(snap.deliveryDeadline * 1000).toLocaleDateString('en-AU')}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-2">Milestone</dt><dd>{Math.min(idx + 1, snap.milestoneCount)} of {snap.milestoneCount}</dd></div>
      </dl>
      <div className="h-1.5 bg-surface rounded" aria-label={`Funded ${pct.toFixed(0)}% of maximum`}><div className="h-1.5 bg-gold rounded" style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <p className="text-[10px] text-ink-2">Pledges are in {symbol}, so their AUD/NZD value moves with the market. If the minimum is not met, or the business abandons delivery, backers can reclaim what is left in the pool.</p>

      {!account ? (
        <button type="button" className={ghostBtn} disabled={busy} onClick={connect}>Connect wallet to act</button>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-ink-2 truncate">Wallet {account}{isMerchant ? ' (merchant)' : ''}</p>

          {snap.state === 'Funding' && now < snap.fundingDeadline && !isMerchant && (
            <div className="flex gap-2">
              <input aria-label={`Pledge amount in ${symbol}`} className={inputCls} inputMode="decimal" placeholder={`Amount in ${symbol}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button type="button" className={primaryBtn} disabled={busy || !amount} onClick={() => run((w) => w.sendEscrowAction(chain, network, escrow, { kind: 'pledge', amountNative: amount }), 'Pledge confirmed.')}>Pledge</button>
            </div>
          )}
          {snap.state === 'Funding' && now >= snap.fundingDeadline && (
            <button type="button" className={ghostBtn} disabled={busy} onClick={() => run((w) => w.sendEscrowAction(chain, network, escrow, { kind: 'finalizeFunding' }), 'Funding finalised.')}>Finalise funding</button>
          )}

          {snap.state === 'Active' && isMerchant && (
            <div className="space-y-2">
              <textarea aria-label="Milestone proof (link or description)" rows={2} className={inputCls} maxLength={500} placeholder="Link or description proving this milestone is complete (backers can inspect it)" value={proof} onChange={(e) => setProof(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} disabled={busy || !proof.trim()} onClick={() => run(async (w) => w.sendEscrowAction(chain, network, escrow, { kind: 'submitProof', milestoneIndex: idx, proofUri: proof.trim(), proofHash: await w.sha256Hex(proof.trim()) }), 'Proof submitted. Backers can object during the challenge window.')}>Submit proof</button>
                <button type="button" className={ghostBtn} disabled={busy} onClick={() => run((w) => w.sendEscrowAction(chain, network, escrow, { kind: 'disburse', milestoneIndex: idx }), 'Milestone released.')}>Release milestone</button>
              </div>
            </div>
          )}
          {snap.state === 'Active' && !isMerchant && (
            <button type="button" className={ghostBtn} disabled={busy} onClick={() => run((w) => w.sendEscrowAction(chain, network, escrow, { kind: 'object', milestoneIndex: idx }), 'Objection recorded.')}>Object to current milestone</button>
          )}
          {snap.state === 'Active' && now >= snap.deliveryDeadline && (
            <button type="button" className={ghostBtn} disabled={busy} onClick={() => run((w) => w.sendEscrowAction(chain, network, escrow, { kind: 'markFailed' }), 'Campaign marked failed. Backers can now claim refunds.')}>Mark failed (deadline passed)</button>
          )}

          {snap.state === 'Failed' && !isMerchant && (
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => run((w) => w.sendEscrowAction(chain, network, escrow, { kind: 'claimRefund' }), 'Refund sent to your wallet.')}>Claim refund</button>
          )}
          {snap.state !== 'Funding' && isMerchant && (
            <button type="button" className={ghostBtn} disabled={busy} onClick={() => run((w) => w.sendEscrowAction(chain, network, escrow, { kind: 'withdraw' }), 'Funds withdrawn to your wallet.')}>Withdraw released funds</button>
          )}
        </div>
      )}
      {msg && <p role="status" className={msg.ok ? 'text-green-400' : 'text-red-400'}>{msg.text}</p>}

      <div className="pt-2 border-t border-rule space-y-1.5">
        <label htmlFor={`sub-${campaign.id}`} className="text-[10px] text-ink-2 block">
          Backer notifications: get alerted when milestone proofs are submitted
        </label>
        <div className="flex gap-2">
          <input
            id={`sub-${campaign.id}`}
            aria-label="Backer notification email, telegram handle, or webhook url"
            className={inputCls}
            placeholder="Email, @telegram, or https://webhook"
            value={notifyTarget}
            onChange={(e) => setNotifyTarget(e.target.value)}
          />
          <button
            type="button"
            className={ghostBtn}
            disabled={busy || !notifyTarget.trim()}
            onClick={() => void handleSubscribe()}
          >
            Notify me
          </button>
        </div>
        {subMsg && <p role="status" className="text-green-400 text-[10px]">{subMsg}</p>}
      </div>
    </div>
  );
};
