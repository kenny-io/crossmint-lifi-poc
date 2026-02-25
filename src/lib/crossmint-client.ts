/**
 * Browser-safe helpers — no Crossmint authentication required.
 * Reads on-chain state directly via viem public clients.
 */

import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { base, arbitrum } from "viem/chains";
import type { Chain } from "viem";

export interface TokenBalance {
  symbol: string;
  name: string;
  /** Human-readable amount (already divided by decimals) */
  amount: string;
  decimals: number;
  usdValue: string;
  contractAddress: string;
  chainId: number;
  chainName: string;
}

interface WatchedToken {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
}

const TOKENS_BY_CHAIN: Record<number, WatchedToken[]> = {
  // Base
  [base.id]: [
    {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  ],
  // Arbitrum
  [arbitrum.id]: [
    {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  ],
};

async function getBalancesForChain(
  address: string,
  chain: Chain
): Promise<TokenBalance[]> {
  const client = createPublicClient({ chain, transport: http() });
  const addr = address as `0x${string}`;
  const results: TokenBalance[] = [];

  // Native ETH
  const ethBalance = await client.getBalance({ address: addr });
  results.push({
    symbol: "ETH",
    name: "Ether",
    amount: formatUnits(ethBalance, 18),
    decimals: 18,
    usdValue: "0",
    contractAddress: "0x0000000000000000000000000000000000000000",
    chainId: chain.id,
    chainName: chain.name,
  });

  // ERC-20 tokens for this chain
  for (const token of TOKENS_BY_CHAIN[chain.id] ?? []) {
    const balance = await client.readContract({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr],
    });
    results.push({
      symbol: token.symbol,
      name: token.name,
      amount: formatUnits(balance, token.decimals),
      decimals: token.decimals,
      usdValue: "0",
      contractAddress: token.address,
      chainId: chain.id,
      chainName: chain.name,
    });
  }

  return results;
}

/**
 * Read ETH + token balances across Base and Arbitrum in parallel.
 * No Crossmint authentication required — calls each chain's public RPC.
 * Returns only non-zero balances.
 */
export async function getOnChainBalances(address: string): Promise<TokenBalance[]> {
  const [baseBalances, arbitrumBalances] = await Promise.all([
    getBalancesForChain(address, base),
    getBalancesForChain(address, arbitrum),
  ]);

  return [...baseBalances, ...arbitrumBalances].filter(
    (b) => Number(b.amount) > 0
  );
}
