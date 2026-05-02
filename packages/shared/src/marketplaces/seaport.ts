import { decodeEventLog, type Address, type Log } from "viem";
import { SeaportAbi } from "../abis/Seaport.js";
import { SEAPORT_ADDRESSES, WETH_ADDRESS } from "../constants.js";
import type { Currency } from "../types.js";
import type { DecodedSale } from "./index.js";

const SEAPORT_SET = new Set(SEAPORT_ADDRESSES.map((a) => a.toLowerCase()));

const ITEM_TYPE_NATIVE = 0;
const ITEM_TYPE_ERC20 = 1;
const ITEM_TYPE_ERC721 = 2;

interface SpentItem {
  itemType: number;
  token: Address;
  identifier: bigint;
  amount: bigint;
}

interface ReceivedItem extends SpentItem {
  recipient: Address;
}

const currencyOf = (item: { itemType: number; token: Address }): Currency | null => {
  if (item.itemType === ITEM_TYPE_NATIVE) return "ETH";
  if (
    item.itemType === ITEM_TYPE_ERC20 &&
    item.token.toLowerCase() === WETH_ADDRESS.toLowerCase()
  ) {
    return "WETH";
  }
  return null;
};

const isNftItem = (
  item: { itemType: number; token: Address; identifier: bigint },
  nftAddress: Address,
  tokenId: bigint,
): boolean =>
  item.itemType === ITEM_TYPE_ERC721 &&
  item.token.toLowerCase() === nftAddress.toLowerCase() &&
  item.identifier === tokenId;

const totalForCurrency = (
  items: readonly { itemType: number; token: Address; amount: bigint }[],
): { priceWei: bigint; currency: Currency } | null => {
  let currency: Currency | null = null;
  let total = 0n;
  for (const i of items) {
    const c = currencyOf(i);
    if (!c) continue;
    if (currency === null) currency = c;
    else if (currency !== c) return null;
    total += i.amount;
  }
  if (currency === null || total === 0n) return null;
  return { priceWei: total, currency };
};

export const decodeSeaportSale = (
  logs: readonly Log[],
  nftAddress: Address,
  tokenId: bigint,
): DecodedSale | null => {
  for (const log of logs) {
    if (!SEAPORT_SET.has(log.address.toLowerCase())) continue;

    let decoded;
    try {
      decoded = decodeEventLog({
        abi: SeaportAbi,
        data: log.data,
        topics: log.topics,
        eventName: "OrderFulfilled",
      });
    } catch {
      continue;
    }

    const offer = decoded.args.offer as readonly SpentItem[];
    const consideration = decoded.args.consideration as readonly ReceivedItem[];

    const nftInOffer = offer.some((i) => isNftItem(i, nftAddress, tokenId));
    if (nftInOffer) {
      const result = totalForCurrency(consideration);
      if (result) return { ...result, marketplace: "seaport" };
      continue;
    }

    const nftInConsideration = consideration.some((i) => isNftItem(i, nftAddress, tokenId));
    if (nftInConsideration) {
      const result = totalForCurrency(offer);
      if (result) return { ...result, marketplace: "seaport" };
    }
  }

  return null;
};
