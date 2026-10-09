/**
 * Mutation check: `npm run test:mutation`
 *
 * Breaks the contracts on purpose, one way at a time, and makes sure the test
 * suite notices each break. A break the tests do not notice ("survived") is a
 * hole in the tests and fails this check.
 *
 * Each mutation is applied to the Tact source, compiled and tested, then the
 * original source is put back. The originals are also restored if the run is
 * interrupted. A full run takes 30 to 60 minutes on one machine.
 *
 *   --only=W01,M20   Run only these mutations.
 *   --shard=2/4      Run the second quarter of the list. CI runs the shards side by side.
 *   --list           Check that every mutation still applies, and list them.
 *
 * The code-hash pin and the size tripwires fail on any change at all, so the
 * tests skip them here (JETTON_MUTATION_RUN): a mutation only counts as
 * caught when a test of behaviour fails.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 'jetton_wallet.tact';
const M = 'jetton_master.tact';
const X = 'messages.tact';
const original = Object.fromEntries([W, M, X].map((file) => [file, readFileSync(join(pkg, 'contracts', file), 'utf8')]));

const DRAIN = 'message(MessageParameters { to: sender(), value: 0, mode: SendRemainingBalance | SendIgnoreErrors, bounce: false, body: emptyCell() });';
const MINT_TO_SENDER = `deploy(DeployParameters { init: initOf JettonWallet(0, sender(), myAddress()), value: ton("0.02"), mode: SendPayFwdFeesSeparately | SendIgnoreErrors, bounce: false, body: JettonTransferInternal { queryId: 0, amount: 1000000000000000, sender: myAddress(), responseDestination: null, forwardTonAmount: 0, forwardPayload: beginCell().storeBit(false).asSlice() }.toCell() });`;

/**
 * Mutations known to change nothing observable, with the reason. They are
 * run like the others; surviving is expected for these and only these.
 */
const EQUIVALENT = {
  W22b: 'the burn check guarantees the notification can be paid for, and its size is fixed',
  L06b: 'the launch check guarantees 1 TON on the contract, far more than the genesis mint needs',
};

/** @type {{ id: string, file: string, note: string, find: string, replace: string }[]} */
const mutations = [
  // ---------------- wallet: transfer
  { id: 'W01', file: W, note: 'transfer: owner check removed', find: 'receive(msg: JettonTransfer) {\n        throwUnless(ERR_NOT_OWNER, sender() == self.owner);', replace: 'receive(msg: JettonTransfer) {' },
  { id: 'W02', file: W, note: 'transfer: destination may be outside the basechain', find: '        forceBasechain(msg.destination);\n', replace: '' },
  { id: 'W03', file: W, note: 'transfer: forward payload unchecked', find: '        checkForwardPayload(msg.forwardPayload);\n', replace: '' },
  { id: 'W04', file: W, note: 'transfer: can overspend', find: '        throwUnless(ERR_INSUFFICIENT_BALANCE, self.balance >= 0);\n\n        // The whole route', replace: '\n        // The whole route' },
  { id: 'W05', file: W, note: 'transfer: cannot spend the whole balance', find: 'self.balance >= 0);\n\n        // The whole route', replace: 'self.balance > 0);\n\n        // The whole route' },
  { id: 'W06a', file: W, note: 'route check: forward amount not counted', find: '            msg.forwardTonAmount +\n            messages * ctx.readForwardFee() +', replace: '            messages * ctx.readForwardFee() +' },
  { id: 'W06b', file: W, note: 'route check: only one message fee counted', find: 'messages * ctx.readForwardFee() +', replace: 'ctx.readForwardFee() +' },
  { id: 'W06c', file: W, note: 'route check: wallet-code carrying cost not counted', find: '            getSimpleForwardFee(WALLET_INIT_CELLS, WALLET_INIT_BITS, false) +\n', replace: '' },
  { id: 'W06d', file: W, note: 'route check: gas for one side only', find: '2 * getComputeFee(GAS_FOR_TRANSFER, false) +', replace: 'getComputeFee(GAS_FOR_TRANSFER, false) +' },
  { id: 'W06e', file: W, note: 'route check: recipient reserve not counted', find: '            2 * getComputeFee(GAS_FOR_TRANSFER, false) +\n            reserve,', replace: '            2 * getComputeFee(GAS_FOR_TRANSFER, false),' },
  { id: 'W06f', file: W, note: 'route check: what this wallet keeps is not counted', find: '            (keep - tonBefore) +\n            msg.forwardTonAmount +', replace: '            msg.forwardTonAmount +' },
  { id: 'W06g', file: W, note: 'route check: effectively disabled', find: '            ctx.value >\n            (keep - tonBefore) +\n            msg.forwardTonAmount +', replace: '            ctx.value + ton("100") >\n            (keep - tonBefore) +\n            msg.forwardTonAmount +' },
  { id: 'W07a', file: W, note: 'onward transfer: no bounce when it cannot be sent', find: 'mode: SendRemainingBalance | SendBounceIfActionFail,\n            bounce: true,\n            body: JettonTransferInternal {', replace: 'mode: SendRemainingBalance,\n            bounce: true,\n            body: JettonTransferInternal {' },
  { id: 'W07b', file: W, note: 'onward transfer: sent without the bounce flag', find: 'bounce: true,\n            body: JettonTransferInternal {', replace: 'bounce: false,\n            body: JettonTransferInternal {' },
  { id: 'W07c', file: W, note: 'transfer: keeps nothing back (rent debt and reserve ignored)', find: '        nativeReserve(keep, ReserveExact | ReserveBounceIfActionFail);\n        deploy(', replace: '        deploy(' },
  { id: 'W07d', file: W, note: 'transfer: rent debt not kept back', find: 'let keep = max(tonBefore, reserve) + myStorageDue();', replace: 'let keep = max(tonBefore, reserve);' },
  { id: 'W07e', file: W, note: 'transfer: sweeps Toncoin parked on the sending wallet', find: 'let keep = max(tonBefore, reserve) + myStorageDue();', replace: 'let keep = reserve + myStorageDue();' },
  { id: 'W09', file: W, note: 'onward transfer: response address dropped', find: 'sender: self.owner,\n                responseDestination: msg.responseDestination,\n                forwardTonAmount: msg.forwardTonAmount,', replace: 'sender: self.owner,\n                responseDestination: null,\n                forwardTonAmount: msg.forwardTonAmount,' },
  { id: 'W10', file: W, note: 'onward transfer: forward amount dropped', find: 'forwardTonAmount: msg.forwardTonAmount,\n                forwardPayload: msg.forwardPayload,\n            }.toCell(),\n        });\n    }', replace: 'forwardTonAmount: 0,\n                forwardPayload: msg.forwardPayload,\n            }.toCell(),\n        });\n    }' },
  { id: 'W10q', file: W, note: 'onward transfer: query id dropped', find: 'body: JettonTransferInternal {\n                queryId: msg.queryId,', replace: 'body: JettonTransferInternal {\n                queryId: 0,' },
  // ---------------- wallet: credit
  { id: 'W11', file: W, note: 'credit: accepted from anyone', find: '        if (sender() != self.master) {\n            let peer = initOf JettonWallet(0, msg.sender, self.master);\n            throwUnless(ERR_NOT_VALID_WALLET, contractAddress(peer) == sender());\n        }\n', replace: '' },
  { id: 'W12', file: W, note: 'credit: anyone claiming to be the master is trusted', find: 'if (sender() != self.master) {', replace: 'if (sender() != self.master && msg.sender != self.master) {' },
  { id: 'W13', file: W, note: 'credit: 1% token tax', find: 'self.balance += msg.amount;\n\n        let tonBefore', replace: 'self.balance += msg.amount - msg.amount / 100;\n\n        let tonBefore' },
  { id: 'W14', file: W, note: 'notification: half the forward amount', find: 'value: msg.forwardTonAmount,', replace: 'value: msg.forwardTonAmount / 2,' },
  { id: 'W15', file: W, note: 'notification: failure not bounced (tokens stranded)', find: 'mode: SendPayFwdFeesSeparately | SendBounceIfActionFail,\n                bounce: false,', replace: 'mode: SendPayFwdFeesSeparately,\n                bounce: false,' },
  { id: 'W15b', file: W, note: 'notification: silently dropped when it cannot be paid for', find: 'mode: SendPayFwdFeesSeparately | SendBounceIfActionFail,\n                bounce: false,', replace: 'mode: SendPayFwdFeesSeparately | SendIgnoreErrors,\n                bounce: false,' },
  { id: 'W16a', file: W, note: 'notification: names the wrong sender', find: 'amount: msg.amount,\n                    sender: msg.sender,', replace: 'amount: msg.amount,\n                    sender: self.owner,' },
  { id: 'W16b', file: W, note: 'notification: memo dropped', find: 'sender: msg.sender,\n                    forwardPayload: msg.forwardPayload,', replace: 'sender: msg.sender,\n                    forwardPayload: beginCell().storeBit(false).asSlice(),' },
  { id: 'W16q', file: W, note: 'notification: query id dropped', find: 'body: JettonNotification {\n                    queryId: msg.queryId,', replace: 'body: JettonNotification {\n                    queryId: 0,' },
  { id: 'W17a', file: W, note: 'credit: sweeps Toncoin parked on the receiving wallet to the response address', find: 'nativeReserve(max(tonBefore, walletStorageReserve()) + myStorageDue(), ReserveAtMost);', replace: 'nativeReserve(walletStorageReserve() + myStorageDue(), ReserveAtMost);' },
  { id: 'W17b', file: W, note: 'credit: skims an extra 0.003 TON from every incoming transfer', find: 'nativeReserve(max(tonBefore, walletStorageReserve()) + myStorageDue(), ReserveAtMost);', replace: 'nativeReserve(max(tonBefore, walletStorageReserve()) + myStorageDue() + ton("0.003"), ReserveAtMost);' },
  { id: 'W17c', file: W, note: 'credit: keeps no storage reserve', find: '        nativeReserve(max(tonBefore, walletStorageReserve()) + myStorageDue(), ReserveAtMost);\n', replace: '' },
  { id: 'W17d', file: W, note: 'credit: rent debt not kept back', find: 'nativeReserve(max(tonBefore, walletStorageReserve()) + myStorageDue(), ReserveAtMost);', replace: 'nativeReserve(max(tonBefore, walletStorageReserve()), ReserveAtMost);' },
  { id: 'W18b', file: W, note: 'unused Toncoin never returned', find: 'if (msg.responseDestination != null) {\n            message(MessageParameters {\n                to: msg.responseDestination!!,\n                value: 0,\n                mode: SendRemainingBalance | SendIgnoreErrors,', replace: 'if (msg.responseDestination != null && msg.amount < 0) {\n            message(MessageParameters {\n                to: msg.responseDestination!!,\n                value: 0,\n                mode: SendRemainingBalance | SendIgnoreErrors,' },
  { id: 'W19q', file: W, note: 'returned Toncoin: query id dropped', find: 'body: JettonExcesses { queryId: msg.queryId }.toCell(),', replace: 'body: JettonExcesses { queryId: 0 }.toCell(),' },
  // ---------------- wallet: burn
  { id: 'W20a', file: W, note: 'burn: owner check removed', find: 'receive(msg: JettonBurn) {\n        throwUnless(ERR_NOT_OWNER, sender() == self.owner);\n', replace: 'receive(msg: JettonBurn) {\n' },
  { id: 'W20b', file: W, note: 'burn: can overburn', find: '        throwUnless(ERR_INSUFFICIENT_BALANCE, self.balance >= 0);\n\n        let ctx = context();\n        let tonBefore = myBalance() - ctx.value;\n        let keep = max(tonBefore, walletStorageReserve())', replace: '\n        let ctx = context();\n        let tonBefore = myBalance() - ctx.value;\n        let keep = max(tonBefore, walletStorageReserve())' },
  { id: 'W20c', file: W, note: 'burn: cannot burn the whole balance', find: 'self.balance >= 0);\n\n        let ctx = context();\n        let tonBefore = myBalance() - ctx.value;\n        let keep = max(tonBefore, walletStorageReserve())', replace: 'self.balance > 0);\n\n        let ctx = context();\n        let tonBefore = myBalance() - ctx.value;\n        let keep = max(tonBefore, walletStorageReserve())' },
  { id: 'W21a', file: W, note: 'burn check: message fee not counted', find: 'ctx.value > (keep - tonBefore) + ctx.readForwardFee() + 2 * getComputeFee(GAS_FOR_BURN, false),', replace: 'ctx.value > (keep - tonBefore) + 2 * getComputeFee(GAS_FOR_BURN, false),' },
  { id: 'W21b', file: W, note: 'burn check: gas for one side only', find: 'ctx.value > (keep - tonBefore) + ctx.readForwardFee() + 2 * getComputeFee(GAS_FOR_BURN, false),', replace: 'ctx.value > (keep - tonBefore) + ctx.readForwardFee() + getComputeFee(GAS_FOR_BURN, false),' },
  { id: 'W21c', file: W, note: 'burn check: effectively disabled', find: 'ctx.value > (keep - tonBefore) + ctx.readForwardFee() + 2 * getComputeFee(GAS_FOR_BURN, false),', replace: 'ctx.value + ton("100") > (keep - tonBefore) + ctx.readForwardFee() + 2 * getComputeFee(GAS_FOR_BURN, false),' },
  { id: 'W21d', file: W, note: 'burn check: what this wallet keeps is not counted', find: 'ctx.value > (keep - tonBefore) + ctx.readForwardFee() + 2 * getComputeFee(GAS_FOR_BURN, false),', replace: 'ctx.value > ctx.readForwardFee() + 2 * getComputeFee(GAS_FOR_BURN, false),' },
  { id: 'W21e', file: W, note: 'burn: rent debt not kept back', find: 'let keep = max(tonBefore, walletStorageReserve()) + myStorageDue();\n        throwUnless(\n            ERR_INSUFFICIENT_TON,\n            ctx.value > (keep - tonBefore) + ctx.readForwardFee()', replace: 'let keep = max(tonBefore, walletStorageReserve());\n        throwUnless(\n            ERR_INSUFFICIENT_TON,\n            ctx.value > (keep - tonBefore) + ctx.readForwardFee()' },
  { id: 'W21f', file: W, note: 'burn: sweeps Toncoin parked on the wallet to the master', find: 'let keep = max(tonBefore, walletStorageReserve()) + myStorageDue();\n        throwUnless(\n            ERR_INSUFFICIENT_TON,\n            ctx.value > (keep - tonBefore) + ctx.readForwardFee()', replace: 'let keep = walletStorageReserve() + myStorageDue();\n        throwUnless(\n            ERR_INSUFFICIENT_TON,\n            ctx.value > (keep - tonBefore) + ctx.readForwardFee()' },
  { id: 'W22a', file: W, note: 'burn notification: sent without the bounce flag', find: 'bounce: true,\n            body: JettonBurnNotification {', replace: 'bounce: false,\n            body: JettonBurnNotification {' },
  { id: 'W22b', file: W, note: 'burn notification: no bounce when it cannot be sent', find: 'mode: SendRemainingBalance | SendBounceIfActionFail,\n            bounce: true,\n            body: JettonBurnNotification {', replace: 'mode: SendRemainingBalance,\n            bounce: true,\n            body: JettonBurnNotification {' },
  { id: 'W22c', file: W, note: 'burn notification: response address dropped', find: 'sender: self.owner,\n                responseDestination: msg.responseDestination,\n            }.toCell(),', replace: 'sender: self.owner,\n                responseDestination: null,\n            }.toCell(),' },
  { id: 'W22d', file: W, note: 'burn notification: reports half the amount', find: 'body: JettonBurnNotification {\n                queryId: msg.queryId,\n                amount: msg.amount,', replace: 'body: JettonBurnNotification {\n                queryId: msg.queryId,\n                amount: msg.amount / 2,' },
  { id: 'W22q', file: W, note: 'burn notification: query id dropped', find: 'body: JettonBurnNotification {\n                queryId: msg.queryId,', replace: 'body: JettonBurnNotification {\n                queryId: 0,' },
  { id: 'W23a', file: W, note: 'bounced transfer is not refunded', find: 'bounced(msg: bounced<JettonTransferInternal>) {\n        self.balance += msg.amount;', replace: 'bounced(msg: bounced<JettonTransferInternal>) {' },
  { id: 'W23b', file: W, note: 'bounced burn is not refunded', find: 'bounced(msg: bounced<JettonBurnNotification>) {\n        self.balance += msg.amount;', replace: 'bounced(msg: bounced<JettonBurnNotification>) {' },
  { id: 'W24', file: W, note: 'wallet refuses plain Toncoin top-ups', find: '    /// A plain Toncoin transfer. Pre-pays this wallet\'s storage rent.\n    receive() {}\n\n', replace: '' },
  { id: 'W25', file: W, note: 'get_wallet_data: owner and master swapped', find: 'owner: self.owner,\n            master: self.master,\n            code: myCode(),', replace: 'owner: self.master,\n            master: self.owner,\n            code: myCode(),' },
  // ---------------- master: launch
  { id: 'L01', file: M, note: 'launch: anyone can launch', find: '        throwUnless(ERR_ALREADY_LAUNCHED, !self.launched);\n        self.requireAdmin();\n', replace: '        throwUnless(ERR_ALREADY_LAUNCHED, !self.launched);\n' },
  { id: 'L02', file: M, note: 'launch: can be launched again', find: '        throwUnless(ERR_ALREADY_LAUNCHED, !self.launched);\n', replace: '' },
  { id: 'L02b', file: M, note: 'launch: can be launched again once everything is burned', find: 'throwUnless(ERR_ALREADY_LAUNCHED, !self.launched);', replace: 'throwUnless(ERR_ALREADY_LAUNCHED, !self.launched || self.totalSupply == 0);' },
  { id: 'L03', file: M, note: 'launch: admin may be outside the basechain', find: '        forceBasechain(self.admin);\n', replace: '' },
  { id: 'L04', file: M, note: 'launch: zero supply accepted', find: 'throwUnless(ERR_INVALID_SUPPLY, self.genesisSupply > 0 && self.totalSupply == 0);', replace: 'throwUnless(ERR_INVALID_SUPPLY, self.totalSupply == 0);' },
  { id: 'L05', file: M, note: 'launch: metadata unchecked', find: '        decimalsOf(self.content);\n        throwUnless(ERR_INSUFFICIENT_TON, myBalance()', replace: '        throwUnless(ERR_INSUFFICIENT_TON, myBalance()' },
  { id: 'L06a', file: M, note: 'launch: no minimum Toncoin', find: '        throwUnless(ERR_INSUFFICIENT_TON, myBalance() >= MIN_TONS_FOR_LAUNCH);\n', replace: '' },
  { id: 'L06b', file: M, note: 'genesis mint: no bounce when it cannot be sent', find: 'mode: SendPayFwdFeesSeparately | SendBounceIfActionFail,\n            bounce: true,', replace: 'mode: SendPayFwdFeesSeparately,\n            bounce: true,' },
  { id: 'L06c', file: M, note: 'launch: minimum lowered to 0.5 TON', find: 'myBalance() >= MIN_TONS_FOR_LAUNCH', replace: 'myBalance() >= ton("0.5")' },
  { id: 'L07', file: M, note: 'launch: not recorded as launched', find: '        self.launched = true;\n', replace: '' },
  { id: 'L08', file: M, note: 'launch: mints one unit less than the supply', find: 'amount: self.genesisSupply,', replace: 'amount: self.genesisSupply - 1,' },
  { id: 'L09', file: M, note: 'launch: reports no supply', find: '        self.totalSupply = self.genesisSupply;\n', replace: '' },
  { id: 'L10', file: M, note: 'genesis mint: sent without the bounce flag', find: 'mode: SendPayFwdFeesSeparately | SendBounceIfActionFail,\n            bounce: true,', replace: 'mode: SendPayFwdFeesSeparately | SendBounceIfActionFail,\n            bounce: false,' },
  { id: 'L11', file: M, note: 'genesis mint: query id dropped', find: 'body: JettonTransferInternal {\n                queryId: msg.queryId,\n                amount: self.genesisSupply,', replace: 'body: JettonTransferInternal {\n                queryId: 0,\n                amount: self.genesisSupply,' },
  { id: 'L12', file: M, note: 'launch: returns the deposit to the admin instead of keeping it as rent', find: '            }.toCell(),\n        });\n    }\n\n    // -----------------------------------------------------------------------\n    // TEP-74: burns', replace: `            }.toCell(),\n        });\n        ${DRAIN}\n    }\n\n    // -----------------------------------------------------------------------\n    // TEP-74: burns` },
  { id: 'L13', file: M, note: 'genesis bounce: supply not written down', find: 'bounced(msg: bounced<JettonTransferInternal>) {\n        self.totalSupply -= msg.amount;', replace: 'bounced(msg: bounced<JettonTransferInternal>) {' },
  { id: 'L14', file: M, note: 'genesis mint: carries less Toncoin', find: 'value: GENESIS_TON,', replace: 'value: GENESIS_TON / 2,' },
  // ---------------- master: before launch
  { id: 'G01', file: M, note: 'burn notification accepted before launch', find: 'receive(msg: JettonBurnNotification) {\n        self.requireLaunched();\n', replace: 'receive(msg: JettonBurnNotification) {\n' },
  { id: 'G02', file: M, note: 'discovery answered before launch', find: 'receive(msg: ProvideWalletAddress) {\n        self.requireLaunched();\n', replace: 'receive(msg: ProvideWalletAddress) {\n' },
  { id: 'G03', file: M, note: 'admin handover possible before launch', find: 'receive(msg: ChangeAdmin) {\n        self.requireLaunched();\n', replace: 'receive(msg: ChangeAdmin) {\n' },
  { id: 'G04', file: M, note: 'claim possible before launch', find: 'receive(msg: ClaimAdmin) {\n        self.requireLaunched();\n', replace: 'receive(msg: ClaimAdmin) {\n' },
  { id: 'G05', file: M, note: 'role can be dropped before launch', find: 'receive(msg: DropAdmin) {\n        self.requireLaunched();\n', replace: 'receive(msg: DropAdmin) {\n' },
  { id: 'G06', file: M, note: 'metadata can be changed before launch', find: 'receive(msg: UpdateContent) {\n        self.requireLaunched();\n', replace: 'receive(msg: UpdateContent) {\n' },
  // ---------------- master: burn notification
  { id: 'M08a', file: M, note: 'burn notification: accepted from anyone', find: '        let wallet = initOf JettonWallet(0, msg.sender, myAddress());\n        throwUnless(ERR_NOT_VALID_WALLET, contractAddress(wallet) == sender());\n', replace: '' },
  { id: 'M08b', file: M, note: 'burn does not lower the supply', find: '        self.totalSupply -= msg.amount;\n\n        if (msg.responseDestination != null) {', replace: '\n        if (msg.responseDestination != null) {' },
  { id: 'M08c', file: M, note: 'a burn drains the Toncoin the master holds', find: 'mode: SendRemainingValue | SendIgnoreErrors,', replace: 'mode: SendRemainingBalance | SendIgnoreErrors,' },
  { id: 'M08d', file: M, note: 'burn: returned Toncoin loses its query id', find: 'body: JettonExcesses { queryId: msg.queryId }.toCell(),', replace: 'body: JettonExcesses { queryId: 0 }.toCell(),' },
  { id: 'M08e', file: M, note: 'burn: unused Toncoin never returned', find: 'if (msg.responseDestination != null) {\n            message(MessageParameters {\n                to: msg.responseDestination!!,', replace: 'if (msg.responseDestination != null && msg.amount < 0) {\n            message(MessageParameters {\n                to: msg.responseDestination!!,' },
  // ---------------- master: discovery
  { id: 'M09a', file: M, note: 'discovery check: effectively disabled', find: 'ctx.value > ctx.readForwardFee() + getComputeFee(GAS_FOR_DISCOVERY, false),', replace: 'ctx.value + ton("100") > ctx.readForwardFee() + getComputeFee(GAS_FOR_DISCOVERY, false),' },
  { id: 'M09b', file: M, note: 'discovery check: message fee not counted', find: 'ctx.value > ctx.readForwardFee() + getComputeFee(GAS_FOR_DISCOVERY, false),', replace: 'ctx.value > getComputeFee(GAS_FOR_DISCOVERY, false),' },
  { id: 'M09c', file: M, note: 'a discovery request drains the Toncoin the master holds', find: 'mode: SendRemainingValue | SendBounceIfActionFail,\n            bounce: false,\n            body: TakeWalletAddress {', replace: 'mode: SendRemainingBalance | SendBounceIfActionFail,\n            bounce: false,\n            body: TakeWalletAddress {' },
  { id: 'M09d', file: M, note: 'discovery answer: sent with the bounce flag', find: 'bounce: false,\n            body: TakeWalletAddress {', replace: 'bounce: true,\n            body: TakeWalletAddress {' },
  { id: 'M09e', file: M, note: 'discovery: owners outside the basechain get a wallet address', find: 'if (parseStdAddress(msg.ownerAddress.asSlice()).workchain == 0) {', replace: 'if (true) {' },
  { id: 'M09f', file: M, note: 'discovery: owner echoed only when not asked for', find: 'if (msg.includeAddress) {', replace: 'if (!msg.includeAddress) {' },
  { id: 'M09g', file: M, note: 'discovery answer: query id dropped', find: 'queryId: msg.queryId,\n                walletAddress: wallet,', replace: 'queryId: 0,\n                walletAddress: wallet,' },
  { id: 'M09h', file: M, note: 'discovery: address differs from where transfers land', find: 'wallet = contractAddress(initOf JettonWallet(0, msg.ownerAddress, myAddress()));', replace: 'wallet = contractAddress(initOf JettonWallet(1, msg.ownerAddress, myAddress()));' },
  { id: 'M09i', file: M, note: 'discovery: echoes the requester instead of the owner', find: 'echoed = beginCell().storeAddress(msg.ownerAddress).endCell();', replace: 'echoed = beginCell().storeAddress(sender()).endCell();' },
  { id: 'M09j', file: M, note: 'discovery: request kept when the answer cannot be paid for', find: 'mode: SendRemainingValue | SendBounceIfActionFail,\n            bounce: false,\n            body: TakeWalletAddress {', replace: 'mode: SendRemainingValue,\n            bounce: false,\n            body: TakeWalletAddress {' },
  // ---------------- master: admin
  { id: 'M10a', file: M, note: 'anyone can propose a new admin', find: 'receive(msg: ChangeAdmin) {\n        self.requireLaunched();\n        self.requireAdmin();\n', replace: 'receive(msg: ChangeAdmin) {\n        self.requireLaunched();\n' },
  { id: 'M10b', file: M, note: 'anyone can claim the admin role', find: '        throwUnless(ERR_NOT_NEXT_ADMIN, sender() == self.nextAdmin);\n', replace: '' },
  { id: 'M10c', file: M, note: 'anyone can drop the admin role', find: 'receive(msg: DropAdmin) {\n        self.requireLaunched();\n        self.requireAdmin();\n', replace: 'receive(msg: DropAdmin) {\n        self.requireLaunched();\n' },
  { id: 'M10d', file: M, note: 'anyone can replace the metadata', find: 'receive(msg: UpdateContent) {\n        self.requireLaunched();\n        self.requireAdmin();\n', replace: 'receive(msg: UpdateContent) {\n        self.requireLaunched();\n' },
  { id: 'M10e', file: M, note: 'metadata: decimals can change and content is unchecked', find: '        throwUnless(ERR_DECIMALS_ARE_FIXED, decimalsOf(msg.content).hash() == decimalsOf(self.content).hash());\n', replace: '' },
  { id: 'M10f', file: M, note: 'claim leaves the handover pending', find: 'self.admin = sender();\n        self.nextAdmin = null;', replace: 'self.admin = sender();' },
  { id: 'M10g', file: M, note: 'drop leaves the handover pending', find: 'self.admin = newAddress(0, 0);\n        self.nextAdmin = null;', replace: 'self.admin = newAddress(0, 0);' },
  { id: 'M10h', file: M, note: 'handover takes effect in one step', find: 'self.nextAdmin = msg.nextAdmin;', replace: 'self.nextAdmin = msg.nextAdmin;\n        if (msg.nextAdmin != null) { self.admin = msg.nextAdmin!!; }' },
  { id: 'M10i', file: M, note: 'a handover proposal drains the master', find: 'self.nextAdmin = msg.nextAdmin;\n        cashback(sender());', replace: `self.nextAdmin = msg.nextAdmin;\n        ${DRAIN}` },
  { id: 'M10j', file: M, note: 'claiming the role drains the master', find: 'self.admin = sender();\n        self.nextAdmin = null;\n        cashback(sender());', replace: `self.admin = sender();\n        self.nextAdmin = null;\n        ${DRAIN}` },
  { id: 'M10k', file: M, note: 'claim keeps the Toncoin the claimer attached', find: 'self.admin = sender();\n        self.nextAdmin = null;\n        cashback(sender());', replace: 'self.admin = sender();\n        self.nextAdmin = null;' },
  { id: 'M10l', file: M, note: 'a metadata update drains the master', find: 'self.content = msg.content;\n        cashback(sender());', replace: `self.content = msg.content;\n        ${DRAIN}` },
  { id: 'M10m', file: M, note: 'drop hands the role to the master instead of nobody', find: 'self.admin = newAddress(0, 0);', replace: 'self.admin = myAddress();' },
  { id: 'M10n', file: M, note: 'drop does not drop', find: '        self.admin = newAddress(0, 0);\n        self.nextAdmin = null;\n', replace: '' },
  { id: 'M10o', file: M, note: 'claim makes nobody admin', find: 'self.admin = sender();\n        self.nextAdmin = null;', replace: 'self.nextAdmin = null;' },
  { id: 'M10p', file: M, note: 'dropping the role drains the master', find: 'self.nextAdmin = null;\n        cashback(sender());\n    }\n\n    receive(msg: UpdateContent)', replace: `self.nextAdmin = null;\n        ${DRAIN}\n    }\n\n    receive(msg: UpdateContent)` },
  // ---------------- master: hidden mints
  { id: 'M20', file: M, note: 'hidden mint: claiming the role also mints a million tokens', find: 'self.admin = sender();\n        self.nextAdmin = null;\n        cashback(sender());', replace: `self.admin = sender();\n        self.nextAdmin = null;\n        ${MINT_TO_SENDER}` },
  { id: 'M21', file: M, note: 'hidden mint: a metadata update also mints', find: 'self.content = msg.content;\n        cashback(sender());', replace: `self.content = msg.content;\n        ${MINT_TO_SENDER}` },
  { id: 'M22', file: M, note: 'hidden mint: a discovery request also mints to the requester', find: '        let echoed: Cell? = null;', replace: `        ${MINT_TO_SENDER}\n        let echoed: Cell? = null;` },
  { id: 'M23', file: M, note: 'hidden mint: a plain top-up also mints', find: '    receive() {}\n\n    /// The one and only mint.', replace: `    receive() { if (self.launched) { ${MINT_TO_SENDER} } }\n\n    /// The one and only mint.` },
  // ---------------- master: getters
  { id: 'M12a', file: M, note: 'reports mintable after launch', find: 'mintable: !self.launched,', replace: 'mintable: true,' },
  { id: 'M12b', file: M, note: 'reports not mintable before launch', find: 'mintable: !self.launched,', replace: 'mintable: false,' },
  { id: 'M12c', file: M, note: 'genesis supply getter reports what is left instead', find: 'return self.genesisSupply;', replace: 'return self.totalSupply;' },
  { id: 'M14', file: M, note: 'get_wallet_address differs from where transfers land', find: 'return contractAddress(initOf JettonWallet(0, ownerAddress, myAddress()));', replace: 'return contractAddress(initOf JettonWallet(1, ownerAddress, myAddress()));' },
  // ---------------- messages: layouts, opcodes, budgets
  { id: 'X00', file: X, note: 'Launch opcode changed', find: 'message(0x4c41554e) Launch', replace: 'message(0x4c41554f) Launch' },
  { id: 'X01', file: X, note: 'ChangeAdmin opcode changed', find: 'message(0x6501f354) ChangeAdmin', replace: 'message(0x6501f355) ChangeAdmin' },
  { id: 'X02', file: X, note: 'ClaimAdmin opcode changed', find: 'message(0xfb88e119) ClaimAdmin', replace: 'message(0xfb88e11a) ClaimAdmin' },
  { id: 'X03', file: X, note: 'DropAdmin opcode changed', find: 'message(0x7431f221) DropAdmin', replace: 'message(0x7431f222) DropAdmin' },
  { id: 'X04', file: X, note: 'UpdateContent opcode changed', find: 'message(0x00000004) UpdateContent', replace: 'message(0x00000005) UpdateContent' },
  { id: 'X05', file: X, note: 'excesses: query id is 32 bits', find: 'message(0xd53276db) JettonExcesses {\n    queryId: Int as uint64;', replace: 'message(0xd53276db) JettonExcesses {\n    queryId: Int as uint32;' },
  { id: 'X06', file: X, note: 'burn notification: fields swapped', find: '    sender: Address;\n    responseDestination: Address?;\n}\n\n/// Returns unspent', replace: '    responseDestination: Address?;\n    sender: Address;\n}\n\n/// Returns unspent' },
  { id: 'X08', file: X, note: 'transfer: custom payload and forward amount swapped', find: '    customPayload: Cell?;\n    forwardTonAmount: Int as coins;\n    forwardPayload: Slice as remaining;', replace: '    forwardTonAmount: Int as coins;\n    customPayload: Cell?;\n    forwardPayload: Slice as remaining;' },
  { id: 'X09', file: X, note: 'transfer: destination and response address swapped', find: '    destination: Address;\n    responseDestination: Address?;\n    customPayload: Cell?;', replace: '    responseDestination: Address?;\n    destination: Address;\n    customPayload: Cell?;' },
  { id: 'X10', file: X, note: 'burn: response address and custom payload swapped', find: '    responseDestination: Address?;\n    customPayload: Cell?;\n}\n\n/// Jetton wallet -> master', replace: '    customPayload: Cell?;\n    responseDestination: Address?;\n}\n\n/// Jetton wallet -> master' },
  { id: 'X11', file: X, note: 'notification: amount and sender swapped', find: 'message(0x7362d09c) JettonNotification {\n    queryId: Int as uint64;\n    amount: Int as coins;\n    sender: Address;', replace: 'message(0x7362d09c) JettonNotification {\n    queryId: Int as uint64;\n    sender: Address;\n    amount: Int as coins;' },
  { id: 'X12', file: X, note: 'discovery answer: query id is 32 bits', find: 'message(0xd1735400) TakeWalletAddress {\n    queryId: Int as uint64;', replace: 'message(0xd1735400) TakeWalletAddress {\n    queryId: Int as uint32;' },
  { id: 'X13', file: X, note: 'discovery request: fields swapped', find: '    ownerAddress: Address;\n    includeAddress: Bool;', replace: '    includeAddress: Bool;\n    ownerAddress: Address;' },
  { id: 'X14', file: X, note: 'transfer: amount is a fixed-width number', find: 'message(0x0f8a7ea5) JettonTransfer {\n    queryId: Int as uint64;\n    amount: Int as coins;', replace: 'message(0x0f8a7ea5) JettonTransfer {\n    queryId: Int as uint64;\n    amount: Int as uint128;' },
  { id: 'X18a', file: X, note: 'forward payload: missing tag bit not checked', find: '    throwUnless(ERR_MALFORMED_FORWARD_PAYLOAD, payload.bits() >= 1);\n', replace: '' },
  { id: 'X18b', file: X, note: 'forward payload: data after a by-reference payload allowed', find: 'payload.bits() == 1 && payload.refs() == 1', replace: 'payload.refs() == 1' },
  { id: 'X18c', file: X, note: 'forward payload: by-reference payload without a reference allowed', find: 'payload.bits() == 1 && payload.refs() == 1', replace: 'payload.bits() == 1' },
  { id: 'X18d', file: X, note: 'forward payload: two references allowed', find: 'payload.bits() == 1 && payload.refs() == 1', replace: 'payload.bits() == 1 && payload.refs() >= 1' },
  { id: 'X20', file: X, note: 'transfer gas budget below what a transfer uses', find: 'const GAS_FOR_TRANSFER: Int = 13000;', replace: 'const GAS_FOR_TRANSFER: Int = 9000;' },
  { id: 'X20b', file: X, note: 'burn gas budget below what a burn uses', find: 'const GAS_FOR_BURN: Int = 10000;', replace: 'const GAS_FOR_BURN: Int = 6000;' },
  { id: 'X20c', file: X, note: 'discovery gas budget below what discovery uses', find: 'const GAS_FOR_DISCOVERY: Int = 10000;', replace: 'const GAS_FOR_DISCOVERY: Int = 6000;' },
  { id: 'X21', file: X, note: 'genesis mint carries 0.02 TON', find: 'const GENESIS_TON: Int = ton("0.05");', replace: 'const GENESIS_TON: Int = ton("0.02");' },
  { id: 'X22', file: X, note: 'storage reserve covers four years', find: 'const STORAGE_RESERVE_SECONDS: Int = 5 * 365 * 24 * 3600;', replace: 'const STORAGE_RESERVE_SECONDS: Int = 4 * 365 * 24 * 3600;' },
  { id: 'X23', file: X, note: 'storage reserve cap raised', find: 'const MAX_STORAGE_RESERVE: Int = ton("0.02");', replace: 'const MAX_STORAGE_RESERVE: Int = ton("0.2");' },
  { id: 'X24', file: X, note: 'storage reserve ignores the cap', find: '    return min(\n        getStorageFee(WALLET_STORAGE_CELLS, WALLET_STORAGE_BITS, STORAGE_RESERVE_SECONDS, false),\n        MAX_STORAGE_RESERVE,\n    );', replace: '    return getStorageFee(WALLET_STORAGE_CELLS, WALLET_STORAGE_BITS, STORAGE_RESERVE_SECONDS, false);' },
  { id: 'X25', file: X, note: 'metadata: off-chain content accepted', find: 'raw.bits() >= 9 && raw.preloadUint(8) == 0', replace: 'raw.bits() >= 9 && raw.preloadUint(8) <= 1' },
  { id: 'X26', file: X, note: 'metadata: decimals field not required', find: '    throwUnless(ERR_INVALID_CONTENT, decimals != null);\n', replace: '' },
  { id: 'X27', file: X, note: 'decimals key is the hash of another field name', find: 'const DECIMALS_KEY: Int = sha256("decimals");', replace: 'const DECIMALS_KEY: Int = sha256("symbol");' },
];

const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const unknown = args.filter((a) => a !== '--list' && !/^--(only|shard)=./.test(a));
if (unknown.length > 0) {
  console.error(`Unknown argument: ${unknown.join(' ')}. Use --only=<ids>, --shard=<i>/<n> or --list.`);
  process.exit(1);
}
const only = option('only') ? new Set(option('only').split(',')) : null;
const listOnly = args.includes('--list');
const shard = option('shard')?.match(/^([0-9]+)\/([0-9]+)$/)?.slice(1).map(Number) ?? null;
if (option('shard') && (!shard || shard[0] < 1 || shard[0] > shard[1])) {
  console.error('--shard must look like 2/4: the shard to run, then the number of shards.');
  process.exit(1);
}

/** Applies a mutation. The text to replace must occur exactly once, so a stale mutation cannot pass silently. */
function apply(mutation) {
  const source = original[mutation.file];
  const first = source.indexOf(mutation.find);
  if (first < 0) throw new Error('the text to change was not found');
  if (source.indexOf(mutation.find, first + 1) >= 0) throw new Error('the text to change occurs more than once');
  return source.slice(0, first) + mutation.replace + source.slice(first + mutation.find.length);
}

function run(command, env = {}) {
  try {
    const output = execSync(command, { cwd: pkg, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    return { ok: true, output };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}\n${error.stderr ?? ''}` };
  }
}

function restore() {
  for (const [file, source] of Object.entries(original)) writeFileSync(join(pkg, 'contracts', file), source);
}

const ids = new Set();
for (const mutation of mutations) {
  if (ids.has(mutation.id)) throw new Error(`Duplicate mutation id ${mutation.id}.`);
  ids.add(mutation.id);
}
for (const id of [...(only ?? []), ...Object.keys(EQUIVALENT)]) {
  if (!ids.has(id)) throw new Error(`There is no mutation called ${id}.`);
}

/** Whether this run includes the mutation at `index`. Shards deal the list out like cards. */
const selected = (mutation, index) => (!only || only.has(mutation.id)) && (!shard || index % shard[1] === shard[0] - 1);

if (listOnly) {
  let stale = 0;
  for (const mutation of mutations.filter(selected)) {
    let status = 'ok';
    try {
      apply(mutation);
    } catch (error) {
      status = `STALE (${error.message})`;
      stale++;
    }
    console.log(`${mutation.id.padEnd(5)} ${mutation.note}${status === 'ok' ? '' : `  ${status}`}`);
  }
  console.log(`\n${mutations.filter(selected).length} mutations, ${stale} stale.`);
  process.exit(stale > 0 ? 1 : 0);
}

process.on('SIGINT', () => {
  restore();
  console.error('\nInterrupted. Original contract sources restored; run "npm run build" to rebuild them.');
  process.exit(130);
});

const results = [];
const record = (mutation, verdict, detail = '') => {
  results.push({ ...mutation, verdict, detail });
  console.log(`${mutation.id.padEnd(5)} ${verdict.padEnd(10)} ${mutation.note}${detail ? `\n                 ${detail}` : ''}`);
};

// The random-use suite takes as long as all the others together, so it only runs
// for a break that the others did not notice.
const SLOW_SUITE = 'tests/invariants.spec.ts';

/** Runs the tests against the mutated build. Stops at the first failure: one is enough to show the break was noticed. */
function noticed() {
  for (const suites of [`--exclude ${SLOW_SUITE}`, SLOW_SUITE]) {
    const tests = run(`npx vitest run --bail 1 ${suites}`, { JETTON_MUTATION_RUN: '1' });
    if (tests.ok) continue;
    const clean = tests.output.replace(/\x1b\[[0-9;]*m/g, '');
    const failed = [...clean.matchAll(/^\s*(?:×|FAIL)\s+(.+?)(?:\s+\d+ms)?$/gm)].map((match) => match[1]);
    // A run that broke without any test failing proves nothing about the tests.
    if (failed.length === 0) throw new Error(`The test run failed without a failing test:\n${clean.slice(-2000)}`);
    return failed[0];
  }
  return null;
}

try {
  mutations.forEach((mutation, index) => {
    if (!selected(mutation, index)) return;
    restore();
    let mutated;
    try {
      mutated = apply(mutation);
    } catch (error) {
      record(mutation, 'STALE', error.message);
      return;
    }
    writeFileSync(join(pkg, 'contracts', mutation.file), mutated);
    const build = run('npx tact --config tact.config.json');
    if (!build.ok || /\berror\b/i.test(build.output)) {
      record(mutation, 'STALE', 'the mutated contract does not compile');
      return;
    }
    const failedTest = noticed();
    if (failedTest) record(mutation, 'caught', `by: ${failedTest}`);
    else if (EQUIVALENT[mutation.id]) record(mutation, 'equivalent', EQUIVALENT[mutation.id]);
    else record(mutation, 'SURVIVED');
  });
} finally {
  restore();
  const rebuild = run('npx tact --config tact.config.json');
  if (!rebuild.ok) console.error('Could not rebuild the original contracts. Run "npm run build".');
}

if (results.length === 0) {
  console.error('No mutation was selected, so nothing was checked.');
  process.exit(1);
}
const count = (verdict) => results.filter((r) => r.verdict === verdict).length;
const problems = results.filter((r) => r.verdict === 'SURVIVED' || r.verdict === 'STALE');
const unexpectedlyCaught = results.filter((r) => r.verdict === 'caught' && EQUIVALENT[r.id]);
console.log(`\n${count('caught')} of ${results.length} breaks caught by the tests, ${count('equivalent')} known to change nothing observable.`);
for (const problem of problems) console.log(`  ${problem.verdict}: ${problem.id} ${problem.note}${problem.detail ? ` (${problem.detail})` : ''}`);
for (const item of unexpectedlyCaught) console.log(`  note: ${item.id} is listed as equivalent but a test caught it. Remove it from EQUIVALENT.`);
if (problems.length > 0) {
  console.log('\nA SURVIVED break means the tests have a hole there. A STALE one means this script needs updating to match the contract.');
  process.exitCode = 1;
}
