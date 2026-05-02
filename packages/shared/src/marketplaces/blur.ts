import { decodeEventLog, type Address, type Log } from "viem";
import { BlurAbi } from "../abis/Blur.js";
import type { DecodedSale } from "./index.js";

// Blur Exchange v2 (delegate proxy that emits Execution* events).
const BLUR_EXCHANGE_V2: Address = "0xb2ecfE4E4D61f8790bbb9DE2D1259B9e2410CEA5";
const BLUR_SET = new Set([BLUR_EXCHANGE_V2.toLowerCase()]);

const MASK_160 = (1n << 160n) - 1n;
const MASK_88 = (1n << 88n) - 1n;

const toAddress = (n: bigint): Address =>
  ("0x" + n.toString(16).padStart(40, "0")) as Address;

const unpackTokenIdTrader = (packed: bigint) => ({
  tokenId: packed >> 168n,
  trader: toAddress(packed & MASK_160),
});

const unpackCollectionPrice = (packed: bigint) => ({
  collection: toAddress((packed >> 96n) & MASK_160),
  price: (packed >> 8n) & MASK_88,
});

export const decodeBlurSale = (
  logs: readonly Log[],
  nftAddress: Address,
  tokenId: bigint,
): DecodedSale | null => {
  for (const log of logs) {
    if (!BLUR_SET.has(log.address.toLowerCase())) continue;

    let decoded;
    try {
      decoded = decodeEventLog({
        abi: BlurAbi,
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue;
    }

    if (
      decoded.eventName !== "Execution721Packed" &&
      decoded.eventName !== "Execution721TakerFeePacked"
    ) {
      continue;
    }

    const titBigInt = decoded.args.tokenIdListingIndexTrader as bigint;
    const cpsBigInt = decoded.args.collectionPriceSide as bigint;

    const { tokenId: extractedTokenId } = unpackTokenIdTrader(titBigInt);
    const { collection, price } = unpackCollectionPrice(cpsBigInt);

    if (collection.toLowerCase() !== nftAddress.toLowerCase()) continue;
    if (extractedTokenId !== tokenId) continue;
    if (price === 0n) continue;

    return { priceWei: price, currency: "ETH", marketplace: "blur" };
  }
  return null;
};
