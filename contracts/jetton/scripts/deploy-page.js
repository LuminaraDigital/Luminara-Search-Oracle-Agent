/* The deploy page. Plain browser JavaScript, served by src/deployServer.ts. */
(() => {
  const $ = (id) => document.getElementById(id);
  // sentUntil: while a launch the wallet has sent can still arrive, the time (ms) until which it can.
  const state = { context: null, ui: null, wallet: null, prepared: null, busy: false, sentUntil: 0 };
  const ALREADY_LAUNCHED = 'This token is already launched for this wallet. Nothing more to send.';
  const SENT_NOT_ARRIVED =
    'Your wallet sent the transaction, but it is not on-chain yet. Do not send it again. Press "Check again" in a minute.';

  const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 3000];
  const UNREACHABLE =
    'Could not reach the deploy page server on this computer. Check that the terminal running it is still open, then try again.';

  /**
   * Calls the local server. Every call only reads the chain or computes a
   * request, so one that got no answer at all is simply sent again: a local
   * connection can fail for a moment without anything being wrong.
   */
  async function api(path, body) {
    const options = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined;
    let response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await fetch(path, options);
        break;
      } catch {
        // fetch only throws when no response arrived.
        if (attempt >= RETRY_DELAYS_MS.length) throw new Error(UNREACHABLE);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }

  function showError(message) {
    $('error').textContent = message || '';
  }

  function definitionList(element, rows) {
    element.replaceChildren();
    for (const [term, value, mono] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (mono) dd.className = 'mono';
      element.append(dt, dd);
    }
  }

  function renderChecks(checks) {
    const list = $('checks');
    list.replaceChildren();
    for (const check of checks) {
      const item = document.createElement('li');
      const status = document.createElement('span');
      status.className = `status ${check.status}`;
      status.textContent = check.status.toUpperCase();
      const name = document.createElement('span');
      name.textContent = check.name;
      const detail = document.createElement('span');
      detail.className = 'detail';
      detail.textContent = check.detail;
      item.append(status, name, detail);
      list.append(item);
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    updateDeployButton();
    $('recheck').disabled = busy;
    $('rehearse').disabled = busy;
  }

  function updateDeployButton() {
    const boxes = [...document.querySelectorAll('.confirm-box')];
    const confirmed = state.context.network !== 'mainnet' || boxes.every((box) => box.checked);
    const inFlight = Date.now() < state.sentUntil;
    $('deploy').disabled = state.busy || !state.prepared || state.prepared.alreadyLaunched || !confirmed || inFlight;
  }

  function renderContext() {
    const { network, token, codeHashes, value } = state.context;
    const badge = $('network');
    badge.textContent = network === 'mainnet' ? 'MAINNET' : 'TESTNET';
    badge.className = `badge ${network}`;
    $('title').textContent = `Deploy ${token.name} (${token.symbol}) to ${network}`;
    document.title = `Deploy ${token.symbol} to ${network}`;
    definitionList($('token'), [
      ['Name', `${token.name} (${token.symbol})`],
      ['Supply', `${token.supply} ${token.symbol}, minted once, never again`],
      ['Decimals', token.decimals],
      ['Logo', token.image],
      ['You send', `${value} TON. It stays on the token contract and pays its storage rent for decades.`],
      ['Master code', codeHashes.master, true],
      ['Wallet code', codeHashes.wallet, true],
    ]);
    $('mainnet-confirm').hidden = network !== 'mainnet';
  }

  async function prepare() {
    state.prepared = await api('/api/prepare', { wallet: state.wallet });
    const p = state.prepared;
    definitionList($('summary'), [
      ['Admin and first holder', p.admin, true],
      ['Token contract', p.master, true],
      ['Admin token wallet', p.adminWallet, true],
      ['You send', `${p.value} TON to the token contract address above`],
      ['Local dry run', `passed ${p.dryRun.filter((c) => c.status === 'pass').length} of ${p.dryRun.length} checks`],
    ]);
    $('step-deploy').hidden = false;
    $('deploy-status').textContent = p.alreadyLaunched
      ? ALREADY_LAUNCHED
      : 'Your wallet app will show a transfer to the token contract address above. The terminal that started this page prints the same address. ' +
        'Compare all three, and the amount, before you approve.';
    updateDeployButton();
    if (p.alreadyLaunched) await verify(0);
  }

  async function verify(waitSeconds) {
    $('step-verify').hidden = false;
    $('verify-status').textContent = waitSeconds ? 'Waiting for the network. This usually takes under a minute.' : 'Reading the chain.';
    const result = await api('/api/verify', { wallet: state.wallet, wait: waitSeconds });
    const explorer = $('explorer');
    explorer.href = `${state.context.explorer}/${result.master}`;
    explorer.textContent = 'Open in the explorer';
    renderChecks(result.checks);
    if (result.status === 'pending') {
      $('verify-status').textContent = 'The token is not launched yet. If you approved the transaction, wait a little and check again.';
      return result;
    }
    state.sentUntil = 0;
    if (state.prepared) state.prepared.alreadyLaunched = true;
    $('deploy-status').textContent = ALREADY_LAUNCHED;
    updateDeployButton();
    const verified = result.status === 'verified';
    $('verify-status').textContent = verified
      ? result.mode === 'fresh'
        ? 'Verified. The reviewed code is deployed and the admin holds the whole supply.'
        : 'Verified. The reviewed code is deployed and the token has been used since.'
      : 'NOT verified. Do not use this deployment. See the failed checks below.';
    if (verified) showNextSteps(result);
    return result;
  }

  function showNextSteps(result) {
    const { network, token, rehearsalTokens } = state.context;
    const next = $('next');
    next.replaceChildren();
    const paragraph = (text) => {
      const p = document.createElement('p');
      p.textContent = text;
      next.append(p);
    };
    const command = (text) => {
      const pre = document.createElement('pre');
      pre.textContent = text;
      next.append(pre);
    };
    $('step-next').hidden = false;

    if (network === 'testnet') {
      $('step-rehearsal').hidden = false;
      $('rehearsal-help').textContent =
        `Sends ${rehearsalTokens} ${token.symbol} from your wallet to itself and burns ${rehearsalTokens} ${token.symbol}, in one approval. ` +
        'This proves a real wallet can move and burn the token, and it is required before the mainnet step.';
      paragraph(
        result.burned !== '0'
          ? `Rehearsal done: ${result.burned} ${token.symbol} burned on testnet. Open your wallet and the explorer and check that the token shows its name and logo.`
          : 'Run the rehearsal above. Then open your wallet and the explorer and check that the token shows its name and logo.',
      );
      paragraph('When that looks right, stop this page (Ctrl+C in the terminal) and start the mainnet page with:');
      command(`npm run jetton:deploy:mainnet -- --testnet-master=${result.master} --confirm-mainnet`);
    } else {
      paragraph(`${token.symbol} is live on mainnet. Record this address. It is the token's permanent identity:`);
      command(result.master);
      paragraph('To re-check it at any time:');
      command(`npm run jetton:verify -- --network=mainnet --master=${result.master}`);
    }
  }

  /**
   * Asks the wallet to send a request. Only a refusal in the wallet means for
   * certain that nothing was sent. Any other failure leaves it open, so the
   * message sends the person to the check instead of to another attempt.
   */
  async function askWallet(request) {
    try {
      return await state.ui.sendTransaction(request);
    } catch (error) {
      const reason = error && error.message ? error.message : String(error);
      const refused = /reject|declin|cancel/i.test(reason);
      const failure = new Error(
        refused
          ? 'The transaction was not approved in the wallet. Nothing was sent.'
          : `The wallet did not confirm the transaction (${reason}). If the wallet shows it as sent, press "Check again". Do not send it twice.`,
      );
      failure.refused = refused;
      throw failure;
    }
  }

  async function deploy() {
    setBusy(true);
    showError('');
    let sent = false;
    let checked = false;
    try {
      // Prepared again so the request is not stale by the time the wallet sees it.
      await prepare();
      if (state.prepared.alreadyLaunched) return;
      const { request } = state.prepared;
      $('deploy-status').textContent = 'Approve the transaction in your wallet app.';
      await askWallet(request);
      sent = true;
      // The network accepts this transaction until the request expires, and a minute is allowed for clocks that differ.
      state.sentUntil = (request.validUntil + 60) * 1000;
      $('deploy-status').textContent = 'Sent. Checking the chain.';
      const result = await verify(150);
      checked = true;
      if (result.status === 'pending') $('deploy-status').textContent = SENT_NOT_ARRIVED;
      else await prepare();
    } catch (error) {
      showError(describe(error));
      if (!sent) {
        $('deploy-status').textContent = 'Nothing was launched by this attempt unless your wallet shows a sent transaction.';
        // Unless the wallet plainly refused, leave the check within reach.
        if (!error.refused && state.prepared) $('step-verify').hidden = false;
      } else if (!checked) {
        // The wallet has sent the launch. Only the check afterwards failed, so never suggest sending again.
        $('deploy-status').textContent =
          'Your wallet sent the transaction, but this page could not finish checking it. Do not send it again. Press "Check again" below.';
        $('step-verify').hidden = false;
        $('verify-status').textContent = 'Not checked yet.';
      }
    } finally {
      setBusy(false);
    }
  }

  /** The "Check again" button. */
  async function recheck() {
    setBusy(true);
    showError('');
    try {
      const result = await verify(0);
      if (result.status === 'pending' && state.sentUntil > 0) {
        if (Date.now() < state.sentUntil) {
          $('deploy-status').textContent = SENT_NOT_ARRIVED;
        } else {
          // Too late for that transaction to be accepted, so sending again cannot launch twice.
          state.sentUntil = 0;
          $('deploy-status').textContent = 'That transaction did not arrive before it expired. You can press Deploy again.';
        }
      }
    } catch (error) {
      showError(describe(error));
    } finally {
      setBusy(false);
    }
  }

  async function rehearse() {
    setBusy(true);
    showError('');
    let sent = false;
    try {
      const before = await api('/api/verify', { wallet: state.wallet, wait: 0 });
      const { request } = await api('/api/rehearsal', { wallet: state.wallet });
      $('rehearsal-status').textContent = 'Approve the transaction in your wallet app.';
      await askWallet(request);
      sent = true;
      $('rehearsal-status').textContent = 'Sent. Waiting for the burn to show in the total supply.';
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        // One failed read does not end the wait: the next one is a few seconds away.
        const after = await verify(0).catch(() => null);
        if (after && after.status === 'verified' && after.burned !== before.burned) {
          $('rehearsal-status').textContent = `Done. ${after.burned} ${state.context.token.symbol} burned in total; the supply is now ${after.totalSupply}.`;
          return;
        }
      }
      $('rehearsal-status').textContent = 'The burn has not shown up yet. Use "Check again" in a minute.';
    } catch (error) {
      showError(describe(error));
      $('rehearsal-status').textContent = sent
        ? 'Your wallet sent the rehearsal, but this page could not finish checking it. Do not send it again. Press "Check again" below.'
        : '';
    } finally {
      setBusy(false);
    }
  }

  function describe(error) {
    return error && error.message ? error.message : String(error);
  }

  async function onWallet(wallet) {
    showError('');
    state.wallet = null;
    state.prepared = null;
    state.sentUntil = 0;
    for (const id of ['step-deploy', 'step-verify', 'step-rehearsal', 'step-next']) $(id).hidden = true;
    updateDeployButton();
    if (!wallet) {
      $('wallet-status').textContent = '';
      return;
    }
    const { network, chainId } = state.context;
    if (wallet.account.chain !== chainId) {
      const walletNetwork = wallet.account.chain === '-239' ? 'mainnet' : 'testnet';
      $('wallet-status').textContent = '';
      showError(
        `Your wallet is on ${walletNetwork}, but this page deploys to ${network}. ` +
          `Disconnect, switch the wallet app to ${network}, and connect again.`,
      );
      return;
    }
    state.wallet = wallet.account.address;
    $('wallet-status').textContent = `Connected on ${network}.`;
    setBusy(true);
    try {
      await prepare();
    } catch (error) {
      showError(describe(error));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    try {
      state.context = await api('/api/context');
      renderContext();
      state.ui = new window.TON_CONNECT_UI.TonConnectUI({
        manifestUrl: state.context.manifestUrl,
        buttonRootId: 'connect',
        // TON Connect reports usage to its makers unless told not to. This page has no need for that.
        analytics: { mode: 'off' },
      });
      state.ui.onStatusChange((wallet) => {
        void onWallet(wallet);
      });
      $('deploy').addEventListener('click', () => void deploy());
      $('rehearse').addEventListener('click', () => void rehearse());
      $('recheck').addEventListener('click', () => void recheck());
      for (const box of document.querySelectorAll('.confirm-box')) box.addEventListener('change', updateDeployButton);
    } catch (error) {
      showError(describe(error));
    }
  }

  void start();
})();
