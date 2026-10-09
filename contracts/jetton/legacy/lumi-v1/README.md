# Luminara ($LUMI) - 10x Jetton & Tokenomics

Official in-house utility, governance, and real-yield currency for **Luminara Suite** and the **Search Oracle Agent** on The Open Network (TON).

---

## 1. Core Token Specifications

| Parameter | Specification | Invariant / Enforcement |
|---|---|---|
| **Token Name** | **Luminara** | Registered in TEP-64 metadata |
| **Token Ticker** | **$LUMI** | TEP-64 compliant |
| **Blockchain** | **The Open Network (TON)** | TEP-74 Fungible Jetton |
| **Total Fixed Supply** | **100,000,000 LUMI** | 100% fixed cap; `self.mintable = false` permanently locked upon initial mint. |
| **Decimals** | **9** | Standard TON Coin precision (`1 LUMI = 10^9 nanoLUMI`) |
| **Transfer Tax** | **3.0% (300 bps)** | Hard-coded maximum safety cap of **5.0%** (500 bps). |

---

## 2. 10x Transfer Tax & Profit Engine

Every on-chain transfer (P2P and DEX trading volume on Ston.fi / DeDust) automatically yields revenue for the protocol, stakers, and token holders:

```
Total Transfer Tax: 3.0% (300 bps)
├── 1.0% (100 bps) -> Permanent Auto-Burn (continual deflationary sink)
├── 1.0% (100 bps) -> Real Yield Staking Pool (distributed to veLUMI stakers)
└── 1.0% (100 bps) -> Protocol-Owned Liquidity (POL) & Treasury Growth
```

### Safety & Anti-Honeypot Invariants:
- **Hard Safety Cap:** The contract includes `const MAX_TAX_BPS: Int = 500`. Even the admin cannot raise the tax above 5.0%.
- **Zero Blacklists:** There are no address blacklists, freeze functions, or pause mechanisms.
- **Tax Exemptions:** Master contract deployment and whitelisted protocol staking pools are tax-exempt to avoid double-taxation on deposits or rewards claims.

---

## 3. Real Yield & Product Sinks

Unlike inflationary meme tokens, $LUMI is directly tied to the cashflow of Luminara Suite:

1. **25% Audit Discount:** Users paying for Instant Audits or enterprise citation reports in $LUMI receive a 25% discount. **50% of all LUMI paid for audits is permanently burned**.
2. **Real Cashflow Staking (`veLUMI`):** 30% of all fiat, TON, and Telegram Stars subscription revenue collected by Luminara Suite flows into a weekly staking rewards pool, paying real yield to stakers.
3. **Priority Model Routing:** Stakers bypass LLM rate limits and receive priority access to multi-engine reasoning (Groq, Claude, OpenAI, DeepSeek).
4. **Citation Oracle Anchor Staking:** Domain owners stake 500 LUMI to activate live hourly re-crawl monitoring and automated Telegram alert dispatching.

---

## 4. Administrator Permissions Audit

| Action | Admin Allowed? | Code Enforcement |
|---|---|---|
| **Initial 100M Supply Mint** | **YES (Once only)** | `MintInitialSupply` mints 100M to owner and sets `mintable = false`. |
| **Mint Additional Supply** | ❌ **FORBIDDEN** | Reverts with `"Minting is permanently locked"`. |
| **Raise Tax Above 5%** | ❌ **FORBIDDEN** | Hard-coded `require(msg.tax_rate_bps <= self.MAX_TAX_BPS)` (500 bps). |
| **Freeze or Blacklist User** | ❌ **FORBIDDEN** | Zero blacklist mapping in code. |
| **Confiscate User Balances** | ❌ **FORBIDDEN** | Only wallet owner can sign burns or transfers. |

---

## 5. Zero-Custody Security Model

> 🔒 **SECURITY GUARANTEE:**  
> This project **NEVER** requests, prompts for, or handles your Tonkeeper 24-word seed phrase or private key.
>
> Deployments use **Tonkeeper Universal Deep Links**. You review the exact contract address and transaction amount, then confirm securely inside Tonkeeper on your own mobile device.

---

## 6. Step-by-Step Testnet Deployment Guide

### Step 1: Switch Tonkeeper to Testnet
1. Open **Tonkeeper** on your phone.
2. Go to **Settings**, scroll down, and tap the version number **5 times** to unlock Developer Options.
3. Tap **Network** and switch from `Mainnet` to `Testnet`.
4. Copy your **Testnet Address** (starts with `kQ...` or `0Q...`).

### Step 2: Get Free Testnet TON
1. Open Telegram and search for official testnet faucet: [`@testgiver_ton_bot`](https://t.me/testgiver_ton_bot).
2. Send `/get` and paste your Tonkeeper testnet address to receive 1–2 testnet TON.

### Step 3: Run the Pre-Transaction Deployment Script
```bash
npx tsx contracts/jetton/scripts/deploy.ts --owner=<YOUR_TONKEEPER_TESTNET_ADDRESS> --testnet
```

### Step 4: Review Transaction Details & Approve
1. The terminal will pause and display:
   - **Token Name & Symbol:** Luminara ($LUMI)
   - **Fixed Supply:** 100,000,000 LUMI
   - **Transfer Tax:** 3.0% (1% burn, 1% stakers, 1% treasury)
   - **Gas Deposit:** 0.08 TON
2. Click the generated **Tonkeeper Universal Link** on your mobile device.
3. Tonkeeper will open displaying the exact recipient address and 0.08 TON deposit.
4. Tap **Confirm**.

### Step 5: Verify on Tonviewer
Once confirmed, view your token and supply on the explorer:
```
https://testnet.tonviewer.com/<YOUR_TESTNET_ADDRESS>
```
Your Luminara ($LUMI) Jetton is now officially live on the TON blockchain!
