import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { getChain } from "./chain.js";
import { DEFAULT_IPFS_GATEWAY, getProjectConfig } from "./projectConfig.js";

const tokenUriAbi = [
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const cache = new Map<string, string | null>();
let client: PublicClient | null = null;

const getClient = (rpcUrl: string): PublicClient => {
  if (!client) {
    client = createPublicClient({
      chain: getChain().viemChain,
      transport: http(rpcUrl),
    });
  }
  return client;
};

const IPFS_HTTP_RE = /^https?:\/\/[^/]+\/ipfs\//;

const ipfsGateway = (): string =>
  getProjectConfig().ipfsGateway ?? DEFAULT_IPFS_GATEWAY;

const resolveUri = (uri: string): string => {
  const gateway = ipfsGateway();
  if (uri.startsWith("ipfs://")) {
    return gateway + uri.slice("ipfs://".length).replace(/^ipfs\//, "");
  }
  if (IPFS_HTTP_RE.test(uri) && gateway !== DEFAULT_IPFS_GATEWAY) {
    return uri.replace(IPFS_HTTP_RE, gateway);
  }
  return uri;
};

const parseDataJson = (uri: string): unknown => {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("malformed data URI");
  const payload = uri.slice(comma + 1);
  const decoded = uri.includes(";base64,")
    ? Buffer.from(payload, "base64").toString("utf8")
    : decodeURIComponent(payload);
  return JSON.parse(decoded);
};

export const fetchTokenImage = async (
  rpcUrl: string,
  contract: Address,
  tokenId: bigint,
): Promise<string | null> => {
  const key = `${contract.toLowerCase()}:${tokenId.toString()}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const rawUri = await getClient(rpcUrl).readContract({
      address: contract,
      abi: tokenUriAbi,
      functionName: "tokenURI",
      args: [tokenId],
    });

    let metadata: { image?: string; image_url?: string };
    if (rawUri.startsWith("data:application/json")) {
      metadata = parseDataJson(rawUri) as typeof metadata;
    } else {
      const res = await fetch(resolveUri(rawUri), {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`metadata HTTP ${res.status}`);
      metadata = (await res.json()) as typeof metadata;
    }

    const image = metadata.image ?? metadata.image_url ?? null;
    const resolved = image ? resolveUri(image) : null;
    cache.set(key, resolved);
    return resolved;
  } catch {
    cache.set(key, null);
    return null;
  }
};
