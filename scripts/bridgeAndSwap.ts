/**
 * bridgeAndSwap.ts
 *
 * End-to-end demo: bridges USDC from Base to ETH on Arbitrum using LI.FI,
 * with a Crossmint custodial smart wallet as the signer.
 *
 * Usage:
 *   npm run script:bridge
 *   # or
 *   npx tsx scripts/bridgeAndSwap.ts
 *
 * Prerequisites:
 *   - CROSSMINT_SERVER_API_KEY set in .env
 *   - Wallet funded with USDC on Base (at least $1-2 worth)
 */

import "dotenv/config";
import {
  getOrCreateWallet,
  getWalletBalances,
} from "../src/lib/crossmint";
import {
  configureLifi,
  getBestRoute,
  executeBridgeRoute,
  formatRoute,
} from "../src/lib/lifi";
import {
  TOKENS,
  CHAIN_IDS,
  getExplorerAddressUrl,
  getExplorerTxUrl,
} from "../src/lib/tokens";

// Amount to bridge: 1 USDC (6 decimals)
const BRIDGE_AMOUNT_USDC = "1000000";

async function main() {
  console.log("🌉 Crossmint <> LI.FI Bridge Demo");
  console.log("   Base USDC → Arbitrum ETH\n");

  // ── Step 1: Get wallet ─────────────────────────────────────────────────
  console.log("Step 1/4: Initializing Crossmint wallet...");
  const wallet = await getOrCreateWallet();
  const address = wallet.address;
  console.log(`  Address: ${address}`);
  console.log(
    `  Explorer: ${getExplorerAddressUrl(CHAIN_IDS.BASE, address)}\n`
  );

  // ── Step 2: Check source balance ───────────────────────────────────────
  console.log("Step 2/4: Checking USDC balance on Base...");
  const balances = await getWalletBalances(address);
  const usdcBalance = balances.find(
    (b) =>
      b.contractAddress?.toLowerCase() === TOKENS.USDC_BASE.toLowerCase()
  );

  if (!usdcBalance || Number(usdcBalance.amount) < 1) {
    console.error("\n❌ Insufficient USDC balance on Base.");
    console.error(
      `   Required: at least 1 USDC (${BRIDGE_AMOUNT_USDC} units)`
    );
    console.error(`   Found: ${usdcBalance?.amount ?? "0"} USDC`);
    console.error(`\n   Fund this address with USDC on Base and try again:`);
    console.error(`   ${address}`);
    process.exit(1);
  }

  console.log(
    `  USDC balance: ${Number(usdcBalance.amount).toFixed(2)} USDC`
  );
  console.log(
    `  USD value: ~$${Number(usdcBalance.usdValue ?? 0).toFixed(2)}\n`
  );

  // ── Step 3: Get best route ─────────────────────────────────────────────
  console.log("Step 3/4: Fetching best route from LI.FI...");
  configureLifi(wallet);

  const route = await getBestRoute({
    fromChainId: CHAIN_IDS.BASE,
    fromToken: TOKENS.USDC_BASE,
    toChainId: CHAIN_IDS.ARBITRUM,
    toToken: TOKENS.ETH_NATIVE,
    fromAmount: BRIDGE_AMOUNT_USDC,
    fromAddress: address,
  });

  if (!route) {
    console.error(
      "\n❌ No route found. LI.FI may not support this pair right now."
    );
    console.error("   Try again later or reduce the amount.");
    process.exit(1);
  }

  console.log("\n  Route found:");
  console.log(
    formatRoute(route)
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")
  );
  console.log();

  // ── Step 4: Execute the bridge ─────────────────────────────────────────
  console.log("Step 4/4: Executing bridge via Crossmint wallet...");
  console.log("  (This may take 1-5 minutes depending on the bridge)\n");

  let lastStatus = "";

  const result = await executeBridgeRoute(route, {
    onUpdate(message, step, total) {
      if (message !== lastStatus) {
        lastStatus = message;
        process.stdout.write(`\r  [${step}/${total}] ${message}          `);
      }
    },
  });

  console.log("\n\n✅ Bridge complete!\n");

  // Print transaction links
  const allProcesses = result.steps.flatMap(
    (s) => s.execution?.process ?? []
  );
  const confirmedTxs = allProcesses.filter(
    (p) => p.txHash && p.status === "DONE"
  );

  if (confirmedTxs.length > 0) {
    console.log("Transaction receipts:");
    confirmedTxs.forEach((p, i) => {
      const chainId = i === 0 ? CHAIN_IDS.BASE : CHAIN_IDS.ARBITRUM;
      console.log(`  ${i + 1}. ${getExplorerTxUrl(chainId, p.txHash!)}`);
    });
    console.log();
  }

  // Fetch updated destination balance
  console.log("Checking ETH balance on Arbitrum...");
  // Note: the SDK wallet is configured for Base; for Arb balance, we use the REST API indirectly
  // through the balances() call which may not show Arbitrum. Explorer link is the best option here.
  console.log(
    `\nArbitrum wallet: ${getExplorerAddressUrl(CHAIN_IDS.ARBITRUM, address)}`
  );
  console.log("  Check the explorer link above for your ETH balance.");
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message ?? err);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
