import { EmbedBuilder } from "discord.js";
import {
  displayAddress,
  displayNameOf,
  explorerAddr,
  explorerTx,
  getProjectConfig,
  loadTokenImage,
  openseaToken,
  shortAddr,
  type AnyEvent,
} from "@abotbasho/shared";
import { withTokenImage, type BuiltEmbed } from "../../embedImage.js";
import type { EventHandlerSpec } from "../extensions.js";
import { sampleUnwrap, sampleWrap } from "./samples.js";

const WRAP_COLOR = 0x5865f2;
const UNWRAP_COLOR = 0x9b6dff;

export const buildWrapEmbed = async (
  event: AnyEvent,
  rpcUrl: string,
  customMessage: string | undefined,
): Promise<BuiltEmbed> => {
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
    loadTokenImage(rpcUrl, event.tokenId),
  ]);

  const embed = new EmbedBuilder()
    .setColor(isWrap ? WRAP_COLOR : UNWRAP_COLOR)
    .setTitle(`${titleContract} #${event.tokenId} | ${stateLabel}`)
    .setURL(openseaToken(linkAddress, event.tokenId))
    .addFields(
      { name: "By", value: `[${ownerName}](${explorerAddr(event.owner)})`, inline: true },
      { name: "Tx", value: `[explorer](${explorerTx(event.txHash)})`, inline: true },
    )
    .setFooter({ text: customMessage ?? projectFooter })
    .setTimestamp(Number(event.timestamp) * 1000);

  return withTokenImage(embed, image);
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
