const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

const TTL_MS = 60_000;
let cache: { price: number; expiresAt: number } | null = null;

export const ethUsdPrice = async (): Promise<number | null> => {
  if (cache && cache.expiresAt > Date.now()) return cache.price;
  try {
    const res = await fetch(COINGECKO_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ethereum?: { usd?: number } };
    const price = data.ethereum?.usd;
    if (typeof price !== "number" || price <= 0) return null;
    cache = { price, expiresAt: Date.now() + TTL_MS };
    return price;
  } catch {
    return null;
  }
};
