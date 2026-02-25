"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { getOnChainBalances } from "@/lib/crossmint-client";

// ── Constants ──────────────────────────────────────────────────────────────────
const TOKENS = {
  USDC_BASE: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  ETH_NATIVE: "0x0000000000000000000000000000000000000000",
};
const CHAIN_IDS = { BASE: 8453, ARBITRUM: 42161 };

// ── Types ──────────────────────────────────────────────────────────────────────
interface TokenBalance {
  symbol: string;
  amount: string;
  usdValue: string;
  contractAddress: string;
  chainId: number;
  chainName: string;
}
interface WalletInfo {
  address: string;
  explorerUrls: { base: string; arbitrum: string };
}
interface StatusEvent {
  step: number;
  status: string;
  message: string;
}
interface CompleteEvent {
  status: string;
  transactions: { txHash: string; explorerUrl: string }[];
  toAmount: string;
  toToken: string;
  toChain: number;
}

// ── Small components ───────────────────────────────────────────────────────────

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="spin"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function ChainBadge({
  name,
  color,
}: {
  name: string;
  color: "blue" | "orange";
}) {
  const styles = {
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    orange: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${styles[color]}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${color === "blue" ? "bg-blue-400" : "bg-orange-400"}`}
      />
      {name}
    </span>
  );
}

function StepDot({
  n,
  active,
  done,
}: {
  n: number;
  active: boolean;
  done: boolean;
}) {
  if (done)
    return (
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: "rgba(92,103,255,0.18)", border: "1px solid rgba(92,103,255,0.4)" }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5C67FF" strokeWidth={3}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </div>
    );
  if (active)
    return (
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
        style={{
          background: "#5C67FF",
          border: "1px solid rgba(124,133,255,0.8)",
          boxShadow: "0 0 14px rgba(92,103,255,0.45)",
        }}
      >
        <span className="text-xs font-bold text-white">{n}</span>
      </div>
    );
  return (
    <div className="w-7 h-7 rounded-full bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-medium text-white/40">{n}</span>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-red-500/8 border border-red-500/20 px-4 py-3">
      <svg
        className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <circle cx="12" cy="12" r="10" strokeWidth="2" />
        <path d="M12 8v4M12 16h.01" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <p className="text-sm text-red-300">{message}</p>
    </div>
  );
}

function LogLine({ line }: { line: string }) {
  const statusColors: Record<string, string> = {
    DONE: "text-emerald-400",
    PENDING: "text-amber-400",
    ACTION_REQUIRED: "text-orange-400",
    FAILED: "text-red-400",
  };
  // Parse "[STATUS] message" format
  const match = line.match(/^\[([A-Z_]+)\]\s*(.*)/);
  if (match) {
    const [, status, message] = match;
    const color = statusColors[status] ?? "text-white/48";
    return (
      <div className="flex items-start gap-2 leading-5">
        <span className={`text-[10px] font-bold mt-0.5 flex-shrink-0 w-20 ${color}`}>
          [{status}]
        </span>
        <span className="text-white/80 break-all">{message}</span>
      </div>
    );
  }
  return <div className="text-white/48 leading-5">{line}</div>;
}

function TokenIcon({ symbol }: { symbol: string }) {
  const colors: Record<string, string> = {
    USDC: "bg-blue-500",
    ETH: "bg-indigo-500",
    WETH: "bg-indigo-400",
  };
  const bg = colors[symbol] ?? "bg-slate-600";
  return (
    <span
      className={`inline-flex w-8 h-8 rounded-full ${bg} items-center justify-center text-[10px] font-bold text-white flex-shrink-0`}
    >
      {symbol.slice(0, 3)}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Home() {
  // Wallet
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [walletUserId, setWalletUserId] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Balance
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceFetched, setBalanceFetched] = useState(false);

  // Bridge
  const [amount, setAmount] = useState("1");
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [bridging, setBridging] = useState(false);
  const [bridgeResult, setBridgeResult] = useState<CompleteEvent | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Withdraw
  const [withdrawDest, setWithdrawDest] = useState("");
  const [withdrawLog, setWithdrawLog] = useState<string[]>([]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<{
    status: "SUCCESS" | "EMPTY";
    transactions: { txHash: string; explorerUrl: string; label: string }[];
    message?: string;
  } | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const withdrawLogRef = useRef<HTMLDivElement>(null);

  // Derived step
  const activeStep = bridgeResult || bridgeError
    ? 4
    : statusLog.length > 0 || bridging
    ? 3
    : balanceFetched
    ? 2
    : wallet
    ? 1
    : 0;

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Load (or create) a wallet for the given userId.
   * If no userId is provided, uses the server's default locator from .env.
   */
  async function initWallet(userId?: string) {
    setWalletLoading(true);
    setWalletError(null);
    try {
      const url = userId ? `/api/wallet?userId=${encodeURIComponent(userId)}` : "/api/wallet";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load wallet");
      setWallet(data);
      const uid = userId ?? null;
      setWalletUserId(uid);
      localStorage.setItem("crossmint_wallet", JSON.stringify(data));
      localStorage.setItem("crossmint_wallet_userId", uid ?? "");
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : String(e));
    } finally {
      setWalletLoading(false);
    }
  }

  /** Create a brand-new wallet with a fresh timestamped user ID. */
  function newWallet() {
    const userId = `demo-user-${Date.now()}`;
    // Clear all previous session state
    setBalances([]);
    setBalanceFetched(false);
    setBalanceError(null);
    setStatusLog([]);
    setBridgeResult(null);
    setBridgeError(null);
    setWithdrawLog([]);
    setWithdrawResult(null);
    setWithdrawError(null);
    initWallet(userId);
  }

  // On mount: restore cached wallet instantly, then re-verify in background
  useEffect(() => {
    const cached = localStorage.getItem("crossmint_wallet");
    const cachedUserId = localStorage.getItem("crossmint_wallet_userId") || undefined;
    if (cached) {
      try {
        setWallet(JSON.parse(cached));
        setWalletUserId(cachedUserId ?? null);
      } catch {
        // malformed cache — ignore, initWallet will fix it
      }
    }
    initWallet(cachedUserId || undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Balances are read directly from Base chain via viem public client —
   * no Crossmint auth required at all.
   */
  async function fetchBalance() {
    if (!wallet) return;
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const tokens = await getOnChainBalances(wallet.address);
      setBalances(tokens);
      setBalanceFetched(true);
    } catch (e) {
      setBalanceError(e instanceof Error ? e.message : String(e));
    } finally {
      setBalanceLoading(false);
    }
  }

  /**
   * Bridge execution is server-side: Crossmint must sign the UserOperation,
   * which requires the server API key. The API route streams progress via SSE.
   */
  async function executeBridge() {
    setBridging(true);
    setBridgeResult(null);
    setBridgeError(null);
    setStatusLog([]);
    const amountUnits = String(Math.round(parseFloat(amount) * 1_000_000));
    try {
      const res = await fetch("/api/bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromChain: CHAIN_IDS.BASE,
          toChain: CHAIN_IDS.ARBITRUM,
          fromToken: TOKENS.USDC_BASE,
          toToken: TOKENS.ETH_NATIVE,
          amount: amountUnits,
        }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const eventMatch = part.match(/^event:\s*(.+)$/m);
          const dataMatch = part.match(/^data:\s*(.+)$/m);
          if (!eventMatch || !dataMatch) continue;
          const event = eventMatch[1].trim();
          const payload = JSON.parse(dataMatch[1].trim());
          if (event === "status") {
            const s = payload as StatusEvent;
            const line = `[${s.status}] ${s.message}`;
            setStatusLog((prev) => [...prev, line]);
            setTimeout(() => {
              logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
            }, 0);
          } else if (event === "complete") {
            setBridgeResult(payload as CompleteEvent);
          } else if (event === "error") {
            setBridgeError(payload.message);
          }
        }
      }
    } catch (e) {
      setBridgeError(e instanceof Error ? e.message : String(e));
    } finally {
      setBridging(false);
    }
  }

  async function executeWithdraw() {
    setWithdrawing(true);
    setWithdrawResult(null);
    setWithdrawError(null);
    setWithdrawLog([]);
    try {
      const res = await fetch("/api/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: withdrawDest }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const eventMatch = part.match(/^event:\s*(.+)$/m);
          const dataMatch = part.match(/^data:\s*(.+)$/m);
          if (!eventMatch || !dataMatch) continue;
          const event = eventMatch[1].trim();
          const payload = JSON.parse(dataMatch[1].trim());
          if (event === "status") {
            const line = `[${payload.status}] ${payload.message}`;
            setWithdrawLog((prev) => [...prev, line]);
            setTimeout(() => {
              withdrawLogRef.current?.scrollTo({ top: withdrawLogRef.current.scrollHeight, behavior: "smooth" });
            }, 0);
          } else if (event === "complete") {
            setWithdrawResult(payload);
            // Refresh balances after successful withdrawal
            if (payload.status === "SUCCESS" && wallet) {
              const { getOnChainBalances } = await import("@/lib/crossmint-client");
              const updated = await getOnChainBalances(wallet.address);
              setBalances(updated);
            }
          } else if (event === "error") {
            setWithdrawError(payload.message);
          }
        }
      }
    } catch (e) {
      setWithdrawError(e instanceof Error ? e.message : String(e));
    } finally {
      setWithdrawing(false);
    }
  }

  const copyAddress = useCallback(() => {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [wallet]);

  const usdcBalance = balances.find(
    (b) => b.contractAddress?.toLowerCase() === TOKENS.USDC_BASE.toLowerCase()
  );
  const hasUsdc = usdcBalance && Number(usdcBalance.amount) > 0;
  const nonZeroBalances = balances.filter((b) => Number(b.amount) > 0);
  const hasAnyBalance = nonZeroBalances.length > 0;
  const isValidDest = withdrawDest.startsWith("0x") && withdrawDest.length === 42;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen overflow-x-hidden" style={{ background: "#000000" }}>
      {/* Ambient background orbs */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      {/* Header */}
      <header className="relative z-10" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="max-w-2xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* LI.FI logo mark — diamond shape with brand gradient */}
            <div
              className="w-8 h-8 flex items-center justify-center flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, #F7C2FF 0%, #5C67FF 100%)",
                borderRadius: "4px",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M12 2L22 12L12 22L2 12Z" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight" style={{ color: "rgba(255,255,255,0.84)" }}>
                Crossmint × LI.FI
              </p>
              <p className="text-[11px] leading-tight" style={{ color: "rgba(255,255,255,0.36)" }}>
                Cross-chain bridge · POC
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <ChainBadge name="Base" color="blue" />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <ChainBadge name="Arbitrum" color="orange" />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 max-w-2xl mx-auto px-5 py-8 space-y-4">

        {/* ── Section 1: Wallet ──────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-start gap-4">
            <StepDot n={1} active={activeStep === 0} done={activeStep > 0} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div>
                  <h2 className="text-sm font-semibold text-white">Smart Wallet</h2>
                  <p className="text-xs text-white/40 mt-0.5">Crossmint custodial EVM wallet (ERC-4337)</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {wallet && (
                    <button
                      onClick={newWallet}
                      disabled={walletLoading}
                      title="Create a brand-new wallet with a fresh user ID"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        color: "rgba(255,255,255,0.48)",
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                      </svg>
                      New Wallet
                    </button>
                  )}
                  <button
                    onClick={() => initWallet(walletUserId ?? undefined)}
                    disabled={walletLoading}
                    className="flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: walletLoading
                        ? "rgba(92,103,255,0.2)"
                        : "linear-gradient(135deg, #5C67FF, #3F49E1)",
                      color: "white",
                    }}
                  >
                    {walletLoading && <Spinner size={11} />}
                    {walletLoading ? "Loading…" : wallet ? "Refresh" : "Initialize"}
                  </button>
                </div>
              </div>

              {walletError && (
                <div className="mt-3">
                  <ErrorBanner message={walletError} />
                </div>
              )}

              {wallet && (
                <div className="mt-3 space-y-2">
                  {/* Address row */}
                  <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="w-6 h-6 rounded-full bg-[#5C67FF]/15 flex items-center justify-center flex-shrink-0">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#F7C2FF" strokeWidth="2">
                        <rect x="2" y="7" width="20" height="14" rx="2" />
                        <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
                      </svg>
                    </div>
                    <code className="flex-1 text-xs text-white/80 font-mono truncate">
                      {wallet.address}
                    </code>
                    <button
                      onClick={copyAddress}
                      className="flex-shrink-0 flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md transition-colors"
                      style={{ color: copied ? "#34d399" : "#64748b" }}
                    >
                      {copied ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
                      )}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  {/* Wallet ID pill */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-white/25">
                      {walletUserId ? `userId: ${walletUserId}` : "userId: (from .env)"}
                    </span>
                  </div>
                  {/* Explorer links */}
                  <div className="flex gap-3">
                    <a
                      href={wallet.explorerUrls.base}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Basescan
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                    </a>
                    <a
                      href={wallet.explorerUrls.arbitrum}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 transition-colors"
                    >
                      Arbiscan
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Section 2: Balances ──────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-start gap-4">
            <StepDot n={2} active={activeStep === 1} done={activeStep > 1} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div>
                  <h2 className="text-sm font-semibold text-white">Token Balances</h2>
                  <p className="text-xs text-white/40 mt-0.5">Base + Arbitrum · wallet holdings</p>
                </div>
                <button
                  onClick={fetchBalance}
                  disabled={balanceLoading}
                  className="flex-shrink-0 flex items-center gap-2 px-3.5 py-1.5 rounded text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{
                    background: balanceLoading
                      ? "rgba(92,103,255,0.2)"
                      : "linear-gradient(135deg, #5C67FF, #3F49E1)",
                    color: "white",
                  }}
                >
                  {balanceLoading && <Spinner size={11} />}
                  {balanceLoading ? "Loading…" : balanceFetched ? "Refresh" : "Fetch Balances"}
                </button>
              </div>

              {balanceError && (
                <div className="mt-3">
                  <ErrorBanner message={balanceError} />
                </div>
              )}

              {balanceFetched && nonZeroBalances.length === 0 && (
                <div className="mt-3 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.18)" }}>
                  <p className="text-amber-300 font-medium text-xs">No token balances found</p>
                  {wallet && (
                    <>
                      <p className="text-amber-500 text-[11px] mt-1 mb-1.5">
                        Fund this address with USDC on Base to run the bridge:
                      </p>
                      <code className="text-amber-200 text-[11px] break-all">{wallet.address}</code>
                    </>
                  )}
                </div>
              )}

              {nonZeroBalances.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {nonZeroBalances.map((token, i) => {
                    const isArbitrum = token.chainId === 42161;
                    const chainColor = isArbitrum ? "text-orange-400" : "text-blue-400";
                    const chainDot = isArbitrum ? "bg-orange-400" : "bg-blue-400";
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-xl px-3.5 py-2.5 glass-hover"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
                      >
                        <div className="flex items-center gap-2.5">
                          <TokenIcon symbol={token.symbol} />
                          <div>
                            <p className="text-xs font-semibold text-white">{token.symbol}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className={`w-1.5 h-1.5 rounded-full ${chainDot}`} />
                              <span className={`text-[11px] ${chainColor}`}>{token.chainName}</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-white tabular-nums">
                            {Number(token.amount).toFixed(6)}
                          </p>
                          {Number(token.usdValue) > 0 && (
                            <p className="text-[11px] text-white/40 tabular-nums">
                              ~${Number(token.usdValue).toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Section 3: Withdraw ──────────────────────────────────────── */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-start gap-4">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: hasAnyBalance ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)",
                border: hasAnyBalance ? "1px solid rgba(16,185,129,0.35)" : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={hasAnyBalance ? "#34d399" : "#475569"} strokeWidth="2.5">
                <path d="M12 2v20M17 7l-5-5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-white mb-0.5">Withdraw Funds</h2>
              <p className="text-xs text-white/40 mb-4">Send all smart wallet assets to your own address</p>

              {/* Destination input */}
              <div className="mb-3">
                <label className="text-[10px] text-white/40 uppercase tracking-wide font-medium block mb-1.5">
                  Destination address
                </label>
                <input
                  type="text"
                  value={withdrawDest}
                  onChange={(e) => setWithdrawDest(e.target.value.trim())}
                  placeholder="0x..."
                  spellCheck={false}
                  className="w-full rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-200 outline-none transition-all"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: withdrawDest && !isValidDest
                      ? "1px solid rgba(239,68,68,0.4)"
                      : "1px solid rgba(255,255,255,0.08)",
                  }}
                />
                {withdrawDest && !isValidDest && (
                  <p className="text-[11px] text-red-400 mt-1">Must be a valid 0x address (42 chars)</p>
                )}
              </div>

              {/* What will be withdrawn */}
              {hasAnyBalance && (
                <div
                  className="rounded-xl px-3.5 py-2.5 mb-3 space-y-1"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <p className="text-[10px] text-white/40 uppercase tracking-wide font-medium mb-1.5">Will withdraw</p>
                  {nonZeroBalances.map((b, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${b.chainId === 42161 ? "bg-orange-400" : "bg-blue-400"}`} />
                        <span className="text-xs text-white/48">{b.symbol} · {b.chainName}</span>
                      </div>
                      <span className="text-xs font-semibold text-white tabular-nums">
                        {Number(b.amount).toFixed(6)}
                      </span>
                    </div>
                  ))}
                  {nonZeroBalances.some(b => b.symbol === "ETH") && (
                    <p className="text-[10px] text-white/25 mt-1">* 0.0002 ETH reserved per chain for gas</p>
                  )}
                </div>
              )}

              {/* Button */}
              <button
                onClick={executeWithdraw}
                disabled={withdrawing || !hasAnyBalance || !isValidDest}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: withdrawing
                    ? "rgba(16,185,129,0.3)"
                    : hasAnyBalance && isValidDest
                    ? "linear-gradient(135deg, #059669 0%, #0d9488 100%)"
                    : "rgba(255,255,255,0.06)",
                  boxShadow: !withdrawing && hasAnyBalance && isValidDest
                    ? "0 0 20px rgba(16,185,129,0.2)"
                    : "none",
                }}
              >
                {withdrawing && <Spinner size={13} />}
                {withdrawing
                  ? "Withdrawing…"
                  : !hasAnyBalance
                  ? "No balances to withdraw"
                  : "Withdraw All"}
              </button>

              {/* Log */}
              {(withdrawLog.length > 0 || withdrawing) && (
                <div className="mt-4">
                  <p className="text-[11px] text-white/40 uppercase tracking-wide font-medium mb-1.5">
                    Withdrawal log
                  </p>
                  <div
                    ref={withdrawLogRef}
                    className="terminal rounded-xl p-3.5 h-36 overflow-y-auto space-y-1.5 text-[11px]"
                  >
                    {withdrawLog.map((line, i) => <LogLine key={i} line={line} />)}
                    {withdrawing && (
                      <div className="flex items-center gap-2 text-emerald-400 terminal-cursor">
                        <span>Processing…</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Result */}
              {withdrawError && (
                <div className="mt-3">
                  <ErrorBanner message={withdrawError} />
                </div>
              )}
              {withdrawResult && (
                <div
                  className="mt-3 rounded-xl px-4 py-3"
                  style={{
                    background: withdrawResult.status === "SUCCESS"
                      ? "rgba(16,185,129,0.07)"
                      : "rgba(245,158,11,0.07)",
                    border: withdrawResult.status === "SUCCESS"
                      ? "1px solid rgba(16,185,129,0.2)"
                      : "1px solid rgba(245,158,11,0.2)",
                  }}
                >
                  {withdrawResult.status === "EMPTY" ? (
                    <p className="text-xs text-amber-300">{withdrawResult.message}</p>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-emerald-400 mb-2">Withdrawal complete</p>
                      {withdrawResult.transactions.map((tx, i) => (
                        <a
                          key={i}
                          href={tx.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between rounded-lg px-3 py-2 group transition-all"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          <div>
                            <p className="text-[11px] text-emerald-300 font-medium">{tx.label}</p>
                            <code className="text-[10px] text-white/40 font-mono truncate block max-w-[280px]">
                              {tx.txHash}
                            </code>
                          </div>
                          <svg className="flex-shrink-0 ml-2 text-white/25 group-hover:text-emerald-400 transition-colors" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Section 4: Bridge ──────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-5">
          <div className="flex items-start gap-4">
            <StepDot n={3} active={activeStep === 2 || activeStep === 3} done={activeStep === 4 && !!bridgeResult} />
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-white mb-0.5">Bridge & Swap</h2>
              <p className="text-xs text-white/40 mb-4">Powered by LI.FI · best route · 0.5% slippage</p>

              {/* Bridge widget */}
              <div className="space-y-1.5 mb-4">
                {/* From */}
                <div
                  className="rounded-xl p-4"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <p className="text-[10px] text-white/40 uppercase tracking-wide mb-2.5 font-medium">You Send</p>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <TokenIcon symbol="USDC" />
                      <div>
                        <p className="text-sm font-semibold text-white">USDC</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                          <span className="text-[11px] text-blue-400">Base</span>
                        </div>
                      </div>
                    </div>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="text-right text-xl font-bold text-white bg-transparent outline-none w-28 tabular-nums"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* Arrow */}
                <div className="flex justify-center py-0.5">
                  <div
                    className="arrow-bounce w-7 h-7 flex items-center justify-center"
                    style={{
                      background: "rgba(92,103,255,0.12)",
                      border: "1px solid rgba(92,103,255,0.28)",
                      borderRadius: "4px",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C83EB" strokeWidth="2.5">
                      <path d="M12 5v14M5 12l7 7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>

                {/* To */}
                <div
                  className="rounded-xl p-4"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <p className="text-[10px] text-white/40 uppercase tracking-wide mb-2.5 font-medium">You Receive</p>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <TokenIcon symbol="ETH" />
                      <div>
                        <p className="text-sm font-semibold text-white">ETH</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                          <span className="text-[11px] text-orange-400">Arbitrum</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-white/40 text-sm font-medium">Best rate via LI.FI</p>
                  </div>
                </div>
              </div>

              {/* Execute button */}
              <button
                onClick={executeBridge}
                disabled={bridging || !amount || parseFloat(amount) <= 0}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: bridging
                    ? "rgba(92,103,255,0.4)"
                    : "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                  boxShadow: bridging ? "none" : "0 0 24px rgba(124,58,237,0.25)",
                }}
              >
                {bridging && <Spinner size={13} />}
                {bridging ? "Bridging…" : "Execute Bridge"}
              </button>

              {/* Live log */}
              {(statusLog.length > 0 || bridging) && (
                <div className="mt-4">
                  <p className="text-[11px] text-white/40 uppercase tracking-wide font-medium mb-1.5">
                    Execution log
                  </p>
                  <div
                    ref={logRef}
                    className="terminal rounded-xl p-3.5 h-44 overflow-y-auto space-y-1.5 text-[11px]"
                  >
                    {statusLog.map((line, i) => (
                      <LogLine key={i} line={line} />
                    ))}
                    {bridging && (
                      <div className="flex items-center gap-2 text-[#7C83EB] terminal-cursor">
                        <span>Waiting for confirmation</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Section 4: Result ──────────────────────────────────────────── */}
        {(bridgeResult || bridgeError) && (
          <div
            className={`glass rounded-2xl p-5 ${bridgeResult ? "success-glow" : ""}`}
            style={{
              borderColor: bridgeResult
                ? "rgba(16,185,129,0.25)"
                : "rgba(239,68,68,0.25)",
            }}
          >
            <div className="flex items-start gap-4">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                  bridgeResult
                    ? "bg-emerald-500/20 border border-emerald-500/40"
                    : "bg-red-500/20 border border-red-500/40"
                }`}
              >
                {bridgeResult ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5">
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {bridgeError && (
                  <>
                    <h3 className="text-sm font-semibold text-red-400 mb-1">Bridge Failed</h3>
                    <p className="text-xs text-red-300/80">{bridgeError}</p>
                  </>
                )}
                {bridgeResult && (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <h3 className="text-sm font-semibold text-emerald-400">Bridge Complete</h3>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                        SUCCESS
                      </span>
                    </div>
                    <div
                      className="rounded-xl px-4 py-3 mb-3"
                      style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.15)" }}
                    >
                      <p className="text-xs text-white/48 mb-0.5">Amount received</p>
                      <p className="text-lg font-bold text-white tabular-nums">
                        ~{bridgeResult.toAmount}{" "}
                        <span className="text-emerald-400">{bridgeResult.toToken}</span>
                      </p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                        <span className="text-[11px] text-orange-400">Arbitrum</span>
                      </div>
                    </div>
                    {bridgeResult.transactions.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-white/40 uppercase tracking-wide font-medium">
                          Transactions
                        </p>
                        {bridgeResult.transactions.map((tx, i) => (
                          <a
                            key={i}
                            href={tx.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between rounded-lg px-3 py-2 glass-hover transition-all group"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
                          >
                            <code className="text-[11px] text-emerald-400 font-mono truncate max-w-[280px]">
                              {tx.txHash}
                            </code>
                            <svg
                              className="flex-shrink-0 ml-2 text-white/25 group-hover:text-emerald-400 transition-colors"
                              width="11"
                              height="11"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          </a>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── How it works ──────────────────────────────────────────────── */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white/84 mb-0.5">How it works</h3>
            <p className="text-xs text-white/40">What happens behind the scenes when you bridge</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                icon: (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F7C2FF" strokeWidth="2" strokeLinecap="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                ),
                heading: "Your wallet, always ready",
                body: "Created once and persisted across sessions. No seed phrase or browser extension — Crossmint secures the signing key on your behalf.",
              },
              {
                icon: (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F7C2FF" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
                  </svg>
                ),
                heading: "Best route, automatically",
                body: "LI.FI compares 30+ bridges and DEXs in real time and picks the fastest path with the most tokens out for your input.",
              },
              {
                icon: (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F7C2FF" strokeWidth="2" strokeLinecap="round">
                    <path d="M5 12h14M13 6l6 6-6 6" strokeLinejoin="round" />
                  </svg>
                ),
                heading: "One click, end to end",
                body: "Hit Execute and the full sequence — approval, swap, bridge — runs automatically. No chain switching, no separate confirmations needed.",
              },
              {
                icon: (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F7C2FF" strokeWidth="2" strokeLinecap="round">
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                  </svg>
                ),
                heading: "Fully verifiable on-chain",
                body: "Every transaction produces a hash you can look up on Basescan or Arbiscan. Your funds move transparently — nothing is hidden.",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-xl p-3.5"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div
                  className="w-7 h-7 rounded flex items-center justify-center mb-2.5"
                  style={{ background: "rgba(247,194,255,0.08)", border: "1px solid rgba(247,194,255,0.15)" }}
                >
                  {item.icon}
                </div>
                <p className="text-xs font-semibold text-white/84 mb-1">{item.heading}</p>
                <p className="text-[11px] leading-relaxed text-white/40">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}
