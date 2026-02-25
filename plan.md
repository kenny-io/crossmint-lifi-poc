# Implementation Plan: Crossmint <> LI.FI POC

## Context

Build a public GitHub POC demonstrating that Crossmint embedded wallets can execute cross-chain swaps and bridges using LI.FI. Target: mainnet (Base → Arbitrum), using Crossmint's API-key custodial signer. Output: CLI scripts + Next.js demo UI + documentation.

---

## Repository Structure

```
crossmint-lifi-poc/
├── README.md
├── package.json
├── tsconfig.json
├── next.config.ts
├── .env.example
├── .gitignore
├── src/
│   └── lib/
│       ├── crossmint.ts        # Crossmint SDK init + wallet helpers
│       ├── viemTransport.ts    # ★ Custom viem transport (key integration piece)
│       └── lifi.ts             # LI.FI SDK config + route/execute helpers
├── scripts/
│   ├── createWallet.ts
│   ├── getBalance.ts
│   └── bridgeAndSwap.ts
└── app/                        # Next.js App Router
    ├── layout.tsx
    ├── page.tsx                # Main demo UI
    ├── globals.css
    └── api/
        ├── wallet/route.ts     # GET → get/create wallet
        ├── balance/route.ts    # GET ?address=0x → token balances
        └── bridge/route.ts     # POST → execute bridge+swap
```

---

## Step 1: Initialize Repo and Tooling

```bash
git init
```

**`package.json`** — dependencies:
- `@crossmint/wallets-sdk` — Crossmint wallet SDK
- `@lifi/sdk` — LI.FI route + execution SDK
- `viem` ^2.x — required by LI.FI SDK; also used for custom transport
- `next` ^15, `react` ^19, `react-dom` ^19 — Next.js frontend
- `dotenv` — env var loading in scripts

Dev deps: `typescript`, `tsx` (run TS scripts directly), `@types/node`, `@types/react`, `tailwindcss`

**`tsconfig.json`**: target ES2022, moduleResolution bundler, path alias `@/*` → `./src/*`

**`.env.example`**:
```
CROSSMINT_SERVER_API_KEY=
CROSSMINT_WALLET_LOCATOR=userId:demo-user:evm-smart-wallet
LIFI_INTEGRATOR=crossmint-lifi-poc
# Optional: fund this address before running the demo
# LIFI_API_KEY=
```

**`.gitignore`**: node_modules, .env, .next, dist

---

## Step 2: `src/lib/crossmint.ts` — Wallet Service

```typescript
import { CrossmintWallets, createCrossmint, EVMWallet } from "@crossmint/wallets-sdk"

export function createCrossmintClient() {
  return createCrossmint({ apiKey: process.env.CROSSMINT_SERVER_API_KEY! })
}

export async function getOrCreateWallet(walletLocator?: string) {
  const crossmint = createCrossmintClient()
  const wallets = CrossmintWallets.from(crossmint)
  const wallet = await wallets.getOrCreateWallet({
    chain: "base",
    signer: { type: "api-key" },
  })
  return { wallet, evmWallet: EVMWallet.from(wallet) }
}

export async function getWalletBalances(address: string, chain: string) {
  // Use Crossmint REST API: GET /wallets/{locator}/balances
  // Returns token list with amount, symbol, usdValue
}
```

---

## Step 3: `src/lib/viemTransport.ts` — Custom Viem Transport (Critical Piece)

This is the core integration. LI.FI requires a viem `WalletClient`; this module wraps Crossmint's EVMWallet into one.

```typescript
import { createWalletClient, custom, type Chain } from "viem"
import type { EVMWallet } from "@crossmint/wallets-sdk"

export function buildCrossmintViemClient(evmWallet: EVMWallet, chain: Chain) {
  return createWalletClient({
    account: evmWallet.address as `0x${string}`,
    chain,
    transport: custom({
      async request({ method, params }) {
        if (method === "eth_sendTransaction") {
          const [tx] = params as [{ to: string; data: string; value?: string }]
          // Route through Crossmint's custodial signer
          const result = await evmWallet.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ?? "0",
            chain: chain.name.toLowerCase(),
          })
          return result.txHash
        }
        // Forward read calls to the chain's public RPC
        const rpcUrl = chain.rpcUrls.default.http[0]
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        })
        return (await res.json()).result
      },
    }),
  })
}
```

Key detail: `eth_sendTransaction` is intercepted → goes to Crossmint. All other JSON-RPC calls (reads) are forwarded to the chain's public RPC URL.

---

## Step 4: `src/lib/lifi.ts` — LI.FI Configuration + Route Execution

```typescript
import { createConfig, EVM, getRoutes, executeRoute, ChainId } from "@lifi/sdk"
import { base, arbitrum } from "viem/chains"
import type { Chain } from "viem"
import { buildCrossmintViemClient } from "./viemTransport"
import type { EVMWallet } from "@crossmint/wallets-sdk"

const SUPPORTED_CHAINS = [base, arbitrum]

export function configureLifi(evmWallet: EVMWallet) {
  createConfig({
    integrator: process.env.LIFI_INTEGRATOR ?? "crossmint-lifi-poc",
    providers: [
      EVM({
        getWalletClient: async () => buildCrossmintViemClient(evmWallet, base),
        switchChain: async (chainId: number) => {
          const chain = SUPPORTED_CHAINS.find(c => c.id === chainId) as Chain
          return buildCrossmintViemClient(evmWallet, chain)
        },
      }),
    ],
  })
}

export async function getBestRoute(params: {
  fromChainId: number
  fromToken: string
  toChainId: number
  toToken: string
  fromAmount: string
  fromAddress: string
}) {
  const result = await getRoutes({
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromTokenAddress: params.fromToken,
    toTokenAddress: params.toToken,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    options: { order: "FASTEST", slippage: 0.005 },
  })
  return result.routes[0] ?? null
}

export async function executeBridgeRoute(
  route: Route,
  onUpdate: (status: string) => void
) {
  return executeRoute(route, {
    updateRouteHook(r) {
      const statuses = r.steps.map(s => s.execution?.status ?? "pending")
      onUpdate(statuses.join(" → "))
    },
    // Smart contract wallets can't sign EIP-712 permits; fall back to approve()
    disableMessageSigning: true,
  })
}
```

Token addresses (constants file `src/lib/tokens.ts`):
```typescript
export const TOKENS = {
  USDC_BASE: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  USDC_ARBITRUM: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  ETH_NATIVE: "0x0000000000000000000000000000000000000000",
}
```

---

## Step 5: CLI Scripts

### `scripts/createWallet.ts`
- Load env, call `getOrCreateWallet()`
- Print wallet address and explorer link
- Exit

### `scripts/getBalance.ts`
- Load env, get wallet
- Call Crossmint balance API for Base chain
- Print token list with amounts and USD values

### `scripts/bridgeAndSwap.ts`
- Load env, get wallet
- Print source balance (USDC on Base)
- Call `getBestRoute()` (Base USDC → Arbitrum ETH)
- Print route summary (estimated output, fees, steps)
- Call `executeBridgeRoute()` with live status logging
- Poll until complete
- Fetch and print destination balance (ETH on Arbitrum)
- Print explorer links for each step

Run via: `npx tsx scripts/bridgeAndSwap.ts`

---

## Step 6: Next.js API Routes

### `app/api/wallet/route.ts` — `GET`
Returns `{ address, explorerUrl }` for the configured wallet

### `app/api/balance/route.ts` — `GET ?chain=base`
Returns `{ tokens: [{ symbol, amount, usdValue }] }`

### `app/api/bridge/route.ts` — `POST`
Body: `{ fromChain, toChain, fromToken, toToken, amount }`

Uses Server-Sent Events (SSE) to stream execution progress:
```
event: status
data: {"step":1,"status":"PENDING","message":"Approving USDC..."}

event: complete
data: {"txHash":"0x...","explorerUrl":"..."}
```

---

## Step 7: Next.js Frontend (`app/page.tsx`)

Single-page UI with Tailwind CSS, four logical sections:

**Section 1 — Wallet**
- "Initialize Wallet" button → calls `GET /api/wallet`
- Displays address + Base/Arbitrum explorer link

**Section 2 — Balance**
- "Fetch Balance" button → calls `GET /api/balance?chain=base`
- Shows token list (symbol, amount, USD value)
- Shows "Fund this wallet" banner with the address if balance is 0

**Section 3 — Bridge & Swap**
- Pre-filled form: From Base USDC → To Arbitrum ETH
- Amount input
- "Get Quote" button → shows estimated output and fees
- "Execute Bridge" button → triggers SSE stream
- Live status log area (scrollable)

**Section 4 — Result**
- Transaction hash with explorer link
- Updated destination balance
- "Success" / "Failed" badge

---

## Step 8: README.md

Sections:
1. Overview + architecture diagram (ASCII)
2. Prerequisites (Node 20+, Crossmint API key, funded wallet)
3. Setup (clone, `npm install`, copy `.env.example`)
4. Running scripts (`npm run script:create-wallet`, etc.)
5. Running the frontend (`npm run dev`)
6. Demo walkthrough (step-by-step with screenshots)
7. Architecture notes (how the viem transport bridge works)
8. Extending (add chains, tokens, automate)

---

## Step 9: Initialize Git and Push

```bash
git init
git add .
git commit -m "Initial POC: Crossmint <> LI.FI cross-chain bridge integration"
git remote add origin <repo-url>
git push -u origin main
```

---

## Environment Variables Required

| Variable | Required | Description |
|---|---|---|
| `CROSSMINT_SERVER_API_KEY` | Yes | From console.crossmint.com, needs `wallets.*` scopes |
| `CROSSMINT_WALLET_LOCATOR` | No | e.g. `userId:demo:evm-smart-wallet` (auto-created if absent) |
| `LIFI_INTEGRATOR` | No | Defaults to `crossmint-lifi-poc` |
| `LIFI_API_KEY` | No | For higher rate limits |

---

## Known Technical Risks + Mitigations

| Risk | Mitigation |
|---|---|
| LI.FI calls `eth_signTypedData` (EIP-712) which Crossmint smart wallets don't support | Set `disableMessageSigning: true` in `executeRoute` options |
| Multi-step route requires chain switching mid-execution | `switchChain` handler in `EVM()` provider returns new `WalletClient` per chain |
| Crossmint `sendTransaction` may need polling for tx hash | EVMWallet.sendTransaction() resolves only after on-chain confirmation |
| Rate limits on LI.FI free tier | Add optional `LIFI_API_KEY` env var |

---

## Verification

1. Run `npx tsx scripts/createWallet.ts` → prints wallet address
2. Fund wallet with small USDC on Base (e.g. $2 via Coinbase)
3. Run `npx tsx scripts/getBalance.ts` → shows USDC balance
4. Run `npx tsx scripts/bridgeAndSwap.ts` → executes full bridge, shows result
5. Run `npm run dev` → open localhost:3000, click through the UI flow
6. Confirm ETH arrives on Arbitrum via explorer link
