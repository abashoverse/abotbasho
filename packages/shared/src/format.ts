import { formatEther, type Address } from "viem";
import { getProjectConfig } from "./projectConfig.js";
import type { Currency } from "./types.js";

export const shortAddr = (addr: Address): string =>
  `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export const formatAmount = (wei: bigint, currency: Currency): string => {
  const value = Number(formatEther(wei));
  let str: string;
  if (value >= 100) str = value.toFixed(2);
  else if (value >= 1) str = value.toFixed(3);
  else if (value >= 0.01) str = value.toFixed(4);
  else str = value.toFixed(6);
  str = str.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${str} ${currency}`;
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export const formatUsd = (amount: number): string => usdFormatter.format(amount);

export const weiToUsd = (wei: bigint, ethUsd: number): number =>
  Number(formatEther(wei)) * ethUsd;

const plural = (n: number, singular: string) =>
  `${n} ${singular}${n === 1 ? "" : "s"}`;

export const formatDuration = (seconds: bigint): string => {
  const s = Number(seconds);
  if (s < 60) return plural(s, "second");
  if (s < 3600) return plural(Math.floor(s / 60), "minute");
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m > 0 ? `${plural(h, "hour")}, ${plural(m, "minute")}` : plural(h, "hour");
  }
  const d = Math.floor(s / 86400);
  if (d < 30) {
    const h = Math.floor((s % 86400) / 3600);
    return h > 0 ? `${plural(d, "day")}, ${plural(h, "hour")}` : plural(d, "day");
  }
  if (d < 365) {
    const mo = Math.floor(d / 30);
    const remD = d % 30;
    return remD > 0 ? `${plural(mo, "month")}, ${plural(remD, "day")}` : plural(mo, "month");
  }
  const y = Math.floor(d / 365);
  const remMo = Math.floor((d % 365) / 30);
  return remMo > 0 ? `${plural(y, "year")}, ${plural(remMo, "month")}` : plural(y, "year");
};

export const DEFAULT_EXPLORER_URL = "https://etherscan.io";

const explorerBase = (): string => {
  try {
    const cfg = getProjectConfig();
    return (cfg.explorerUrl ?? DEFAULT_EXPLORER_URL).replace(/\/$/, "");
  } catch {
    return DEFAULT_EXPLORER_URL;
  }
};

export const explorerTx = (hash: string): string =>
  `${explorerBase()}/tx/${hash}`;

export const explorerAddr = (addr: Address): string =>
  `${explorerBase()}/address/${addr}`;

// OpenSea collection paths are chain-specific (`/assets/ethereum/`,
// `/assets/base/`, etc.). Hardcoded to ethereum for now; non-mainnet
// deployments will get broken OpenSea links until this becomes config-driven.
export const openseaToken = (collection: Address, tokenId: bigint): string =>
  `https://opensea.io/assets/ethereum/${collection}/${tokenId.toString()}`;
