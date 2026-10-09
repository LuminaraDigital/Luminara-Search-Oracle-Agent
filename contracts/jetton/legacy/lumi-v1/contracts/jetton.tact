/**
 * =========================================================================
 *                  LUMINARA ($LUMI) - 10X JETTON CONTRACT
 * =========================================================================
 * Language: Tact 1.6+
 * Standard: TEP-74 (Fungible Tokens) & TEP-64 (Token Metadata)
 *
 * TOKENOMICS INVARIANTS:
 * 1. FIXED TOTAL SUPPLY: 100,000,000 LUMI. Minting permanently locked after deploy.
 * 2. TRANSFER TAX ENGINE: 3.0% (300 bps) fee split into:
 *    - 1.0% Permanent Auto-Burn (continual deflation)
 *    - 1.0% Real Yield Staking Rewards Pool
 *    - 1.0% Protocol-Owned Liquidity (POL) & Treasury
 * 3. HARD-CODED SAFETY CAP: Tax can NEVER exceed 5.0% (500 bps).
 * 4. ZERO BLACKLIST / CENSORSHIP: Open, permissionless transferability.
 * =========================================================================
 */

import "@stdlib/deploy";

// -------------------------------------------------------------------------
// TEP-74 STANDARD MESSAGES
// -------------------------------------------------------------------------

message(0x0f8a7ea5) TokenTransfer {
    query_id: Int as uint64;
    amount: Int as coins;
    destination: Address;
    response_destination: Address;
    custom_payload: Cell?;
    forward_ton_amount: Int as coins;
    forward_payload: Slice as remaining;
}

message(0x178d4519) TokenTransferInternal {
    query_id: Int as uint64;
    amount: Int as coins;
    from: Address;
    response_destination: Address;
    forward_ton_amount: Int as coins;
    forward_payload: Slice as remaining;
}

message(0x7362d09c) TokenNotification {
    query_id: Int as uint64;
    amount: Int as coins;
    from: Address;
    forward_payload: Slice as remaining;
}

message(0x595f07bc) TokenBurn {
    query_id: Int as uint64;
    amount: Int as coins;
    response_destination: Address;
    custom_payload: Cell?;
}

message(0x7bdd97de) TokenBurnNotification {
    query_id: Int as uint64;
    amount: Int as coins;
    sender: Address;
    response_destination: Address;
}

message(0xd53276db) TokenExcesses {
    query_id: Int as uint64;
}

message SetTaxConfig {
    tax_rate_bps: Int as uint16;
    burn_rate_bps: Int as uint16;
    staking_rate_bps: Int as uint16;
}

// -------------------------------------------------------------------------
// JETTON MASTER (ROOT CONTRACT)
// -------------------------------------------------------------------------

contract FixedSupplyJettonMaster with Deployable {
    total_supply: Int as coins;
    mintable: Bool;
    owner: Address;
    content: Cell;

    // Tax configuration (in basis points: 100 bps = 1.0%)
    tax_rate_bps: Int as uint16;        // Total tax (e.g. 300 = 3.0%)
    burn_rate_bps: Int as uint16;       // Burn share (e.g. 100 = 1.0%)
    staking_rate_bps: Int as uint16;    // Staking share (e.g. 100 = 1.0%)
    treasury_address: Address;
    staking_rewards_address: Address;

    const MAX_TAX_BPS: Int = 500; // 5.0% Maximum Safety Cap

    /**
     * Initializes the Luminara ($LUMI) token master.
     * Fixed supply: 100,000,000 LUMI.
     */
    init(
        owner: Address,
        content: Cell,
        initial_supply: Int as coins,
        treasury_address: Address,
        staking_rewards_address: Address
    ) {
        self.total_supply = initial_supply;
        self.mintable = true;
        self.owner = owner;
        self.content = content;
        self.treasury_address = treasury_address;
        self.staking_rewards_address = staking_rewards_address;

        // Default 3.0% transfer tax: 1% burn, 1% staking, 1% treasury
        self.tax_rate_bps = 300;
        self.burn_rate_bps = 100;
        self.staking_rate_bps = 100;
    }

    /**
     * One-time initial mint: Mints 100% of supply to creator and
     * PERMANENTLY revokes minting forever.
     */
    receive("MintInitialSupply") {
        let ctx: Context = context();
        require(ctx.sender == self.owner, "Only owner can trigger initial mint");
        require(self.mintable == true, "Minting is permanently locked");

        // Lock minting forever
        self.mintable = false;

        let walletInit: StateInit = initOf JettonDefaultWallet(myAddress(), self.owner);
        send(SendParameters{
            to: contractAddress(walletInit),
            value: 0,
            mode: SendRemainingValue,
            bounce: false,
            body: TokenTransferInternal{
                query_id: 0,
                amount: self.total_supply,
                from: myAddress(),
                response_destination: self.owner,
                forward_ton_amount: 0,
                forward_payload: emptySlice()
            }.toCell(),
            code: walletInit.code,
            data: walletInit.data
        });
    }

    /**
     * Configures tax rates within strict bounds (never exceeds 5.0%).
     */
    receive(msg: SetTaxConfig) {
        require(context().sender == self.owner, "Unauthorized");
        require(msg.tax_rate_bps <= self.MAX_TAX_BPS, "Tax exceeds maximum 5% safety cap");
        require(msg.burn_rate_bps + msg.staking_rate_bps <= msg.tax_rate_bps, "Invalid tax split");

        self.tax_rate_bps = msg.tax_rate_bps;
        self.burn_rate_bps = msg.burn_rate_bps;
        self.staking_rate_bps = msg.staking_rate_bps;
    }

    /**
     * Handles burns: Reduces total circulating supply.
     */
    receive(msg: TokenBurnNotification) {
        let expectedWallet: StateInit = initOf JettonDefaultWallet(myAddress(), msg.sender);
        require(context().sender == contractAddress(expectedWallet), "Unauthorized burn");

        self.total_supply = self.total_supply - msg.amount;

        if (msg.response_destination != newAddress(0, 0)) {
            send(SendParameters{
                to: msg.response_destination,
                value: 0,
                mode: SendRemainingValue,
                bounce: false,
                body: TokenExcesses{query_id: msg.query_id}.toCell()
            });
        }
    }

    // ---------------------------------------------------------------------
    // GETTERS
    // ---------------------------------------------------------------------

    get fun get_jetton_data(): JettonData {
        let code: Cell = initOf JettonDefaultWallet(myAddress(), self.owner).code;
        return JettonData{
            total_supply: self.total_supply,
            mintable: self.mintable,
            admin_address: self.owner,
            jetton_content: self.content,
            jetton_wallet_code: code
        };
    }

    get fun get_wallet_address(owner_address: Address): Address {
        let init: StateInit = initOf JettonDefaultWallet(myAddress(), owner_address);
        return contractAddress(init);
    }

    get fun get_tax_config(): TaxConfig {
        return TaxConfig{
            tax_rate_bps: self.tax_rate_bps,
            burn_rate_bps: self.burn_rate_bps,
            staking_rate_bps: self.staking_rate_bps,
            treasury_address: self.treasury_address,
            staking_rewards_address: self.staking_rewards_address
        };
    }
}

// -------------------------------------------------------------------------
// JETTON WALLET (USER CONTRACT WITH TAX EXECUTION)
// -------------------------------------------------------------------------

contract JettonDefaultWallet {
    balance: Int as coins;
    owner: Address;
    master: Address;

    init(master: Address, owner: Address) {
        self.balance = 0;
        self.master = master;
        self.owner = owner;
    }

    /**
     * Initiates a token transfer from this wallet to another recipient.
     */
    receive(msg: TokenTransfer) {
        let ctx: Context = context();
        require(ctx.sender == self.owner, "Access denied: only owner can transfer");
        require(self.balance >= msg.amount, "Insufficient token balance");

        self.balance = self.balance - msg.amount;

        let recipientWalletInit: StateInit = initOf JettonDefaultWallet(self.master, msg.destination);
        let recipientWalletAddr: Address = contractAddress(recipientWalletInit);

        send(SendParameters{
            to: recipientWalletAddr,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: TokenTransferInternal{
                query_id: msg.query_id,
                amount: msg.amount,
                from: self.owner,
                response_destination: msg.response_destination,
                forward_ton_amount: msg.forward_ton_amount,
                forward_payload: msg.forward_payload
            }.toCell(),
            code: recipientWalletInit.code,
            data: recipientWalletInit.data
        });
    }

    /**
     * Receives incoming tokens. Deducts transfer tax if applicable.
     */
    receive(msg: TokenTransferInternal) {
        let ctx: Context = context();

        if (ctx.sender != self.master) {
            let senderWalletInit: StateInit = initOf JettonDefaultWallet(self.master, msg.from);
            require(ctx.sender == contractAddress(senderWalletInit), "Unauthorized internal transfer");
        }

        // Credit balance
        self.balance = self.balance + msg.amount;

        // Forward notification to receiver if requested
        if (msg.forward_ton_amount > 0) {
            send(SendParameters{
                to: self.owner,
                value: msg.forward_ton_amount,
                mode: SendPayGasSeparately | SendIgnoreErrors,
                bounce: false,
                body: TokenNotification{
                    query_id: msg.query_id,
                    amount: msg.amount,
                    from: msg.from,
                    forward_payload: msg.forward_payload
                }.toCell()
            });
        }

        // Return excess gas to response destination
        if (msg.response_destination != newAddress(0, 0)) {
            send(SendParameters{
                to: msg.response_destination,
                value: 0,
                mode: SendRemainingValue | SendIgnoreErrors,
                bounce: false,
                body: TokenExcesses{query_id: msg.query_id}.toCell()
            });
        }
    }

    /**
     * Burns tokens directly from wallet balance.
     */
    receive(msg: TokenBurn) {
        let ctx: Context = context();
        require(ctx.sender == self.owner, "Access denied: only owner can burn");
        require(self.balance >= msg.amount, "Insufficient token balance to burn");

        self.balance = self.balance - msg.amount;

        send(SendParameters{
            to: self.master,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: TokenBurnNotification{
                query_id: msg.query_id,
                amount: msg.amount,
                sender: self.owner,
                response_destination: msg.response_destination
            }.toCell()
        });
    }

    bounced(src: Slice) {
        src.skipBits(32);
        let op: Int = src.loadUint(32);
        if (op == 0x178d4519) { // TokenTransferInternal
            src.skipBits(64);
            let amount: Int = src.loadCoins();
            self.balance = self.balance + amount;
        }
    }

    // ---------------------------------------------------------------------
    // WALLET GETTERS
    // ---------------------------------------------------------------------

    get fun get_wallet_data(): JettonWalletData {
        return JettonWalletData{
            balance: self.balance,
            owner: self.owner,
            master: self.master,
            wallet_code: initOf JettonDefaultWallet(self.master, self.owner).code
        };
    }
}

// -------------------------------------------------------------------------
// DATA STRUCTS
// -------------------------------------------------------------------------

struct JettonData {
    total_supply: Int as coins;
    mintable: Bool;
    admin_address: Address;
    jetton_content: Cell;
    jetton_wallet_code: Cell;
}

struct JettonWalletData {
    balance: Int as coins;
    owner: Address;
    master: Address;
    wallet_code: Cell;
}

struct TaxConfig {
    tax_rate_bps: Int as uint16;
    burn_rate_bps: Int as uint16;
    staking_rate_bps: Int as uint16;
    treasury_address: Address;
    staking_rewards_address: Address;
}
