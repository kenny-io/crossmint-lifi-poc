import { NextRequest } from "next/server";
import { getOrCreateWallet } from "@/lib/crossmint";
import {
  configureLifi,
  getBestRoute,
  executeBridgeRoute,
} from "@/lib/lifi";
import { getExplorerTxUrl } from "@/lib/tokens";

export const runtime = "nodejs";
// Allow long-running bridge operations (up to 10 minutes)
export const maxDuration = 600;

interface BridgeRequestBody {
  fromChain: number;
  toChain: number;
  fromToken: string;
  toToken: string;
  amount: string; // in smallest unit (e.g. "1000000" for 1 USDC)
}

function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as BridgeRequestBody;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseMessage(event, data)));
      };

      try {
        // Step 1: Get wallet
        send("status", {
          step: 1,
          status: "PENDING",
          message: "Loading wallet...",
        });
        const wallet = await getOrCreateWallet();
        const address = wallet.address;

        send("status", {
          step: 1,
          status: "DONE",
          message: `Wallet loaded: ${address}`,
        });

        // Step 2: Configure LI.FI
        send("status", {
          step: 2,
          status: "PENDING",
          message: "Configuring LI.FI...",
        });
        configureLifi(wallet);
        send("status", {
          step: 2,
          status: "DONE",
          message: "LI.FI configured",
        });

        // Step 3: Fetch route
        send("status", {
          step: 3,
          status: "PENDING",
          message: "Finding best route...",
        });
        const route = await getBestRoute({
          fromChainId: body.fromChain,
          fromToken: body.fromToken,
          toChainId: body.toChain,
          toToken: body.toToken,
          fromAmount: body.amount,
          fromAddress: address,
        });

        if (!route) {
          send("error", { message: "No route found for this pair" });
          controller.close();
          return;
        }

        const toAmount = (
          Number(route.toAmountMin) / Math.pow(10, route.toToken.decimals)
        ).toFixed(6);

        send("status", {
          step: 3,
          status: "DONE",
          message: `Route found: ~${toAmount} ${route.toToken.symbol} via ${route.steps[0]?.toolDetails?.name ?? route.steps[0]?.tool}`,
        });

        // Step 4: Execute
        send("status", {
          step: 4,
          status: "PENDING",
          message: "Executing bridge (this may take a few minutes)...",
        });

        const result = await executeBridgeRoute(route, {
          onUpdate(message) {
            send("status", { step: 4, status: "PENDING", message });
          },
        });

        const txHashes = result.steps
          .flatMap((s) => s.execution?.process ?? [])
          .filter((p) => p.txHash && p.status === "DONE")
          .map((p) => ({
            txHash: p.txHash!,
            explorerUrl: getExplorerTxUrl(body.toChain, p.txHash!),
          }));

        send("complete", {
          status: "SUCCESS",
          transactions: txHashes,
          toAmount,
          toToken: route.toToken.symbol,
          toChain: body.toChain,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error occurred";
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
