# Crossmint × LI.FI — Cross-Chain Bridge POC

A proof of concept demonstrating that **Crossmint embedded smart wallets** can execute cross-chain swaps and bridges using the **LI.FI SDK**, without the dApp ever handling private keys.

**Demo flow:** Bridge USDC on Base → ETH on Arbitrum using a Crossmint API-key custodial smart wallet, with a live Next.js UI and a set of runnable CLI scripts.

---

## How It Works

The core challenge: LI.FI expects a standard viem `WalletClient`, but Crossmint smart wallets sign transactions through a custodial REST API, not a local private key.

The solution is a **custom viem transport** (`src/lib/viemTransport.ts`) that acts as an adapter between the two:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Application                          │
│                                                                  │
│  ┌──────────────┐    ┌────────────────────────────────────────┐  │
│  │   LI.FI SDK  │───▶│      Custom viem Transport             │  │
│  │              │    │  (src/lib/viemTransport.ts)            │  │
│  │  getRoutes() │    │                                        │  │
│  │ executeRoute │    │  eth_sendTransaction ──▶ Crossmint API │  │
│  └──────────────┘    │  all other calls    ──▶ Public RPC     │  │
│                      └────────────────────────────────────────┘  │
└─────────────────────────────────────┬───────────────────────────┘
                                      │
                           ┌──────────▼──────────┐
                           │   Crossmint REST API  │
                           │   ERC-4337 Smart      │
                           │   Wallet              │
                           │   API-key signer      │
                           └─────────────────────┘
```

**Server vs. browser split:**
- **Wallet operations** (create, sign, send) — server-side only via Crossmint REST API. The `api-key` signer type means the server key *is* the signing authority; there is no browser-accessible path for this signer.
- **Balance reads** — browser-safe, read directly from each chain's public RPC via viem. No Crossmint auth required.

---

## Prerequisites

- **Node.js 20+**
- **Crossmint server API key** (`sk_` prefix) — get one at [console.crossmint.com](https://console.crossmint.com)
  - Required scopes: `wallets.create`, `wallets.read`, `wallets:transactions.create`
- A small amount of USDC on Base to fund the demo wallet (see [Step 2](#step-2--fund-the-wallet))

---

## Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd crossmint-lifi-poc

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Add your CROSSMINT_SERVER_API_KEY to .env
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `CROSSMINT_SERVER_API_KEY` | **Yes** | Server key (`sk_` prefix) from console.crossmint.com. Used by both CLI scripts and Next.js API routes. |
| `CROSSMINT_WALLET_LOCATOR` | No | Defaults to `userId:demo-user:evm:smart`. Format: `userId:<id>:evm:smart` |
| `LIFI_INTEGRATOR` | No | Defaults to `crossmint-lifi-poc`. Shown in LI.FI analytics. |
| `LIFI_API_KEY` | No | Optional. Unlocks higher rate limits on LI.FI's API. |

> **Why does the UI need a server key?**
> This POC uses the `api-key` custodial signer. With this signer, Crossmint signs UserOperations on your behalf using your server key — there is no client-accessible signing endpoint. All wallet writes go through Next.js API routes server-side. Balance reads bypass Crossmint entirely and go straight to the chain.

---

## CLI Scripts

### Step 1 — Create wallet

```bash
npm run script:create-wallet
```

Prints the wallet address and explorer links for Base and Arbitrum. The same address is valid on every EVM chain (ERC-4337 CREATE2 deterministic deployment).

### Step 2 — Fund the wallet

Send at least **$2 of USDC** to the printed address on **Base network**. You can use:
- Coinbase (set the network to Base)
- Any Base-compatible faucet or bridge

### Step 3 — Check balance

```bash
npm run script:get-balance
```

Reads USDC and ETH balances from Base and Arbitrum in parallel.

### Step 4 — Execute bridge

```bash
npm run script:bridge
```

Bridges USDC from Base to ETH on Arbitrum via LI.FI's best available route. Streams live step status until completion, then prints transaction links.

### Step 5 — Withdraw funds

```bash
npm run script:withdraw -- 0xYourDestinationAddress
```

Sends all assets from the smart wallet to an external address:
- USDC on Base → sent in full via ERC-20 `transfer()`
- ETH on Arbitrum → sent minus a 0.0002 ETH gas reserve

---

## Frontend Demo

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The UI has five sections:

| # | Section | What it does |
|---|---|---|
| 1 | **Smart Wallet** | Loads (or creates) the Crossmint wallet. Address is cached in `localStorage` and restored on page reload. |
| 2 | **Token Balances** | Reads ETH + USDC balances across Base and Arbitrum directly from each chain — no Crossmint auth needed. |
| 3 | **Withdraw Funds** | Sends all smart wallet assets to an address you specify. Button is disabled until a non-zero balance exists and a valid destination is entered. |
| 4 | **Bridge & Swap** | Bridges Base USDC → Arbitrum ETH via LI.FI. Streams live status updates as each step progresses. |
| 5 | **Result** | Shows the final transaction hashes with block explorer links. |

### Multiple wallets

The UI supports spinning up fresh wallets for repeated testing without touching `.env`. Click **New Wallet** in the Smart Wallet card to create a wallet under a new `userId`. Each wallet's address and user ID are persisted in `localStorage` so the session survives page reloads.

---

## Repository Structure

```
crossmint-lifi-poc/
├── .env.example
├── package.json
├── tsconfig.json
├── next.config.ts
│
├── src/lib/
│   ├── crossmint.ts          # Crossmint REST API — wallet get/create, tx submit/poll
│   ├── crossmint-client.ts   # Browser-safe on-chain balance reads via viem (no auth)
│   ├── viemTransport.ts      # Custom viem transport — core LI.FI × Crossmint adapter
│   ├── lifi.ts               # LI.FI SDK config, route fetching, route execution
│   └── tokens.ts             # Token addresses, chain IDs, block explorer helpers
│
├── scripts/
│   ├── createWallet.ts       # CLI: print wallet address
│   ├── getBalance.ts         # CLI: read balances on Base + Arbitrum
│   ├── bridgeAndSwap.ts      # CLI: full bridge demo with live status
│   └── withdraw.ts           # CLI: send all funds to an external address
│
└── app/
    ├── layout.tsx
    ├── page.tsx              # Main UI (wallet · balances · withdraw · bridge · result)
    ├── globals.css           # LI.FI brand tokens, ambient orbs, glass styles
    └── api/
        ├── wallet/route.ts   # GET /api/wallet — returns address + explorer URLs
        ├── balance/route.ts  # GET /api/balance — returns token balances
        ├── bridge/route.ts   # POST /api/bridge — SSE: LI.FI route execution
        └── withdraw/route.ts # POST /api/withdraw — SSE: send USDC + ETH out
```

---

## Technical Notes

### Custom viem transport

LI.FI needs a standard viem `WalletClient` to send transactions. The `buildCrossmintViemClient()` function in `viemTransport.ts` wraps a `CrossmintWalletAdapter` in a custom transport that routes by method:

- `eth_sendTransaction` → `wallet.sendTransaction()` (Crossmint REST API, returns on-chain hash after polling)
- Everything else → `fetch(chain.rpcUrls.default.http[0], ...)` (public RPC)

The result is a `WalletClient` LI.FI can use without any modification.

### Why the Crossmint SDK isn't used for server operations

Both Crossmint SDK methods hit environment guards:
- `getOrCreateWallet()` — throws "can only be called from client-side code"
- `getWallet()` — throws "not supported on client side"

`crossmint.ts` uses the underlying REST API (`api/2025-06-09/wallets`) directly, which has no such restrictions and works in Node.js, Next.js server routes, and edge runtimes.

### ERC-20 approve vs. EIP-712 permit

LI.FI can use EIP-2612 permit signatures to save gas on approvals. Smart contract wallets don't support this. Setting `disableMessageSigning: true` in `executeRoute()` forces the classic `approve()` + `transferFrom()` flow, which works universally.

### Chain switching

Multi-step LI.FI routes can hop across chains. The `switchChain` handler in `configureLifi()` returns a new `WalletClient` for the target chain while still routing `eth_sendTransaction` through Crossmint — so the wallet adapter stays in control regardless of which chain LI.FI is executing on.

### SSE streaming

Both `/api/bridge` and `/api/withdraw` use Server-Sent Events to push live status to the UI without polling. The bridge route deduplicates `updateRouteHook` callbacks, emitting a new SSE event only when the step status actually changes.

### Wallet locator format

The locator format changed in Crossmint's `2025-06-09` API:

| Old (invalid) | Current |
|---|---|
| `userId:demo-user:evm-smart-wallet` | `userId:demo-user:evm:smart` |

Format: `userId:<id>:<chainType>[:<walletType>]`

---

## Extending

### Add more chains

Add the viem chain and its Crossmint string name in two places:

```typescript
// src/lib/viemTransport.ts
const CHAIN_ID_TO_CROSSMINT: Record<number, string> = {
  8453: "base",
  42161: "arbitrum",
  137: "polygon",   // ← add here
};

// src/lib/lifi.ts
import { polygon } from "viem/chains";
const SUPPORTED_CHAINS: Chain[] = [base, arbitrum, polygon]; // ← and here
```

### Add more tokens to balance display

Add the token to `TOKENS_BY_CHAIN` in `src/lib/crossmint-client.ts`:

```typescript
[polygon.id]: [
  { address: "0x3c499c...", symbol: "USDC", name: "USD Coin", decimals: 6 },
],
```

### Run scripts on a schedule

The CLI scripts are plain TypeScript with no side effects beyond their stated function. They can be triggered by cron, webhooks, or any automation tool that can run `npx tsx`.

---

## Known Limitations

| Limitation | Notes |
|---|---|
| Mainnet only | Crossmint testnet smart wallets require a different signer setup; this POC targets mainnet Base and Arbitrum |
| API-key signer only | Uses custodial server-side signing; passkey / OIDC signers require the Crossmint client-side SDK and a different architecture |
| No retry logic | Production use should add exponential backoff on Crossmint polling and LI.FI requests |
| LI.FI free-tier rate limits | Add `LIFI_API_KEY` to `.env` for higher limits |
| Gas reserve is fixed | The 0.0002 ETH gas reserve in the withdraw flow is a rough constant; real gas costs vary by network conditions |
