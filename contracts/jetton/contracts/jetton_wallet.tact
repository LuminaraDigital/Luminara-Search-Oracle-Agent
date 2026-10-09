import "./messages";

///
/// Jetton wallet (TEP-74). One instance per holder, holding that holder's
/// balance. It follows the behaviour of the reference wallet:
///
/// - only the owner can transfer or burn;
/// - the amount sent is the amount received: there is no tax, fee or skim;
/// - it only accepts credits from the master (launch) or from another
///   wallet of the same master;
/// - a transfer or burn that fails downstream is refunded by the bounce
///   handlers below.
///
/// Toncoin handling. A wallet pays storage rent from its own Toncoin. Before
/// it sends anything onward, each handler sets aside `keep`: what the wallet
/// already had, never less than the storage reserve, plus any rent it already
/// owes. A refund that comes back later pays outstanding rent before it buys
/// gas, so a wallet that sent while in debt could lose the refund and with it
/// the tokens. Settling the debt first closes that.
///
contract JettonWallet(
    balance: Int as coins,
    owner: Address,
    master: Address,
) {
    /// A plain Toncoin transfer. Pre-pays this wallet's storage rent.
    receive() {}

    receive(msg: JettonTransfer) {
        throwUnless(ERR_NOT_OWNER, sender() == self.owner);
        forceBasechain(msg.destination);
        checkForwardPayload(msg.forwardPayload);

        self.balance -= msg.amount;
        throwUnless(ERR_INSUFFICIENT_BALANCE, self.balance >= 0);

        // The whole route is paid for here, so an accepted transfer always
        // completes: what this wallet keeps, the notification to the new
        // owner, both message fees, the cost of carrying the recipient's
        // wallet code, gas on both sides and the recipient's storage reserve.
        let ctx = context();
        let reserve = walletStorageReserve();
        let tonBefore = myBalance() - ctx.value;
        let keep = max(tonBefore, reserve) + myStorageDue();
        let messages = 1 + sign(msg.forwardTonAmount);
        throwUnless(
            ERR_INSUFFICIENT_TON,
            ctx.value >
            (keep - tonBefore) +
            msg.forwardTonAmount +
            messages * ctx.readForwardFee() +
            getSimpleForwardFee(WALLET_INIT_CELLS, WALLET_INIT_BITS, false) +
            2 * getComputeFee(GAS_FOR_TRANSFER, false) +
            reserve,
        );

        nativeReserve(keep, ReserveExact | ReserveBounceIfActionFail);
        deploy(DeployParameters {
            init: initOf JettonWallet(0, msg.destination, self.master),
            value: 0,
            mode: SendRemainingBalance | SendBounceIfActionFail,
            bounce: true,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
        });
    }

    receive(msg: JettonTransferInternal) {
        // A credit is only valid from the master or from the wallet that the
        // same master would deploy for `msg.sender`.
        if (sender() != self.master) {
            let peer = initOf JettonWallet(0, msg.sender, self.master);
            throwUnless(ERR_NOT_VALID_WALLET, contractAddress(peer) == sender());
        }

        self.balance += msg.amount;

        let tonBefore = myBalance() - context().value;

        if (msg.forwardTonAmount > 0) {
            // If this cannot be paid for, the whole credit bounces back to the
            // sending wallet instead of being lost.
            message(MessageParameters {
                to: self.owner,
                value: msg.forwardTonAmount,
                mode: SendPayFwdFeesSeparately | SendBounceIfActionFail,
                bounce: false,
                body: JettonNotification {
                    queryId: msg.queryId,
                    amount: msg.amount,
                    sender: msg.sender,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
            });
        }

        // Keep what the wallet had, the storage reserve and any rent owed.
        // Only the rest of this message's Toncoin is returned.
        nativeReserve(max(tonBefore, walletStorageReserve()) + myStorageDue(), ReserveAtMost);
        if (msg.responseDestination != null) {
            message(MessageParameters {
                to: msg.responseDestination!!,
                value: 0,
                mode: SendRemainingBalance | SendIgnoreErrors,
                bounce: false,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
            });
        }
    }

    receive(msg: JettonBurn) {
        throwUnless(ERR_NOT_OWNER, sender() == self.owner);

        self.balance -= msg.amount;
        throwUnless(ERR_INSUFFICIENT_BALANCE, self.balance >= 0);

        let ctx = context();
        let tonBefore = myBalance() - ctx.value;
        let keep = max(tonBefore, walletStorageReserve()) + myStorageDue();
        throwUnless(
            ERR_INSUFFICIENT_TON,
            ctx.value > (keep - tonBefore) + ctx.readForwardFee() + 2 * getComputeFee(GAS_FOR_BURN, false),
        );

        nativeReserve(keep, ReserveExact | ReserveBounceIfActionFail);
        message(MessageParameters {
            to: self.master,
            value: 0,
            mode: SendRemainingBalance | SendBounceIfActionFail,
            bounce: true,
            body: JettonBurnNotification {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
            }.toCell(),
        });
    }

    /// The receiving wallet rejected the credit: give the tokens back.
    bounced(msg: bounced<JettonTransferInternal>) {
        self.balance += msg.amount;
    }

    /// The master rejected the burn: the supply did not change, so neither
    /// does this balance.
    bounced(msg: bounced<JettonBurnNotification>) {
        self.balance += msg.amount;
    }

    get fun get_wallet_data(): JettonWalletData {
        return JettonWalletData {
            balance: self.balance,
            owner: self.owner,
            master: self.master,
            code: myCode(),
        };
    }
}
