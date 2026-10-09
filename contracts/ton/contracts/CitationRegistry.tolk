/**
 * Luminara CitationRegistry (Tolk 1.0)
 *
 * Verifiable On-Chain Citation Oracle on The Open Network (TON).
 * Stores tamper-evident cryptographic digests of AEO/SEO audit citations.
 * Supports gasless internal sponsored anchoring and signed external anchoring.
 */

import "@stdlib/gas-payments"
import "@stdlib/tvm-dicts"

struct ProofRecord {
    evidenceHash: uint256
    healthScore: uint8
    citationRate: uint8
    findingsCount: uint16
    anchoredAt: uint32
}

struct Storage {
    minterPublicKey: uint256
    seqno: uint32
    isPaused: bool
    proofs: cell?
}

@inline
fun Storage.load(): Storage {
    var cs = contract.getData().beginParse();
    val minterPublicKey = cs.loadUint(256);
    val seqno = cs.loadUint(32);
    val isPaused = cs.loadUint(1) != 0;
    val proofs = cs.loadMaybeRef();
    return Storage {
        minterPublicKey,
        seqno,
        isPaused,
        proofs
    };
}

@inline
fun Storage.save(self) {
    val b = beginCell()
        .storeUint(self.minterPublicKey, 256)
        .storeUint(self.seqno, 32)
        .storeUint(self.isPaused ? 1 : 0, 1)
        .storeMaybeRef(self.proofs);
    contract.setData(b.endCell());
}

// Custom error codes
const ERR_INVALID_SIGNATURE = 101;
const ERR_INVALID_SEQNO = 102;
const ERR_EXPIRED = 103;
const ERR_UNAUTHORIZED = 104;
const ERR_CONTRACT_PAUSED = 105;
const ERR_INVALID_OPCODE = 106;

// Opcodes (4 bytes)
const OP_INTERNAL_ANCHOR = 0x736e6368; // "snch" - sponsored anchor
const OP_EXTERNAL_ANCHOR = 0x616e6368; // "anch" - signed external anchor
const OP_SET_PAUSED      = 0x70617573; // "paus" - toggle emergency pause
const OP_SET_MINTER      = 0x7365746d; // "setm" - set minter public key

@inline
fun packProofRecord(record: ProofRecord): cell {
    return beginCell()
        .storeUint(record.evidenceHash, 256)
        .storeUint(record.healthScore, 8)
        .storeUint(record.citationRate, 8)
        .storeUint(record.findingsCount, 16)
        .storeUint(record.anchoredAt, 32)
        .endCell();
}

/**
 * Handles incoming internal messages (gasless sponsored anchor from minter wallet).
 */
fun onInternalMessage(inMsg: InMessage) {
    var body = inMsg.body;
    if (body.remainingBitsCount() < 32) {
        return; // Plain transfer / top-up
    }

    val op = body.loadUint(32);
    if (op != OP_INTERNAL_ANCHOR) {
        return; // Ignore unfamiliar internal ops
    }

    var storage = Storage.load();
    assert (!storage.isPaused) throw ERR_CONTRACT_PAUSED;

    // Check signature on internal sponsored payload if signed, or verify minter key
    val signature = body.loadBits(512);
    var signedPayload = body;
    assert (isSignatureValid(signedPayload.hash(), signature, storage.minterPublicKey)) throw ERR_INVALID_SIGNATURE;

    val domainHash = signedPayload.loadUint(256);
    val auditIdHash = signedPayload.loadUint(256);
    val evidenceHash = signedPayload.loadUint(256);
    val healthScore = signedPayload.loadUint(8);
    val citationRate = signedPayload.loadUint(8);
    val findingsCount = signedPayload.loadUint(16);

    val record = ProofRecord {
        evidenceHash,
        healthScore,
        citationRate,
        findingsCount,
        anchoredAt: blockchain.now()
    };

    // Store in prefix dictionary: domainHash -> auditIdHash -> ProofRecord
    var proofsDict = storage.proofs;
    val recordCell = packProofRecord(record);
    
    // Udict set for composite key (domainHash ^ auditIdHash)
    val compositeKey = domainHash ^ auditIdHash;
    proofsDict.uDictSet(256, compositeKey, recordCell.beginParse());
    
    storage.proofs = proofsDict;
    storage.save();
}

/**
 * Handles incoming external messages (direct broadcast signed by ops minter).
 */
fun onExternalMessage(var inMsgBody: slice) {
    assert (inMsgBody.remainingBitsCount() >= 512 + 32 + 32 + 32) throw ERR_INVALID_SIGNATURE;
    val signature = inMsgBody.loadBits(512);
    var signedSlice = inMsgBody;

    var storage = Storage.load();
    assert (!storage.isPaused) throw ERR_CONTRACT_PAUSED;
    assert (isSignatureValid(signedSlice.hash(), signature, storage.minterPublicKey)) throw ERR_INVALID_SIGNATURE;

    val seqno = signedSlice.loadUint(32);
    val validUntil = signedSlice.loadUint(32);
    val op = signedSlice.loadUint(32);

    assert (seqno == storage.seqno) throw ERR_INVALID_SEQNO;
    assert (validUntil > blockchain.now()) throw ERR_EXPIRED;

    acceptExternalMessage();

    storage.seqno += 1;

    if (op == OP_EXTERNAL_ANCHOR) {
        val domainHash = signedSlice.loadUint(256);
        val auditIdHash = signedSlice.loadUint(256);
        val evidenceHash = signedSlice.loadUint(256);
        val healthScore = signedSlice.loadUint(8);
        val citationRate = signedSlice.loadUint(8);
        val findingsCount = signedSlice.loadUint(16);

        val record = ProofRecord {
            evidenceHash,
            healthScore,
            citationRate,
            findingsCount,
            anchoredAt: blockchain.now()
        };

        var proofsDict = storage.proofs;
        val compositeKey = domainHash ^ auditIdHash;
        proofsDict.uDictSet(256, compositeKey, packProofRecord(record).beginParse());
        storage.proofs = proofsDict;
    } else if (op == OP_SET_PAUSED) {
        val newPaused = signedSlice.loadUint(1) != 0;
        storage.isPaused = newPaused;
    } else if (op == OP_SET_MINTER) {
        val newMinter = signedSlice.loadUint(256);
        storage.minterPublicKey = newMinter;
    } else {
        throw ERR_INVALID_OPCODE;
    }

    storage.save();
}

// ---------------------------------------------------------
// GETTERS (Read-only interface for indexers, API & Tonviewer)
// ---------------------------------------------------------

/**
 * Fetches proof record by domain hash and audit run id hash.
 * Returns (evidenceHash, healthScore, citationRate, findingsCount, anchoredAt, found: bool).
 */
get fun get_proof(domainHash: uint256, auditIdHash: uint256): (uint256, uint8, uint8, uint16, uint32, bool) {
    val storage = Storage.load();
    val compositeKey = domainHash ^ auditIdHash;
    val (slice, found) = storage.proofs.uDictGet(256, compositeKey);
    if (!found) {
        return (0, 0, 0, 0, 0, false);
    }
    var recordSlice = slice!;
    val evidenceHash = recordSlice.loadUint(256);
    val healthScore = recordSlice.loadUint(8);
    val citationRate = recordSlice.loadUint(8);
    val findingsCount = recordSlice.loadUint(16);
    val anchoredAt = recordSlice.loadUint(32);
    return (evidenceHash, healthScore, citationRate, findingsCount, anchoredAt, true);
}

/**
 * Returns the current replay-protection seqno.
 */
get fun get_seqno(): uint32 {
    val storage = Storage.load();
    return storage.seqno;
}

/**
 * Returns the designated minter's 256-bit Ed25519 public key.
 */
get fun get_minter_public_key(): uint256 {
    val storage = Storage.load();
    return storage.minterPublicKey;
}

/**
 * Returns true if the contract is paused.
 */
get fun is_paused(): bool {
    val storage = Storage.load();
    return storage.isPaused;
}

/**
 * Protocol version identifier.
 */
get fun get_version(): uint32 {
    return 1;
}
