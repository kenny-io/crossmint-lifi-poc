import { createWalletClient, custom, type Chain } from "viem";
import type { CrossmintWalletAdapter } from "./crossmint";

// ── Shared read-path helper ────────────────────────────────────────────────────

async function forwardToRpc(
  rpcUrl: string,
  method: string,
  params: unknown
): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  if (json.error) {
    throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
  }
  return json.result;
}

// Map viem chain IDs to Crossmint chain name strings
const CHAIN_ID_TO_CROSSMINT: Record<number, string> = {
  8453: "base",
  42161: "arbitrum",
  1: "ethereum",
  137: "polygon",
  10: "optimism",
};

/**
 * Builds a viem WalletClient that routes write operations through Crossmint's
 * custodial signer and forwards read calls to the chain's public RPC.
 *
 * This is the core integration piece: LI.FI SDK expects a standard viem
 * WalletClient, but we need `eth_sendTransaction` to go through Crossmint
 * so the smart wallet signs and broadcasts the transaction.
 */
export function buildCrossmintViemClient(wallet: CrossmintWalletAdapter, chain: Chain) {
  const crossmintChain = CHAIN_ID_TO_CROSSMINT[chain.id];
  if (!crossmintChain) {
    throw new Error(
      `Chain ID ${chain.id} (${chain.name}) is not mapped to a Crossmint chain name. Add it to CHAIN_ID_TO_CROSSMINT in viemTransport.ts`
    );
  }

  return createWalletClient({
    account: wallet.address as `0x${string}`,
    chain,
    transport: custom({
      async request({ method, params }) {
        // ── Write path: intercept send transaction ──────────────────────────
        if (method === "eth_sendTransaction") {
          const [tx] = params as [
            { to: string; data?: string; value?: string; gas?: string }
          ];

          // CrossmintWalletAdapter.sendTransaction expects value as bigint
          const valueBigInt = tx.value ? BigInt(tx.value) : undefined;

          const result = await wallet.sendTransaction({
            to: tx.to,
            data: tx.data as `0x${string}` | undefined,
            value: valueBigInt,
            crossmintChain,
          });

          return result.hash;
        }

        // ── Read path: forward to public RPC ────────────────────────────────
        const rpcUrl = chain.rpcUrls.default.http[0];
        if (!rpcUrl) throw new Error(`No RPC URL for chain ${chain.name}`);
        return forwardToRpc(rpcUrl, method, params);
      },
    }),
  });
}
