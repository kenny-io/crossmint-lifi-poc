import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Crossmint × LI.FI Bridge Demo",
    template: "%s | Crossmint × LI.FI Bridge Demo",
  },
  description:
    "Proof of concept showing Crossmint embedded wallets executing cross-chain swaps and bridges via the LI.FI SDK without exposing private keys.",
  keywords: [
    "Crossmint",
    "LI.FI",
    "cross-chain bridge",
    "USDC",
    "Arbitrum",
    "Base",
    "embedded wallet",
    "account abstraction",
  ],
  openGraph: {
    title: "Crossmint × LI.FI — Cross-Chain Bridge POC",
    description:
      "Cross-chain bridge demo: Crossmint embedded smart wallets executing USDC on Base to ETH on Arbitrum via the LI.FI SDK.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Crossmint × LI.FI Bridge Demo",
    description:
      "Demo of Crossmint embedded wallets powering cross-chain swaps and bridges via the LI.FI SDK.",
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
