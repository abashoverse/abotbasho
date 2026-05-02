import { type AnyEvent } from "@abotbasho/shared";

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;
const NICK = "0x983110309620D911731Ac0932219af06091b6744" as const;
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const now = () => BigInt(Math.floor(Date.now() / 1000));

export const sampleWrap = (): AnyEvent => ({
  type: "wrap",
  id: "sample-wrap",
  kind: "wrap",
  tokenId: 1n,
  owner: VITALIK,
  txHash: ZERO_HASH,
  blockNumber: 0n,
  logIndex: 0,
  timestamp: now(),
  cursor: 0n,
});

export const sampleUnwrap = (): AnyEvent => ({
  type: "wrap",
  id: "sample-unwrap",
  kind: "unwrap",
  tokenId: 2n,
  owner: NICK,
  txHash: ZERO_HASH,
  blockNumber: 0n,
  logIndex: 0,
  timestamp: now(),
  cursor: 0n,
});
