//
// Message layouts, getter structs, exit codes and fee budgets shared by the
// Jetton master and the Jetton wallet.
//
// The TEP-74 and TEP-89 layouts below are fixed by the standards. Wallets,
// exchanges and indexers build and parse these exact bit layouts, so fields
// must never be reordered, resized or removed.
//

// ---------------------------------------------------------------------------
// TEP-74: Jetton transfer, burn and their notifications
// ---------------------------------------------------------------------------

/// Owner -> own Jetton wallet. Moves `amount` to the wallet of `destination`.
message(0x0f8a7ea5) JettonTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    responseDestination: Address?;
    customPayload: Cell?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

/// Jetton wallet -> Jetton wallet (or master -> wallet, once, at launch).
message(0x178d4519) JettonTransferInternal {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
    forwardTonAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

/// Jetton wallet -> its owner, when `forwardTonAmount` is greater than zero.
message(0x7362d09c) JettonNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    forwardPayload: Slice as remaining;
}

/// Owner -> own Jetton wallet. Destroys `amount` and lowers the total supply.
message(0x595f07bc) JettonBurn {
    queryId: Int as uint64;
    amount: Int as coins;
    responseDestination: Address?;
    customPayload: Cell?;
}

/// Jetton wallet -> master, after a burn.
message(0x7bdd97de) JettonBurnNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    sender: Address;
    responseDestination: Address?;
}

/// Returns unspent Toncoin to `responseDestination`.
message(0xd53276db) JettonExcesses {
    queryId: Int as uint64;
}

// ---------------------------------------------------------------------------
// TEP-89: on-chain wallet discovery
// ---------------------------------------------------------------------------

message(0x2c76b973) ProvideWalletAddress {
    queryId: Int as uint64;
    ownerAddress: Address;
    includeAddress: Bool;
}

message(0xd1735400) TakeWalletAddress {
    queryId: Int as uint64;
    /// `addr_none` when the owner is outside the basechain.
    walletAddress: Address?;
    /// The requested owner, echoed back when `includeAddress` was set.
    ownerAddress: Cell?;
}

// ---------------------------------------------------------------------------
// Launch and administration. This is the complete list: after launch there
// is no mint, no freeze, no fee switch, no code upgrade and no withdrawal.
// ---------------------------------------------------------------------------

/// Admin -> master, once. Creates the whole supply in the admin's wallet and
/// closes minting forever.
message(0x4c41554e) Launch {
    queryId: Int as uint64;
}

/// Admin -> master. Proposes `nextAdmin`. Nothing changes until that address
/// sends `ClaimAdmin`. Send `addr_none` to cancel a pending proposal.
message(0x6501f354) ChangeAdmin {
    queryId: Int as uint64;
    nextAdmin: Address?;
}

/// Proposed admin -> master. Completes the handover.
message(0xfb88e119) ClaimAdmin {
    queryId: Int as uint64;
}

/// Admin -> master. Gives up the admin role forever.
message(0x7431f221) DropAdmin {
    queryId: Int as uint64;
}

/// Admin -> master. Replaces the on-chain metadata. The decimals cannot change.
message(0x00000004) UpdateContent {
    queryId: Int as uint64;
    content: Cell;
}

// ---------------------------------------------------------------------------
// Getter results (TEP-74)
// ---------------------------------------------------------------------------

struct JettonData {
    totalSupply: Int;
    mintable: Bool;
    /// The zero address once the admin role has been dropped.
    adminAddress: Address;
    jettonContent: Cell;
    jettonWalletCode: Cell;
}

struct JettonWalletData {
    balance: Int;
    owner: Address;
    master: Address;
    code: Cell;
}

/// TEP-64 on-chain metadata: tag 0x00, then a dictionary from sha256(key) to
/// the value cell.
struct OnchainContent {
    tag: Int as uint8;
    fields: map<Int as uint256, Cell>;
}

// ---------------------------------------------------------------------------
// Exit codes. 705-709 match the reference Jetton wallet.
// ---------------------------------------------------------------------------

const ERR_NOT_OWNER: Int = 705;
const ERR_INSUFFICIENT_BALANCE: Int = 706;
const ERR_NOT_VALID_WALLET: Int = 707;
const ERR_MALFORMED_FORWARD_PAYLOAD: Int = 708;
const ERR_INSUFFICIENT_TON: Int = 709;
const ERR_NOT_ADMIN: Int = 710;
const ERR_NOT_NEXT_ADMIN: Int = 711;
const ERR_INVALID_SUPPLY: Int = 712;
const ERR_INVALID_CONTENT: Int = 713;
const ERR_NOT_LAUNCHED: Int = 714;
const ERR_ALREADY_LAUNCHED: Int = 715;
const ERR_DECIMALS_ARE_FIXED: Int = 716;

// ---------------------------------------------------------------------------
// Fee budgets. tests/toncoin.spec.ts checks every figure below against the
// compiled contracts on each test run, so they cannot drift unnoticed.
// ---------------------------------------------------------------------------

/// Gas for one side of a transfer (the sending or the receiving wallet).
const GAS_FOR_TRANSFER: Int = 13000;

/// Gas for one side of a burn (the wallet or the master).
const GAS_FOR_BURN: Int = 10000;

/// Gas for answering a TEP-89 discovery request.
const GAS_FOR_DISCOVERY: Int = 10000;

/// Size of the code and data a transfer carries so that it can create the
/// recipient's wallet. Forwarding it costs Toncoin that the sender's own
/// message fee does not account for.
const WALLET_INIT_CELLS: Int = 17;
const WALLET_INIT_BITS: Int = 8860;

/// Size of a wallet as the network bills it for storage.
const WALLET_STORAGE_CELLS: Int = 17;
const WALLET_STORAGE_BITS: Int = 9100;

/// A wallet keeps enough Toncoin to pay its storage rent for this long at the
/// network's current prices ...
const STORAGE_RESERVE_SECONDS: Int = 5 * 365 * 24 * 3600;

/// ... but never more than this, so the Toncoin a transfer needs stays
/// bounded however storage prices move.
const MAX_STORAGE_RESERVE: Int = ton("0.02");

/// Toncoin the master must hold when it is launched. It stays there as
/// storage rent for decades; anyone can add more with a plain transfer.
const MIN_TONS_FOR_LAUNCH: Int = ton("1");

/// Toncoin the master forwards with the genesis mint. Whatever the first
/// wallet does not need is returned to the admin.
const GENESIS_TON: Int = ton("0.05");

/// sha256("decimals"), the TEP-64 key of the decimals field.
const DECIMALS_KEY: Int = sha256("decimals");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// The Toncoin a wallet keeps for storage rent.
inline fun walletStorageReserve(): Int {
    return min(
        getStorageFee(WALLET_STORAGE_CELLS, WALLET_STORAGE_BITS, STORAGE_RESERVE_SECONDS, false),
        MAX_STORAGE_RESERVE,
    );
}

/// `forward_payload` is `Either Cell ^Cell`. The tag bit must be present, and
/// a payload stored by reference must be exactly one bit plus one reference.
inline fun checkForwardPayload(payload: Slice) {
    throwUnless(ERR_MALFORMED_FORWARD_PAYLOAD, payload.bits() >= 1);
    if (payload.preloadUint(1) == 1) {
        throwUnless(ERR_MALFORMED_FORWARD_PAYLOAD, payload.bits() == 1 && payload.refs() == 1);
    }
}

/// Returns the decimals cell of on-chain metadata. Rejects anything that is
/// not TEP-64 on-chain content with a decimals field, so the metadata can
/// never be moved to a hosted file.
inline fun decimalsOf(content: Cell): Cell {
    let raw = content.beginParse();
    throwUnless(ERR_INVALID_CONTENT, raw.bits() >= 9 && raw.preloadUint(8) == 0);
    let decimals = OnchainContent.fromCell(content).fields.get(DECIMALS_KEY);
    throwUnless(ERR_INVALID_CONTENT, decimals != null);
    return decimals!!;
}
