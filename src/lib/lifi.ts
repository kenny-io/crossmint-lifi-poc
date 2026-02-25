import {
  createConfig,
  EVM,
  getRoutes,
  executeRoute,
  type Route,
  type RouteExtended,
  type RoutesRequest,
} from "@lifi/sdk";
import { base, arbitrum } from "viem/chains";
import type { Chain } from "viem";
import type { CrossmintWalletAdapter } from "./crossmint";
import { buildCrossmintViemClient } from "./viemTransport";

const SUPPORTED_CHAINS: Chain[] = [base, arbitrum];

/**
 * Configure the LI.FI SDK with a Crossmint wallet adapter as the EVM signer.
 * Must be called before getRoutes() / executeRoute().
 */
export function configureLifi(wallet: CrossmintWalletAdapter) {
  createConfig({
    integrator: process.env.LIFI_INTEGRATOR ?? "crossmint-lifi-poc",
    ...(process.env.LIFI_API_KEY ? { apiKey: process.env.LIFI_API_KEY } : {}),
    providers: [
      EVM({
        getWalletClient: async () =>
          buildCrossmintViemClient(wallet, base),

        switchChain: async (chainId: number) => {
          const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId);
          if (!chain) {
            throw new Error(
              `Chain ${chainId} not supported. Add it to SUPPORTED_CHAINS in lifi.ts`
            );
          }
          return buildCrossmintViemClient(wallet, chain);
        },
      }),
    ],
  });
}

export interface RouteParams {
  fromChainId: number;
  fromToken: string;
  toChainId: number;
  toToken: string;
  /** Amount in smallest unit (e.g. 1 USDC = "1000000") */
  fromAmount: string;
  fromAddress: string;
  slippage?: number;
}

/**
 * Fetch the best route from LI.FI for a cross-chain swap/bridge.
 * Returns null if no route is available.
 */
export async function getBestRoute(
  params: RouteParams
): Promise<Route | null> {
  const routeRequest: RoutesRequest = {
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromTokenAddress: params.fromToken,
    toTokenAddress: params.toToken,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    options: {
      // RECOMMENDED prefers well-tested bridges (Stargate, Across, etc.)
      // over fastest-but-fragile options like GasZip.
      order: "RECOMMENDED",
      slippage: params.slippage ?? 0.005, // 0.5% default
      // Deny GasZip bridge: its route requires two separate transactions
      // (DEX swap USDC→ETH, then bridge ETH). Crossmint simulates each
      // transaction independently, so the bridge simulation runs without
      // the ETH received from the swap — causing an execution_reverted
      // (selector 0xe52970aa) on any wallet that holds only USDC.
      // RECOMMENDED routes (e.g. Relay) handle USDC→ETH in a single
      // cross-chain transaction, which simulates and executes correctly.
      bridges: { deny: ["gasZipBridge"] },
    },
  };

  const result = await getRoutes(routeRequest);

  if (!result.routes || result.routes.length === 0) {
    return null;
  }

  return result.routes[0];
}

export interface RouteExecutionOptions {
  /** Called on each step status update */
  onUpdate?: (message: string, step: number, totalSteps: number) => void;
  /** Called when execution is complete */
  onComplete?: (txHashes: string[]) => void;
}

/**
 * Execute a LI.FI route using the Crossmint wallet as signer.
 *
 * Key: uses the custom viem transport so `eth_sendTransaction` is routed
 * through Crossmint's custodial signer API, not a local private key.
 *
 * `disableMessageSigning: true` prevents LI.FI from trying EIP-712 permit
 * signatures, which Crossmint smart wallets don't support natively.
 */
export async function executeBridgeRoute(
  route: Route,
  options: RouteExecutionOptions = {}
): Promise<RouteExtended> {
  const { onUpdate, onComplete } = options;

  let lastStatusKey = "";

  const result = await executeRoute(route, {
    // Critical for smart contract wallets: forces the classic ERC-20 approve()
    // flow instead of permit signatures (EIP-2612 / EIP-712)
    disableMessageSigning: true,

    updateRouteHook(updatedRoute) {
      if (!onUpdate) return;

      const steps = updatedRoute.steps;
      const statuses = steps.map((s) => s.execution?.status ?? "PENDING");
      const statusKey = statuses.join(",");

      // Only emit when something actually changed
      if (statusKey === lastStatusKey) return;
      lastStatusKey = statusKey;

      const currentStep =
        steps.findIndex(
          (s) =>
            s.execution?.status === "ACTION_REQUIRED" ||
            s.execution?.status === "PENDING"
        ) + 1;

      const message = statuses
        .map((s, i) => `Step ${i + 1}: ${s}`)
        .join(" | ");
      onUpdate(message, Math.max(currentStep, 1), steps.length);
    },
  });

  if (onComplete) {
    const txHashes = result.steps
      .flatMap((s) => s.execution?.process ?? [])
      .map((p) => p.txHash)
      .filter((h): h is string => !!h);
    onComplete(txHashes);
  }

  return result;
}

/**
 * Format a route for human-readable display.
 */
export function formatRoute(route: Route): string {
  const fromToken = route.fromToken;
  const toToken = route.toToken;
  const fromAmount = (
    Number(route.fromAmount) / Math.pow(10, fromToken.decimals)
  ).toFixed(6);
  const toAmount = (
    Number(route.toAmountMin) / Math.pow(10, toToken.decimals)
  ).toFixed(6);

  const steps = route.steps
    .map(
      (s, i) =>
        `  ${i + 1}. ${s.type.toUpperCase()} via ${s.toolDetails?.name ?? s.tool}`
    )
    .join("\n");

  const gasCostUsd = route.gasCostUSD ?? "unknown";
  const feeCostUsd = route.steps
    .flatMap((s) => s.estimate.feeCosts ?? [])
    .reduce((sum, f) => sum + Number(f.amountUSD ?? 0), 0)
    .toFixed(2);

  return [
    `From: ${fromAmount} ${fromToken.symbol} on chain ${route.fromChainId}`,
    `To:   ~${toAmount} ${toToken.symbol} on chain ${route.toChainId}`,
    `Gas cost: ~$${gasCostUsd}`,
    `Protocol fees: ~$${feeCostUsd}`,
    `Steps (${route.steps.length}):`,
    steps,
  ].join("\n");
}
