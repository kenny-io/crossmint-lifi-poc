export const TOKENS = {
  // USDC on Base (native USDC, not bridged)
  USDC_BASE: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",

  // USDC on Arbitrum (native USDC)
  USDC_ARBITRUM: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",

  // Native ETH (used on any chain)
  ETH_NATIVE: "0x0000000000000000000000000000000000000000",

  // WETH on Base
  WETH_BASE: "0x4200000000000000000000000000000000000006",

  // WETH on Arbitrum
  WETH_ARBITRUM: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
} as const;

export type TokenKey = keyof typeof TOKENS;

export const CHAIN_IDS = {
  BASE: 8453,
  ARBITRUM: 42161,
  ETHEREUM: 1,
} as const;

export const EXPLORER_URLS = {
  [CHAIN_IDS.BASE]: "https://basescan.org",
  [CHAIN_IDS.ARBITRUM]: "https://arbiscan.io",
  [CHAIN_IDS.ETHEREUM]: "https://etherscan.io",
} as const;

export function getExplorerTxUrl(chainId: number, txHash: string): string {
  const base =
    EXPLORER_URLS[chainId as keyof typeof EXPLORER_URLS] ??
    "https://etherscan.io";
  return `${base}/tx/${txHash}`;
}

export function getExplorerAddressUrl(
  chainId: number,
  address: string
): string {
  const base =
    EXPLORER_URLS[chainId as keyof typeof EXPLORER_URLS] ??
    "https://etherscan.io";
  return `${base}/address/${address}`;
}
