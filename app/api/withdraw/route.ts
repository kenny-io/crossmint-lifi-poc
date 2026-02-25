import { NextRequest } from "next/server";
import { getOrCreateWallet } from "@/lib/crossmint";
import {
  createPublicClient,
  http,
  erc20Abi,
  encodeFunctionData,
  formatUnits,
} from "viem";
import { base, arbitrum } from "viem/chains";
import { TOKENS, CHAIN_IDS, getExplorerTxUrl } from "@/lib/tokens";

export const runtime = "nodejs";
export const maxDuration = 120;

function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const { destination, locator } = await request.json();

  if (!destination || !destination.startsWith("0x") || destination.length !== 42) {
    return Response.json({ error: "Invalid destination address" }, { status: 400 });
  }

  const dest = destination as `0x${string}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseMessage(event, data)));
      };

      try {
        send("status", { status: "PENDING", message: "Loading wallet..." });
        // locator may be undefined — getOrCreateWallet falls back to .env default
        const wallet = await getOrCreateWallet(locator);
        const addr = wallet.address as `0x${string}`;
        send("status", { status: "DONE", message: `Wallet: ${addr}` });

        send("status", { status: "PENDING", message: "Reading on-chain balances..." });
        const baseClient = createPublicClient({ chain: base, transport: http() });
        const arbClient = createPublicClient({ chain: arbitrum, transport: http() });

        const [usdcOnBase, ethOnArb] = await Promise.all([
          baseClient.readContract({
            address: TOKENS.USDC_BASE as `0x${string}`,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [addr],
          }),
          arbClient.getBalance({ address: addr }),
        ]);

        send("status", {
          status: "DONE",
          message: `USDC on Base: ${formatUnits(usdcOnBase, 6)} · ETH on Arbitrum: ${formatUnits(ethOnArb, 18)}`,
        });

        const txs: { txHash: string; explorerUrl: string; label: string }[] = [];

        // ── Withdraw USDC on Base ───────────────────────────────────────────
        if (usdcOnBase > 0n) {
          send("status", {
            status: "PENDING",
            message: `Withdrawing ${formatUnits(usdcOnBase, 6)} USDC from Base…`,
          });

          const data = encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [dest, usdcOnBase],
          });

          const { hash } = await wallet.sendTransaction({
            to: TOKENS.USDC_BASE,
            data,
            value: 0n,
            crossmintChain: "base",
          });

          send("status", { status: "DONE", message: `USDC sent · ${hash}` });
          txs.push({
            txHash: hash,
            explorerUrl: getExplorerTxUrl(CHAIN_IDS.BASE, hash),
            label: `${formatUnits(usdcOnBase, 6)} USDC (Base)`,
          });
        }

        // ── Withdraw ETH on Arbitrum ────────────────────────────────────────
        const gasReserve = 200_000_000_000_000n; // 0.0002 ETH
        const ethSendAmount = ethOnArb > gasReserve ? ethOnArb - gasReserve : 0n;

        if (ethSendAmount > 0n) {
          send("status", {
            status: "PENDING",
            message: `Withdrawing ${formatUnits(ethSendAmount, 18)} ETH from Arbitrum… (0.0002 ETH reserved for gas)`,
          });

          const { hash } = await wallet.sendTransaction({
            to: dest,
            value: ethSendAmount,
            crossmintChain: "arbitrum",
          });

          send("status", { status: "DONE", message: `ETH sent · ${hash}` });
          txs.push({
            txHash: hash,
            explorerUrl: getExplorerTxUrl(CHAIN_IDS.ARBITRUM, hash),
            label: `${formatUnits(ethSendAmount, 18)} ETH (Arbitrum)`,
          });
        }

        if (txs.length === 0) {
          send("complete", {
            status: "EMPTY",
            transactions: [],
            message: "Nothing to withdraw — all balances are zero.",
          });
        } else {
          send("complete", { status: "SUCCESS", transactions: txs });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
