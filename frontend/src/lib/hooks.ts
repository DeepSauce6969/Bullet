"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  EMPTY_LOAN,
  borrowAnsem,
  burnBullet,
  claimGenesis,
  depositGenesis,
  fetchActiveLoan,
  fetchGenesisVaults,
  fetchMetrics,
  fetchTokenBalances,
  leveragePosition,
  liquidateLoan,
  mintBullet,
  placeholderGenesisVaults,
  repayLoan,
  withdrawGenesis,
  type GenesisVaultView,
  type LoanView,
  type ProtocolMetrics,
} from "@/lib/bullet";

const EMPTY_METRICS: ProtocolMetrics = {
  floorPrice: "1.0000",
  backing: "0.0000",
  totalSupply: "0.0000",
  totalMinted: "0.0000",
  activeBorrows: "0.0000",
  backingRatio: "100.00",
  tradingEnabled: false,
  loanCount: 0,
};

export function useProtocolMetrics() {
  const { connection } = useConnection();
  const [data, setData] = useState<ProtocolMetrics>(EMPTY_METRICS);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      const m = await fetchMetrics(connection);
      setData(m);
    } catch {
      setData(EMPTY_METRICS);
    } finally {
      setIsLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    refetch();
    const id = setInterval(refetch, 15_000);
    return () => clearInterval(id);
  }, [refetch]);

  return { data, isLoading, refetch };
}

export function useTokenBalances() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [ansemBalance, setAnsemBalance] = useState("0");
  const [bulletBalance, setBulletBalance] = useState("0");
  const [ansemRaw, setAnsemRaw] = useState<bigint>(BigInt(0));
  const [bulletRaw, setBulletRaw] = useState<bigint>(BigInt(0));
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!publicKey) {
      setAnsemBalance("0");
      setBulletBalance("0");
      setAnsemRaw(BigInt(0));
      setBulletRaw(BigInt(0));
      return {
        ansem: "0",
        bullet: "0",
        ansemRaw: BigInt(0),
        bulletRaw: BigInt(0),
      };
    }
    setIsLoading(true);
    try {
      const bal = await fetchTokenBalances(publicKey, connection);
      setAnsemBalance(bal.ansem);
      setBulletBalance(bal.bullet);
      setAnsemRaw(bal.ansemRaw);
      setBulletRaw(bal.bulletRaw);
      return bal;
    } catch {
      const empty = {
        ansem: "0",
        bullet: "0",
        ansemRaw: BigInt(0),
        bulletRaw: BigInt(0),
      };
      setAnsemBalance("0");
      setBulletBalance("0");
      setAnsemRaw(BigInt(0));
      setBulletRaw(BigInt(0));
      return empty;
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    refetch();
    if (!publicKey) return;
    const id = setInterval(refetch, 12_000);
    return () => clearInterval(id);
  }, [refetch, publicKey]);

  return {
    ansemBalance,
    bulletBalance,
    ansemRaw,
    bulletRaw,
    isLoading,
    refetch,
  };
}

export function useLoan() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [loan, setLoan] = useState<LoanView>(EMPTY_LOAN);
  const [isLoading, setIsLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!publicKey) {
      setLoan(EMPTY_LOAN);
      return;
    }
    setIsLoading(true);
    try {
      setLoan(await fetchActiveLoan(publicKey, connection));
    } catch {
      setLoan(EMPTY_LOAN);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { loan, isLoading, refetch };
}

export function useBulletActions() {
  const wallet = useWallet();
  const { connection } = useConnection();

  return {
    mint: (amount: bigint) => mintBullet(wallet, amount, connection),
    burn: (amount: bigint) => burnBullet(wallet, amount, connection),
    borrow: (amount: bigint, days: number) =>
      borrowAnsem(wallet, amount, days, connection),
    leverage: (amount: bigint, days: number) =>
      leveragePosition(wallet, amount, days, connection),
    repay: (loanAddress: string) => repayLoan(wallet, loanAddress, connection),
    liquidate: (loanAddress: string) =>
      liquidateLoan(wallet, loanAddress, connection),
    depositGenesis: (tier: number, amount: bigint) =>
      depositGenesis(wallet, tier, amount, connection),
    withdrawGenesis: (tier: number) =>
      withdrawGenesis(wallet, tier, connection),
    claimGenesis: (tier: number) => claimGenesis(wallet, tier, connection),
  };
}

export function useGenesisVaults() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [vaults, setVaults] = useState<GenesisVaultView[]>(placeholderGenesisVaults);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setIsLoading(true);
      try {
        setVaults(await fetchGenesisVaults(publicKey, connection));
      } catch {
        setVaults(placeholderGenesisVaults());
      } finally {
        setIsLoading(false);
      }
    },
    [publicKey, connection]
  );

  useEffect(() => {
    refetch();
    const id = setInterval(() => refetch({ silent: true }), 15_000);
    return () => clearInterval(id);
  }, [refetch]);

  return { vaults, isLoading, refetch };
}
