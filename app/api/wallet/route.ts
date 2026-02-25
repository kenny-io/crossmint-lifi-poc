import { NextRequest, NextResponse } from "next/server";
import { getOrCreateWallet } from "@/lib/crossmint";
import { CHAIN_IDS, getExplorerAddressUrl } from "@/lib/tokens";

export async function GET(request: NextRequest) {
  try {
    // Optional ?userId= to target a specific wallet (e.g. "demo-user-1234567890")
    const userId = request.nextUrl.searchParams.get("userId");
    const locator = userId ? `userId:${userId}:evm:smart` : undefined;

    const wallet = await getOrCreateWallet(locator);
    const address = wallet.address;

    return NextResponse.json({
      address,
      explorerUrls: {
        base: getExplorerAddressUrl(CHAIN_IDS.BASE, address),
        arbitrum: getExplorerAddressUrl(CHAIN_IDS.ARBITRUM, address),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
