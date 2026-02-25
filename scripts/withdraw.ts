/**
 * withdraw.ts
 *
 * Withdraw all funds from the Crossmint smart wallet to an external address.
 * Handles USDC on Base and ETH on Arbitrum (the two assets used in this POC).
 *
 * Usage:
 *   npm run script:withdraw -- 0xYourDestinationAddress
 *   # or
 *   npx tsx scripts/withdraw.ts 0xYourDestinationAddress
 */

import "dotenv/config";
import {
  createPublicClient,
  http,
  erc20Abi,
  encodeFunctionData,
  formatUnits,
} from "viem";
import { base, arbitrum } from "viem/chains";
import { getOrCreateWallet } from "../src/lib/crossmint";
import { TOKENS, CHAIN_IDS, getExplorerTxUrl } from "../src/lib/tokens";

const DESTINATION = process.argv[2];

async function main() {
  if (!DESTINATION || !DESTINATION.startsWith("0x")) {
    console.error(
      "Usage: npx tsx scripts/withdraw.ts 0xYourDestinationAddress"
    );
    process.exit(1);
  }

  const destination = DESTINATION as `0x${string}`;

  console.log("💸 Withdrawing funds from Crossmint smart wallet\n");
  console.log(`   Destination: ${destination}`);

  const wallet = await getOrCreateWallet();
  const addr = wallet.address as `0x${string}`;
  console.log(`   Smart wallet: ${addr}\n`);

  // ── Read current balances ──────────────────────────────────────────────────
  const baseClient = createPublicClient({ chain: base, transport: http() });
  const arbClient = createPublicClient({ chain: arbitrum, transport: http() });

  const [usdcOnBase, ethOnBase, ethOnArb] = await Promise.all([
    baseClient.readContract({
      address: TOKENS.USDC_BASE as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [addr],
    }),
    baseClient.getBalance({ address: addr }),
    arbClient.getBalance({ address: addr }),
  ]);

  console.log("Balances:");
  console.log(`   USDC on Base:     ${formatUnits(usdcOnBase, 6)} USDC`);
  console.log(`   ETH  on Base:     ${formatUnits(ethOnBase, 18)} ETH`);
  console.log(`   ETH  on Arbitrum: ${formatUnits(ethOnArb, 18)} ETH\n`);

  let anyWithdrawal = false;

  // ── Withdraw USDC on Base ──────────────────────────────────────────────────
  if (usdcOnBase > 0n) {
    anyWithdrawal = true;
    console.log(`Withdrawing ${formatUnits(usdcOnBase, 6)} USDC from Base...`);

    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [destination, usdcOnBase],
    });

    const { hash } = await wallet.sendTransaction({
      to: TOKENS.USDC_BASE,
      data,
      value: 0n,
      crossmintChain: "base",
    });

    console.log(`   ✅ ${getExplorerTxUrl(CHAIN_IDS.BASE, hash)}\n`);
  }

  // ── Withdraw ETH on Arbitrum ───────────────────────────────────────────────
  if (ethOnArb > 0n) {
    // Keep 0.0002 ETH (~$0.50) as gas reserve — generous for an L2
    const gasReserve = 200_000_000_000_000n; // 0.0002 ETH in wei
    const sendAmount = ethOnArb > gasReserve ? ethOnArb - gasReserve : 0n;

    if (sendAmount > 0n) {
      anyWithdrawal = true;
      console.log(
        `Withdrawing ${formatUnits(sendAmount, 18)} ETH from Arbitrum...`
      );
      console.log(`   (reserving 0.0002 ETH for gas)`);

      const { hash } = await wallet.sendTransaction({
        to: destination,
        value: sendAmount,
        crossmintChain: "arbitrum",
      });

      console.log(`   ✅ ${getExplorerTxUrl(CHAIN_IDS.ARBITRUM, hash)}\n`);
    } else {
      console.log(
        `ETH on Arbitrum (${formatUnits(ethOnArb, 18)}) is below the 0.0002 ETH gas reserve — skipping.\n`
      );
    }
  }

  if (!anyWithdrawal) {
    console.log("Nothing to withdraw — all balances are zero.");
    return;
  }

  console.log(`✅ Done. Check your destination wallet:\n   ${destination}`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message ?? err);
  process.exit(1);
});
