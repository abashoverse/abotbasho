import type { Address, PublicClient } from "viem";
import { DELEGATE_REGISTRY_V2_ADDRESS } from "@abotbasho/shared";
import { DelegateRegistryV2Abi } from "@abotbasho/shared/abis";

const ZERO_RIGHTS =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  result: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const cacheKey = (
  kind: "all" | "contract",
  to: Address,
  from: Address,
  contract?: Address,
): string =>
  `${kind}:${to.toLowerCase()}:${from.toLowerCase()}:${contract?.toLowerCase() ?? ""}`;

const getCached = (key: string): boolean | undefined => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
};

const setCached = (key: string, result: boolean): void => {
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
};

const checkDelegateForAll = async (
  client: PublicClient,
  to: Address,
  from: Address,
): Promise<boolean> => {
  const key = cacheKey("all", to, from);
  const cached = getCached(key);
  if (cached !== undefined) return cached;
  const result = (await client.readContract({
    address: DELEGATE_REGISTRY_V2_ADDRESS,
    abi: DelegateRegistryV2Abi,
    functionName: "checkDelegateForAll",
    args: [to, from, ZERO_RIGHTS],
  })) as boolean;
  setCached(key, result);
  return result;
};

const checkDelegateForContract = async (
  client: PublicClient,
  to: Address,
  contract: Address,
  from: Address,
): Promise<boolean> => {
  const key = cacheKey("contract", to, from, contract);
  const cached = getCached(key);
  if (cached !== undefined) return cached;
  const result = (await client.readContract({
    address: DELEGATE_REGISTRY_V2_ADDRESS,
    abi: DelegateRegistryV2Abi,
    functionName: "checkDelegateForContract",
    args: [to, contract, from, ZERO_RIGHTS],
  })) as boolean;
  setCached(key, result);
  return result;
};

/**
 * True iff `signer` is delegated by `coldWallet` for any of the configured
 * collections (primary, optional wrapper), either via blanket (delegateAll)
 * or contract-scoped (delegateContract). Token-scoped delegations are
 * intentionally rejected so a cold wallet cannot delegate a single token to
 * a hot wallet to game the binary role.
 */
export const isDelegatedHolderOf = async (
  client: PublicClient,
  params: {
    signer: Address;
    coldWallet: Address;
    collectionContracts: readonly Address[];
  },
): Promise<boolean> => {
  if (await checkDelegateForAll(client, params.signer, params.coldWallet)) {
    return true;
  }
  for (const contract of params.collectionContracts) {
    if (
      await checkDelegateForContract(
        client,
        params.signer,
        contract,
        params.coldWallet,
      )
    ) {
      return true;
    }
  }
  return false;
};
