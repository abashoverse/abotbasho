import type { Address, Log } from "viem";
import type { Currency, Marketplace } from "../types.js";
import { decodeSeaportSale } from "./seaport.js";
import { decodeBlurSale } from "./blur.js";

export interface DecodedSale {
  priceWei: bigint;
  currency: Currency;
  marketplace: Marketplace;
}

export const decodeMarketplaceSale = (
  logs: readonly Log[],
  nftAddress: Address,
  tokenId: bigint,
): DecodedSale | null => {
  const fromSeaport = decodeSeaportSale(logs, nftAddress, tokenId);
  if (fromSeaport) return fromSeaport;
  const fromBlur = decodeBlurSale(logs, nftAddress, tokenId);
  if (fromBlur) return fromBlur;
  return null;
};

export { decodeSeaportSale } from "./seaport.js";
export { decodeBlurSale } from "./blur.js";
