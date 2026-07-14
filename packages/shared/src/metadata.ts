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

interface TokenMetadata {
  image?: string;
  image_url?: string;
}

const METADATA_TIMEOUT_MS = 10000;
const METADATA_ATTEMPTS = 2;

// Off-chain metadata usually lives behind an IPFS gateway that times out or
// 5xxs intermittently. Retry a couple of times so a transient blip doesn't
// strip the image off an otherwise-fine sale post.
const fetchMetadataJson = async (uri: string): Promise<TokenMetadata> => {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= METADATA_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(uri, {
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`metadata HTTP ${res.status}`);
      return (await res.json()) as TokenMetadata;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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

    const metadata: TokenMetadata = rawUri.startsWith("data:application/json")
      ? (parseDataJson(rawUri) as TokenMetadata)
      : await fetchMetadataJson(resolveUri(rawUri));

    const image = metadata.image ?? metadata.image_url ?? null;
    const resolved = image ? resolveUri(image) : null;
    // Cache only successful resolutions — including a genuine "metadata has no
    // image field" null, which won't change. Errors are handled below.
    cache.set(key, resolved);
    return resolved;
  } catch {
    // Transient RPC/IPFS failure: return null but DON'T cache it, otherwise one
    // blip poisons the cache and this token stays imageless until restart.
    return null;
  }
};
