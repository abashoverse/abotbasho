import type { Chain } from "viem";
import { anvil, mainnet } from "viem/chains";

// viem's bundled `anvil` chain doesn't declare multicall3, but anvil-with-fork
// of mainnet inherits the contract at its canonical address. Patch viem's
// chain object on module load so every consumer (our own viem clients and
// Ponder's handler-side client, built independently from viem's chain
// registry) agrees that multicall3 is available. Idempotent; runs once per
// Node module instance.
if (!anvil.contracts?.multicall3) {
  (anvil as { contracts?: Record<string, unknown> }).contracts = {
    ...(anvil.contracts ?? {}),
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      blockCreated: 14353601,
    },
  };
}

export const ANVIL_CHAIN: Chain = anvil;

export interface ChainProfile {
  id: number;
  ponderName: string;
  viemChain: Chain;
}

const PROFILES: Record<number, ChainProfile> = {
  1: { id: 1, ponderName: "mainnet", viemChain: mainnet },
  31337: { id: 31337, ponderName: "anvil", viemChain: ANVIL_CHAIN },
};

export const getChainProfile = (chainId: number): ChainProfile => {
  const p = PROFILES[chainId];
  if (!p) {
    throw new Error(
      `Unsupported chain id ${chainId}. Built-in profiles: ${Object.keys(PROFILES).join(", ")}. ` +
        `Register additional chains in packages/shared/src/chain.ts.`,
    );
  }
  return p;
};

export const getChainIdFromEnv = (): number => {
  const raw = process.env.INDEXER_CHAIN_ID;
  if (!raw) return 1;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(
      `INDEXER_CHAIN_ID must be a positive integer, got: "${raw}".`,
    );
  }
  return id;
};

export const getChain = (): ChainProfile =>
  getChainProfile(getChainIdFromEnv());

export const getChainRpcUrl = (): string => {
  const id = getChainIdFromEnv();
  const url = process.env[`PONDER_RPC_URL_${id}`];
  if (!url) {
    throw new Error(`PONDER_RPC_URL_${id} is required for chain id ${id}.`);
  }
  return url;
};
