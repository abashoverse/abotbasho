import type { Address, Hex } from "viem";

export type Marketplace = "seaport" | "blur" | "unknown";

export type Currency = "ETH" | "WETH";

export interface SaleEvent {
  id: string;
  contract: string;
  contractAddress: Address;
  tokenId: bigint;
  fromAddress: Address;
  toAddress: Address;
  priceWei: bigint;
  currency: Currency;
  marketplace: Marketplace;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  timestamp: bigint;
  cursor: bigint;
}

export interface WrapEvent {
  id: string;
  kind: "wrap" | "unwrap";
  tokenId: bigint;
  owner: Address;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  timestamp: bigint;
  cursor: bigint;
}

export type AnyEvent =
  | ({ type: "sale" } & SaleEvent)
  | ({ type: "wrap" } & WrapEvent);

export const cursorOf = (blockNumber: bigint, logIndex: number): bigint =>
  blockNumber * 1_000_000n + BigInt(logIndex);
