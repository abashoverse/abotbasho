import { Resvg } from "@resvg/resvg-js";
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

/** Raster image bytes ready to upload to Discord or X. */
export interface TokenImage {
  data: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  /** File name with a matching extension, e.g. `abasho-186.png`. */
  fileName: string;
}

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

interface DataUri {
  mime: string;
  bytes: Buffer;
}

const parseDataUri = (uri: string): DataUri => {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("malformed data URI");
  const header = uri.slice("data:".length, comma);
  const payload = uri.slice(comma + 1);
  const isBase64 = header.endsWith(";base64");
  const mime = (header.split(";")[0] || "text/plain").toLowerCase();
  const bytes = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { mime, bytes };
};

interface TokenMetadata {
  image?: string;
  image_url?: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const FETCH_ATTEMPTS = 2;
const MAX_IMAGE_BYTES = 5_000_000; // X's limit for tweet images
const RENDER_WIDTH_PX = 1000;

// Off-chain metadata usually lives behind an IPFS gateway that times out or
// 5xxs intermittently. Retry once so a blip doesn't strip the image off a
// post. 4xx answers are final: retrying a 429 from a retired gateway (ipfs.io
// since Sept 2026) only adds delay before we fall back to the next contract.
const fetchWithRetry = async (url: string): Promise<Response> => {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status < 500) break;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
};

const readLimited = async (res: Response): Promise<Buffer> => {
  const len = res.headers.get("content-length");
  if (len && Number(len) > MAX_IMAGE_BYTES) {
    throw new Error(`image is ${len} bytes, limit ${MAX_IMAGE_BYTES}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`image is ${buf.byteLength} bytes, limit ${MAX_IMAGE_BYTES}`);
  }
  return buf;
};

// Neither Discord embeds nor X accept SVG, so on-chain SVG art is rendered
// to PNG here. The SVG's own size is ignored in favour of a fixed width, which
// keeps pixel art (16x16 viewBox) crisp instead of a tiny thumbnail.
const svgToPng = (svg: Buffer): Buffer =>
  Buffer.from(
    new Resvg(svg, { fitTo: { mode: "width", value: RENDER_WIDTH_PX } }).render().asPng(),
  );

const RASTER_EXT: Record<TokenImage["mimeType"], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const toRaster = (mime: string, bytes: Buffer): Omit<TokenImage, "fileName"> => {
  const m = mime.split(";")[0]!.trim().toLowerCase();
  if (m === "image/svg+xml") return { data: svgToPng(bytes), mimeType: "image/png" };
  if (m in RASTER_EXT) return { data: bytes, mimeType: m as TokenImage["mimeType"] };
  throw new Error(`unsupported image type ${mime}`);
};

const readMetadata = async (rawUri: string): Promise<TokenMetadata> => {
  if (rawUri.startsWith("data:")) {
    return JSON.parse(parseDataUri(rawUri).bytes.toString("utf8")) as TokenMetadata;
  }
  const res = await fetchWithRetry(resolveUri(rawUri));
  return (await res.json()) as TokenMetadata;
};

const imageFromSource = async (
  source: string,
): Promise<Omit<TokenImage, "fileName">> => {
  if (source.startsWith("data:")) {
    const { mime, bytes } = parseDataUri(source);
    return toRaster(mime, bytes);
  }
  const res = await fetchWithRetry(resolveUri(source));
  const bytes = await readLimited(res);
  return toRaster(res.headers.get("content-type") ?? "image/png", bytes);
};

// Image *source* per contract+token: the metadata's `image` string (a data URI
// or URL), or null when the metadata genuinely has none. Sources are small and
// never change, so caching them saves an RPC call and a metadata fetch per
// post. Bytes aren't cached: rendering a small SVG takes milliseconds.
const SOURCE_CACHE_MAX = 2_000;
const sourceCache = new Map<string, string | null>();

const cacheSource = (key: string, source: string | null): void => {
  if (sourceCache.size >= SOURCE_CACHE_MAX) {
    const oldest = sourceCache.keys().next().value;
    if (oldest !== undefined) sourceCache.delete(oldest);
  }
  sourceCache.set(key, source);
};

const imageSourceFor = async (
  rpcUrl: string,
  contract: Address,
  tokenId: bigint,
): Promise<string | null> => {
  const key = `${contract.toLowerCase()}:${tokenId}`;
  if (sourceCache.has(key)) return sourceCache.get(key) ?? null;
  const rawUri = await getClient(rpcUrl).readContract({
    address: contract,
    abi: tokenUriAbi,
    functionName: "tokenURI",
    args: [tokenId],
  });
  const metadata = await readMetadata(rawUri);
  const source = metadata.image ?? metadata.image_url ?? null;
  cacheSource(key, source);
  return source;
};

// Short-lived memory of failed contract+token lookups. Without it, every post
// would first wait on the dead source again (ipfs.io for Abasho's primary)
// before falling back. Long enough to skip repeats, short enough that a
// recovered gateway is picked up again.
const FAILURE_TTL_MS = 10 * 60 * 1000;
const failedUntil = new Map<string, number>();

const markFailed = (key: string): void => {
  const now = Date.now();
  if (failedUntil.size >= SOURCE_CACHE_MAX) {
    for (const [k, until] of failedUntil) if (until <= now) failedUntil.delete(k);
    if (failedUntil.size >= SOURCE_CACHE_MAX) failedUntil.clear();
  }
  failedUntil.set(key, now + FAILURE_TTL_MS);
};

const candidateContracts =(preferred?: Address): Address[] => {
  const cfg = getProjectConfig();
  const all = [preferred, cfg.primary.address, cfg.wrapper?.address].filter(
    (a): a is Address => a !== undefined,
  );
  return all.filter(
    (a, i) => all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i,
  );
};

/**
 * Load a token's image as uploadable raster bytes.
 *
 * Tries `preferred` (usually the contract the event happened on) first, then
 * the primary and wrapper contracts. The fallback matters when one contract's
 * metadata is unreachable: Abasho's primary points at ipfs.io, which stopped
 * serving HTTP in Sept 2026, while the wrapper carries the same art on-chain.
 *
 * Returns null when no contract yields an image. Failures aren't cached, so a
 * transient RPC or gateway error doesn't leave the token imageless.
 */
export const loadTokenImage = async (
  rpcUrl: string,
  tokenId: bigint,
  preferred?: Address,
): Promise<TokenImage | null> => {
  const cfg = getProjectConfig();
  const slug = cfg.primary.label.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "token";
  for (const contract of candidateContracts(preferred)) {
    const key = `${contract.toLowerCase()}:${tokenId}`;
    if ((failedUntil.get(key) ?? 0) > Date.now()) continue;
    try {
      const source = await imageSourceFor(rpcUrl, contract, tokenId);
      if (!source) continue;
      const image = await imageFromSource(source);
      failedUntil.delete(key);
      return { ...image, fileName: `${slug}-${tokenId}.${RASTER_EXT[image.mimeType]}` };
    } catch (err) {
      markFailed(key);
      const e = err as { shortMessage?: string; message?: string };
      console.warn(
        `[metadata] no image for #${tokenId} from ${contract}: ${e.shortMessage ?? e.message ?? err}`,
      );
    }
  }
  return null;
};
