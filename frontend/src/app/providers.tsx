"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Buffer } from "buffer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { RPC_CONNECTION_CONFIG, RPC_URL } from "@/lib/bullet";

import "@solana/wallet-adapter-react-ui/styles.css";

if (typeof window !== "undefined") {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

/** Next.js 15 surfaces console.error as the red overlay — mute RPC 429 noise. */
function installRpcConsoleFilter() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __bulletRpcFilter?: boolean };
  if (w.__bulletRpcFilter) return;
  w.__bulletRpcFilter = true;
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  const noisy = (args: unknown[]) => {
    const msg = args
      .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : ""))
      .join(" ");
    return /Server responded with 429|Several servers responded|429 Too Many Requests|Retrying after \d+ms delay/i.test(
      msg
    );
  };
  console.error = (...args: unknown[]) => {
    if (noisy(args)) return;
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (noisy(args)) return;
    origWarn(...args);
  };
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    installRpcConsoleFilter();
  }, []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 30,
            gcTime: 1000 * 60 * 5,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  const endpoint = useMemo(() => RPC_URL, []);
  const connectionConfig = useMemo(() => RPC_CONNECTION_CONFIG, []);

  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
