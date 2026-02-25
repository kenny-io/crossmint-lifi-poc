/**
 * createWallet.ts
 *
 * Creates (or fetches) a Crossmint EVM smart wallet and prints its address.
 *
 * Usage:
 *   npm run script:create-wallet
 *   # or
 *   npx tsx scripts/createWallet.ts
 */

import "dotenv/config";
import { getOrCreateWallet } from "../src/lib/crossmint";
import { CHAIN_IDS, getExplorerAddressUrl } from "../src/lib/tokens";

async function main() {
  console.log("🔑 Initializing Crossmint wallet...\n");

  const wallet = await getOrCreateWallet();
  const address = wallet.address;

  console.log("✅ Wallet ready!");
  console.log(`   Address:       ${address}`);
  console.log(
    `   Base explorer: ${getExplorerAddressUrl(CHAIN_IDS.BASE, address)}`
  );
  console.log(
    `   Arb explorer:  ${getExplorerAddressUrl(CHAIN_IDS.ARBITRUM, address)}`
  );
  console.log();
  console.log(
    "💡 Next step: Fund this wallet with a small amount of USDC on Base"
  );
  console.log(
    "   You can use Coinbase, a bridge, or any Base-compatible faucet."
  );
}

main().catch((err) => {
  console.error("❌ Error:", err.message ?? err);
  process.exit(1);
});
