import { EmbedBuilder } from "discord.js";
import {
  displayAddress,
  displayNameOf,
  explorerAddr,
  explorerTx,
  fetchTokenImage,
  getProjectConfig,
  openseaToken,
  shortAddr,
  type AnyEvent,
} from "@abotbasho/shared";
import type { EventHandlerSpec } from "../../extensions.js";

const MINT_COLOR = 0x4ade80;

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;
const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export const sampleMint = (): AnyEvent => {
  const cfg = getProjectConfig();
  return {
    type: "mint",
    id: "sample-mint",
    contract: cfg.primary.label,
    contractAddress: cfg.primary.address,
    tokenId: 1n,
    minter: VITALIK,
    txHash: ZERO_HASH,
    blockNumber: 0n,
    logIndex: 0,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    cursor: 0n,
  };
};

export const buildMintEmbed = async (
  event: AnyEvent,
  rpcUrl: string,
  customMessage: string | undefined,
): Promise<EmbedBuilder> => {
  if (event.type !== "mint") {
    throw new Error("buildMintEmbed called with non-mint event");
  }
  const cfg = getProjectConfig();
  const projectFooter = cfg.project.name;

  const [minterName, image] = await Promise.all([
    displayAddress(rpcUrl, event.minter, shortAddr),
    fetchTokenImage(rpcUrl, event.contractAddress, event.tokenId),
  ]);

  const displayContract =
    event.contract === cfg.primary.label
      ? displayNameOf(cfg.primary)
      : cfg.wrapper && event.contract === cfg.wrapper.label
        ? displayNameOf(cfg.wrapper)
        : event.contract;

  const embed = new EmbedBuilder()
    .setColor(MINT_COLOR)
    .setTitle(`${displayContract} #${event.tokenId} | Minted`)
    .setURL(openseaToken(event.contractAddress, event.tokenId))
    .addFields(
      {
        name: "Minter",
        value: `[${minterName}](${explorerAddr(event.minter)})`,
        inline: true,
      },
      {
        name: "Tx",
        value: `[explorer](${explorerTx(event.txHash)})`,
        inline: true,
      },
    )
    .setFooter({ text: customMessage ?? projectFooter })
    .setTimestamp(Number(event.timestamp) * 1000);

  if (image) embed.setImage(image);
  return embed;
};

export const mintHandler: EventHandlerSpec = {
  match: (e) => e.type === "mint",
  channelSlot: "mints",
  messageKind: "mint",
  buildEmbed: buildMintEmbed,
  recentChoice: { name: "mints", value: "mints" },
  debugChoice: { name: "mint", value: "mint", sample: sampleMint },
};
