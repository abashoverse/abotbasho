import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { mainnet } from "viem/chains";

interface CacheEntry {
  name: string | null;
  expiresAt: number;
}

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

let client: PublicClient | null = null;

const getClient = (rpcUrl: string): PublicClient => {
  if (!client) {
    client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    });
  }
  return client;
};

export const resolveEns = async (
  rpcUrl: string,
  address: Address,
): Promise<string | null> => {
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.name;

  try {
    const name = await getClient(rpcUrl).getEnsName({ address });
    cache.set(key, { name, expiresAt: Date.now() + TTL_MS });
    return name;
  } catch {
    cache.set(key, { name: null, expiresAt: Date.now() + 5 * 60 * 1000 });
    return null;
  }
};

export const displayAddress = async (
  rpcUrl: string,
  address: Address,
  fallback: (a: Address) => string,
): Promise<string> => {
  const name = await resolveEns(rpcUrl, address);
  return name ?? fallback(address);
};
