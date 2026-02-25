/**
 * Crossmint wallet helpers — pure REST API implementation.
 *
 * Why not the SDK's getOrCreateWallet / getWallet?
 * Both throw environment guards in Node.js/Next.js server contexts:
 *   - getOrCreateWallet → "can only be called from client-side code"
 *   - getWallet         → "not supported on client side"
 * The underlying REST API has no such restrictions.
 */

const API_BASE = "https://www.crossmint.com";
const API_VERSION = "2025-06-09"; // SDK-verified API version
const WALLETS_PATH = `api/${API_VERSION}/wallets`;

// ── Helpers ────────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.CROSSMINT_SERVER_API_KEY;
  if (!key) {
    throw new Error(
      "CROSSMINT_SERVER_API_KEY is not set. Copy .env.example to .env and add your key."
    );
  }
  return key;
}

function getLocator(): string {
  return (
    process.env.CROSSMINT_WALLET_LOCATOR ?? "userId:demo-user:evm:smart"
  );
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ── Public wallet interface ────────────────────────────────────────────────────

/**
 * Generic wallet adapter used by viemTransport and lifi helpers.
 * Keeps those modules decoupled from the Crossmint SDK.
 */
export interface CrossmintWalletAdapter {
  address: string;
  locator: string;
  sendTransaction: (params: {
    to: string;
    data?: `0x${string}`;
    value?: bigint;
    /** Crossmint chain name: "base", "arbitrum", "polygon", etc. */
    crossmintChain: string;
  }) => Promise<{ hash: string }>;
}

// ── Wallet get / create ────────────────────────────────────────────────────────

/**
 * Get or create an EVM smart wallet via Crossmint REST API.
 * Works in any server environment (Node.js, Next.js, edge, CLI).
 * Pass `locatorOverride` to target a specific wallet (e.g. a per-user locator).
 */
export async function getOrCreateWallet(locatorOverride?: string): Promise<CrossmintWalletAdapter> {
  const apiKey = getApiKey();
  const locator = locatorOverride ?? getLocator();

  const address = await fetchOrCreateAddress(apiKey, locator);

  return {
    address,
    locator,
    sendTransaction: (params) => submitTransaction(apiKey, locator, params),
  };
}

async function fetchOrCreateAddress(
  apiKey: string,
  locator: string
): Promise<string> {
  // 1. Try to fetch an existing wallet
  const getRes = await fetch(
    `${API_BASE}/${WALLETS_PATH}/${encodeURIComponent(locator)}`,
    { headers: { "X-API-KEY": apiKey } }
  );

  if (getRes.ok) {
    const data = await getRes.json();
    if (!data.address) {
      throw new Error(`Wallet response missing address: ${JSON.stringify(data)}`);
    }
    return data.address as string;
  }

  if (getRes.status !== 404) {
    const body = await getRes.text();
    throw new Error(`GET wallet failed (${getRes.status}): ${body}`);
  }

  // 2. Wallet not found → create it
  // Owner format: "userId:demo-user:evm-smart-wallet" → "userId:demo-user"
  const owner = locator.split(":").slice(0, 2).join(":");

  const createRes = await fetch(`${API_BASE}/${WALLETS_PATH}`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "smart",
      chainType: "evm",
      config: { adminSigner: { type: "api-key" } },
      owner,
    }),
  });

  const created = await createRes.json();

  if (!createRes.ok) {
    throw new Error(`Create wallet failed (${createRes.status}): ${JSON.stringify(created)}`);
  }

  if (!created.address) {
    throw new Error(`Create wallet response missing address: ${JSON.stringify(created)}`);
  }

  return created.address as string;
}

// ── Transaction submission + polling ──────────────────────────────────────────

async function submitTransaction(
  apiKey: string,
  locator: string,
  params: {
    to: string;
    data?: `0x${string}`;
    value?: bigint;
    crossmintChain: string;
  }
): Promise<{ hash: string }> {
  const res = await fetch(
    `${API_BASE}/${WALLETS_PATH}/${encodeURIComponent(locator)}/transactions`,
    {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        params: {
          calls: [
            {
              to: params.to,
              // Crossmint expects a hex-encoded wei string
              value:
                params.value !== undefined
                  ? "0x" + params.value.toString(16)
                  : "0x0",
              data: params.data ?? "0x",
            },
          ],
          chain: params.crossmintChain,
        },
      }),
    }
  );

  const body = await res.json();

  if (!res.ok) {
    throw new Error(
      `Transaction submission failed (${res.status}): ${JSON.stringify(body)}`
    );
  }

  const txId: string = body.id;
  if (!txId) {
    throw new Error(`No transaction ID in response: ${JSON.stringify(body)}`);
  }

  return pollForHash(apiKey, locator, txId);
}

/**
 * Poll GET /wallets/{locator}/transactions/{id} until status = "success".
 * Timeout after ~2 minutes.
 */
async function pollForHash(
  apiKey: string,
  locator: string,
  txId: string,
  maxAttempts = 120,
  intervalMs = 1000
): Promise<{ hash: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);

    const res = await fetch(
      `${API_BASE}/${WALLETS_PATH}/${encodeURIComponent(locator)}/transactions/${txId}`,
      { headers: { "X-API-KEY": apiKey } }
    );

    if (!res.ok) continue; // transient error, keep polling

    const data = await res.json();

    if (data.status === "success" && data.onChain?.txId) {
      return { hash: data.onChain.txId as string };
    }

    if (data.status === "failed") {
      throw new Error(
        `Transaction failed on-chain (id=${txId}): ${JSON.stringify(data)}`
      );
    }

    // status "pending" or "awaiting-approval" → keep polling
  }

  throw new Error(`Transaction ${txId} timed out after ${maxAttempts}s`);
}

// ── Balance fetching ───────────────────────────────────────────────────────────

export interface NormalizedTokenBalance {
  symbol: string;
  name: string;
  amount: string;
  decimals: number;
  usdValue: string;
  contractAddress: string;
}

/**
 * Fetch token balances for a wallet address via Crossmint REST API.
 */
export async function getWalletBalances(
  address: string,
  chain = "base"
): Promise<NormalizedTokenBalance[]> {
  const apiKey = getApiKey();

  const res = await fetch(
    `${API_BASE}/api/v1-alpha2/wallets/${address}/balances?currency=usd&tokens=all&chains=${chain}`,
    { headers: { "X-API-KEY": apiKey } }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET balances failed (${res.status}): ${body}`);
  }

  const data = await res.json();

  if (!Array.isArray(data)) return [];

  return data.map((t: Record<string, unknown>) => ({
    symbol: String(t.symbol ?? ""),
    name: String(t.name ?? t.symbol ?? ""),
    amount: String(t.balance ?? t.amount ?? "0"),
    decimals: Number(t.decimals ?? 18),
    usdValue: String(t.usdValue ?? t.valueInUSD ?? "0"),
    contractAddress: String(t.contractAddress ?? t.tokenAddress ?? ""),
  }));
}
