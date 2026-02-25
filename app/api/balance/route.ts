import { NextResponse } from "next/server";
import { getOrCreateWallet, getWalletBalances } from "@/lib/crossmint";

export async function GET() {
  try {
    const wallet = await getOrCreateWallet();
    const address = wallet.address;
    const tokens = await getWalletBalances(address);

    return NextResponse.json({ address, tokens });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
