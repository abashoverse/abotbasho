import { EmbedBuilder } from "discord.js";
import {
  displayAddress,
  displayNameOf,
  ethUsdPrice,
  explorerAddr,
  explorerTx,
  fetchTokenImage,
  formatAmount,
  formatUsd,
  getProjectConfig,
  openseaToken,
  shortAddr,
  weiToUsd,
  type AnyEvent,
} from "@abotbasho/shared";
import type { EventHandlerSpec } from "../../extensions.js";

const SALE_COLOR = 0xb56b3a;

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;
const NICK = "0x983110309620D911731Ac0932219af06091b6744" as const;
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export const sampleSale = (): AnyEvent => {
  const cfg = getProjectConfig();
  return {
    type: "sale",
    id: "sample-sale",
    contract: cfg.primary.label,
    contractAddress: cfg.primary.address,
    tokenId: 1n,
    fromAddress: VITALIK,
    toAddress: NICK,
    priceWei: 5n * 10n ** 17n,
    currency: "ETH",
    marketplace: "seaport",
    txHash: ZERO_HASH,
    blockNumber: 0n,
    logIndex: 0,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    cursor: 0n,
  };
};

export const buildSaleEmbed = async (
  event: AnyEvent,
  rpcUrl: string,
  customMessage: string | undefined,
): Promise<EmbedBuilder> => {
  if (event.type !== "sale") {
    throw new Error("buildSaleEmbed called with non-sale event");
  }
  const cfg = getProjectConfig();
  const projectFooter = cfg.project.name;

  const [sellerName, buyerName, image, ethUsd] = await Promise.all([
    displayAddress(rpcUrl, event.fromAddress, shortAddr),
    displayAddress(rpcUrl, event.toAddress, shortAddr),
    fetchTokenImage(rpcUrl, event.contractAddress, event.tokenId),
    ethUsdPrice(),
  ]);

  const priceText = formatAmount(event.priceWei, event.currency);
  const usdText = ethUsd
    ? ` (${formatUsd(weiToUsd(event.priceWei, ethUsd))})`
    : "";
  const displayContract =
    event.contract === cfg.primary.label
      ? displayNameOf(cfg.primary)
      : cfg.wrapper && event.contract === cfg.wrapper.label
        ? displayNameOf(cfg.wrapper)
        : event.contract;

  const embed = new EmbedBuilder()
    .setColor(SALE_COLOR)
    .setTitle(
      `${displayContract} #${event.tokenId} has been bought for ${priceText}${usdText}`,
    )
    .setURL(openseaToken(event.contractAddress, event.tokenId))
    .addFields(
      { name: "Seller", value: `[${sellerName}](${explorerAddr(event.fromAddress)})`, inline: true },
      { name: "Buyer", value: `[${buyerName}](${explorerAddr(event.toAddress)})`, inline: true },
      { name: "Tx", value: `[explorer](${explorerTx(event.txHash)})`, inline: true },
    )
    .setFooter({ text: customMessage ?? projectFooter })
    .setTimestamp(Number(event.timestamp) * 1000);

  if (image) embed.setImage(image);
  return embed;
};

export const saleHandler: EventHandlerSpec = {
  match: (e) => e.type === "sale",
  channelSlot: "sales",
  messageKind: "sale",
  buildEmbed: buildSaleEmbed,
  recentChoice: { name: "sales", value: "sales" },
  debugChoice: { name: "sale", value: "sale", sample: sampleSale },
};
