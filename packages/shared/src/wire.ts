import type {
  Currency,
  Marketplace,
  SaleEvent,
  WrapEvent,
  AnyEvent,
} from "./types.js";
import type { Address, Hex } from "viem";

interface SaleEventWire {
  id: string;
  contract: string;
  contractAddress: Address;
  tokenId: string;
  fromAddress: Address;
  toAddress: Address;
  priceWei: string;
  currency: Currency;
  marketplace: Marketplace;
  txHash: Hex;
  blockNumber: string;
  logIndex: number;
  timestamp: string;
  cursor: string;
}

interface WrapEventWire {
  id: string;
  kind: "wrap" | "unwrap";
  tokenId: string;
  owner: Address;
  txHash: Hex;
  blockNumber: string;
  logIndex: number;
  timestamp: string;
  cursor: string;
}

export interface EventsResponse {
  sales: SaleEventWire[];
  wraps: WrapEventWire[];
}

export const parseSaleEvent = (w: SaleEventWire): SaleEvent => ({
  id: w.id,
  contract: w.contract,
  contractAddress: w.contractAddress,
  tokenId: BigInt(w.tokenId),
  fromAddress: w.fromAddress,
  toAddress: w.toAddress,
  priceWei: BigInt(w.priceWei),
  currency: w.currency,
  marketplace: w.marketplace,
  txHash: w.txHash,
  blockNumber: BigInt(w.blockNumber),
  logIndex: w.logIndex,
  timestamp: BigInt(w.timestamp),
  cursor: BigInt(w.cursor),
});

export const parseWrapEvent = (w: WrapEventWire): WrapEvent => ({
  id: w.id,
  kind: w.kind,
  tokenId: BigInt(w.tokenId),
  owner: w.owner,
  txHash: w.txHash,
  blockNumber: BigInt(w.blockNumber),
  logIndex: w.logIndex,
  timestamp: BigInt(w.timestamp),
  cursor: BigInt(w.cursor),
});

export const parseEvents = (resp: EventsResponse): AnyEvent[] => {
  const merged: AnyEvent[] = [
    ...resp.sales.map((s) => ({ type: "sale" as const, ...parseSaleEvent(s) })),
    ...resp.wraps.map((w) => ({ type: "wrap" as const, ...parseWrapEvent(w) })),
  ];
  merged.sort((a, b) => (a.cursor < b.cursor ? -1 : a.cursor > b.cursor ? 1 : 0));
  return merged;
};
