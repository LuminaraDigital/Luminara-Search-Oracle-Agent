import "./messages";
import "./jetton_wallet";

///
/// Fixed-supply Jetton master (TEP-74, TEP-64 metadata, TEP-89 discovery).
///
/// Life cycle. The contract is deployed holding `genesisSupply` and nothing
/// else: no tokens exist and `totalSupply` is zero. The admin then sends
/// `Launch`, once. That creates the whole supply in the admin's wallet and
/// closes minting forever. Deploying and launching are normally one message.
///
/// Invariants. Each one is checked by a test in ../tests:
///
/// 1. Fixed supply. Tokens are created exactly once, by `Launch`, and only
///    the admin can send it. There is no other mint. After launch
///    `totalSupply` can only fall, and only when a holder burns.
/// 2. `totalSupply` always equals the sum of all wallet balances.
/// 3. Before launch the master accepts only `Launch` from the admin and plain
///    Toncoin top-ups.
/// 4. After launch the admin can do exactly three things: replace the
///    on-chain metadata (never the decimals), hand the role to another
///    address (two steps), or drop the role forever. The admin cannot mint,
///    move, burn or freeze anyone's tokens, cannot charge a fee, cannot
///    change the code and cannot withdraw Toncoin.
///
contract JettonMaster(
    launched: Bool,
    totalSupply: Int as coins,
    genesisSupply: Int as coins,
    /// The zero address once the role has been dropped.
    admin: Address,
    nextAdmin: Address?,
    content: Cell,
) {
    /// A plain Toncoin transfer. Tops up storage rent, before or after launch.
    receive() {}

    /// The one and only mint.
    receive(msg: Launch) {
        throwUnless(ERR_ALREADY_LAUNCHED, !self.launched);
        self.requireAdmin();
        forceBasechain(self.admin);
        throwUnless(ERR_INVALID_SUPPLY, self.genesisSupply > 0 && self.totalSupply == 0);
        decimalsOf(self.content);
        throwUnless(ERR_INSUFFICIENT_TON, myBalance() >= MIN_TONS_FOR_LAUNCH);

        self.launched = true;
        self.totalSupply = self.genesisSupply;

        deploy(DeployParameters {
            init: initOf JettonWallet(0, self.admin, myAddress()),
            value: GENESIS_TON,
            mode: SendPayFwdFeesSeparately | SendBounceIfActionFail,
            bounce: true,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: self.genesisSupply,
                sender: myAddress(),
                responseDestination: self.admin,
                forwardTonAmount: 0,
                forwardPayload: beginCell().storeBit(false).asSlice(),
            }.toCell(),
        });
    }

    // -----------------------------------------------------------------------
    // TEP-74: burns
    // -----------------------------------------------------------------------

    receive(msg: JettonBurnNotification) {
        self.requireLaunched();
        let wallet = initOf JettonWallet(0, msg.sender, myAddress());
        throwUnless(ERR_NOT_VALID_WALLET, contractAddress(wallet) == sender());

        self.totalSupply -= msg.amount;

        if (msg.responseDestination != null) {
            message(MessageParameters {
                to: msg.responseDestination!!,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                bounce: false,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
            });
        }
    }

    // -----------------------------------------------------------------------
    // TEP-89: wallet discovery
    // -----------------------------------------------------------------------

    receive(msg: ProvideWalletAddress) {
        self.requireLaunched();
        let ctx = context();
        throwUnless(
            ERR_INSUFFICIENT_TON,
            ctx.value > ctx.readForwardFee() + getComputeFee(GAS_FOR_DISCOVERY, false),
        );

        let wallet: Address? = null;
        if (parseStdAddress(msg.ownerAddress.asSlice()).workchain == 0) {
            wallet = contractAddress(initOf JettonWallet(0, msg.ownerAddress, myAddress()));
        }

        let echoed: Cell? = null;
        if (msg.includeAddress) {
            echoed = beginCell().storeAddress(msg.ownerAddress).endCell();
        }

        // If the reply cannot be paid for, the request bounces back to the
        // requester instead of leaving its Toncoin here.
        message(MessageParameters {
            to: sender(),
            value: 0,
            mode: SendRemainingValue | SendBounceIfActionFail,
            bounce: false,
            body: TakeWalletAddress {
                queryId: msg.queryId,
                walletAddress: wallet,
                ownerAddress: echoed,
            }.toCell(),
        });
    }

    // -----------------------------------------------------------------------
    // Administration
    // -----------------------------------------------------------------------

    receive(msg: ChangeAdmin) {
        self.requireLaunched();
        self.requireAdmin();
        self.nextAdmin = msg.nextAdmin;
        cashback(sender());
    }

    receive(msg: ClaimAdmin) {
        self.requireLaunched();
        throwUnless(ERR_NOT_NEXT_ADMIN, sender() == self.nextAdmin);
        self.admin = sender();
        self.nextAdmin = null;
        cashback(sender());
    }

    receive(msg: DropAdmin) {
        self.requireLaunched();
        self.requireAdmin();
        // Nobody can send from the zero address, so no admin message can ever
        // pass `requireAdmin()` again. Explorers and minter tools show a zero
        // admin as "ownership revoked".
        self.admin = newAddress(0, 0);
        self.nextAdmin = null;
        cashback(sender());
    }

    receive(msg: UpdateContent) {
        self.requireLaunched();
        self.requireAdmin();
        throwUnless(ERR_DECIMALS_ARE_FIXED, decimalsOf(msg.content).hash() == decimalsOf(self.content).hash());
        self.content = msg.content;
        cashback(sender());
    }

    /// Only the genesis mint is ever sent from this contract as an internal
    /// transfer. If the first wallet rejected it, no tokens exist, so the
    /// supply is written down to match. The token stays launched: it cannot
    /// be minted a second time.
    bounced(msg: bounced<JettonTransferInternal>) {
        self.totalSupply -= msg.amount;
    }

    // -----------------------------------------------------------------------
    // Getters
    // -----------------------------------------------------------------------

    get fun get_jetton_data(): JettonData {
        return JettonData {
            totalSupply: self.totalSupply,
            // True only before launch, when the one mint is still to come.
            mintable: !self.launched,
            adminAddress: self.admin,
            jettonContent: self.content,
            jettonWalletCode: codeOf JettonWallet,
        };
    }

    get fun get_wallet_address(ownerAddress: Address): Address {
        return contractAddress(initOf JettonWallet(0, ownerAddress, myAddress()));
    }

    /// The address that may send `ClaimAdmin`, or null when none is pending.
    get fun get_next_admin_address(): Address? {
        return self.nextAdmin;
    }

    /// The supply created at launch. `get_jetton_data` reports what is left
    /// of it after burns.
    get fun get_genesis_supply(): Int {
        return self.genesisSupply;
    }

    inline fun requireAdmin() {
        throwUnless(ERR_NOT_ADMIN, sender() == self.admin);
    }

    inline fun requireLaunched() {
        throwUnless(ERR_NOT_LAUNCHED, self.launched);
    }
}
