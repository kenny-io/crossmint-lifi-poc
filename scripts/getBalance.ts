/**
 * getBalance.ts
 *
 * Fetches and displays token balances for the Crossmint wallet on Base.
 *
 * Usage:
 *   npm run script:get-balance
 *   # or
 *   npx tsx scripts/getBalance.ts
 */

import "dotenv/config";
import { getOrCreateWallet, getWalletBalances } from "../src/lib/crossmint";
import { getExplorerAddressUrl, CHAIN_IDS } from "../src/lib/tokens";

async function main() {
  console.log("💰 Fetching wallet balances...\n");

  const wallet = await getOrCreateWallet();
  const address = wallet.address;

  console.log(`Wallet: ${address}`);
  console.log(
    `Explorer: ${getExplorerAddressUrl(CHAIN_IDS.BASE, address)}\n`
  );

  const balances = await getWalletBalances(address);

  if (balances.length === 0) {
    console.log("⚠️  No token balances found.");
    console.log("   Fund this wallet with USDC on Base to run the bridge demo.");
    return;
  }

  console.log("Balances on Base:");
  console.log("─".repeat(60));

  let hasNonZero = false;
  for (const token of balances) {
    const amount = Number(token.amount).toFixed(
      token.decimals > 6 ? 6 : token.decimals
    );
    const usdStr =
      token.usdValue !== "0"
        ? ` (~$${Number(token.usdValue).toFixed(2)})`
        : "";

    if (Number(token.amount) > 0) {
      hasNonZero = true;
      console.log(
        `  ${token.symbol.padEnd(10)} ${amount.padStart(15)}${usdStr}`
      );
    }
  }

  if (!hasNonZero) {
    console.log("  All balances are zero.");
    console.log(
      "\n  Fund this wallet with USDC on Base to run the bridge demo."
    );
  }

  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("❌ Error:", err.message ?? err);
  process.exit(1);
});
