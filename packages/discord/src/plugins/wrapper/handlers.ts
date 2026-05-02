import { EmbedBuilder } from "discord.js";
import {
  displayAddress,
  displayNameOf,
  etherscanAddr,
  etherscanTx,
  fetchTokenImage,
  getProjectConfig,
  openseaToken,
  shortAddr,
  type AnyEvent,
} from "@abotbasho/shared";
import type { EventHandlerSpec } from "../extensions.js";
import { sampleUnwrap, sampleWrap } from "./samples.js";

const WRAP_COLOR = 0x5865f2;
const UNWRAP_COLOR = 0x9b6dff;

export const buildWrapEmbed = async (
  event: AnyEvent,
  rpcUrl: string,
  customMessage: string | undefined,
): Promise<EmbedBuilder> => {
  if (event.type !== "wrap") {
    throw new Error("buildWrapEmbed called with non-wrap event");
  }
  const cfg = getProjectConfig();
  if (!cfg.wrapper) {
    throw new Error("buildWrapEmbed: wrapper config missing");
  }
  const projectFooter = cfg.project.name;

  const isWrap = event.kind === "wrap";
  const stateLabel = isWrap ? "Wrapped" : "Unwrapped";
  const titleContract = isWrap
    ? displayNameOf(cfg.primary)
    : displayNameOf(cfg.wrapper);
  const linkAddress = isWrap ? cfg.wrapper.address : cfg.primary.address;

  const [ownerName, image] = await Promise.all([
    displayAddress(rpcUrl, event.owner, shortAddr),
    fetchTokenImage(rpcUrl, cfg.primary.address, event.tokenId),
  ]);

  const embed = new EmbedBuilder()
    .setColor(isWrap ? WRAP_COLOR : UNWRAP_COLOR)
    .setTitle(`${titleContract} #${event.tokenId} | ${stateLabel}`)
    .setURL(openseaToken(linkAddress, event.tokenId))
    .addFields(
      { name: "By", value: `[${ownerName}](${etherscanAddr(event.owner)})`, inline: true },
      { name: "Tx", value: `[etherscan](${etherscanTx(event.txHash)})`, inline: true },
    )
    .setFooter({ text: customMessage ?? projectFooter })
    .setTimestamp(Number(event.timestamp) * 1000);

  if (image) embed.setImage(image);
  return embed;
};

export const wrapHandler: EventHandlerSpec = {
  match: (e) => e.type === "wrap" && e.kind === "wrap",
  channelSlot: "wraps",
  messageKind: "wrap",
  buildEmbed: buildWrapEmbed,
  recentChoice: { name: "wraps", value: "wraps" },
  debugChoice: { name: "wrap", value: "wrap", sample: sampleWrap },
};

export const unwrapHandler: EventHandlerSpec = {
  match: (e) => e.type === "wrap" && e.kind === "unwrap",
  channelSlot: "unwraps",
  messageKind: "unwrap",
  buildEmbed: buildWrapEmbed,
  recentChoice: { name: "unwraps", value: "unwraps" },
  debugChoice: { name: "unwrap", value: "unwrap", sample: sampleUnwrap },
};
