import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import {
  displayAddress,
  displayNameOf,
  explorerAddr,
  fetchTokenImage,
  formatDuration,
  getProjectConfig,
  openseaToken,
  shortAddr,
  tokenOwner,
} from "@abotbasho/shared";
import type { Address } from "viem";
import { env } from "../../../env.js";

const WRAPPED_COLOR = 0x5865f2;
const UNWRAPPED_COLOR = 0xb56b3a;

interface IndexerHolding {
  owner: Address;
  holdingSince: bigint;
}

const fetchIndexerHolding = async (
  tokenId: bigint,
): Promise<IndexerHolding | null> => {
  try {
    const url = `${env.INDEXER_API_URL}/api/holding?tokenId=${tokenId.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      holding: { owner: string; holdingSince: string } | null;
    };
    if (!data.holding) return null;
    return {
      owner: data.holding.owner as Address,
      holdingSince: BigInt(data.holding.holdingSince),
    };
  } catch {
    return null;
  }
};

interface TokenInfo {
  owner: Address;
  status: "wrapped" | "not wrapped";
  durationText: string;
}

const fetchInfo = async (tokenId: bigint): Promise<TokenInfo | null> => {
  const cfg = getProjectConfig();
  const indexed = await fetchIndexerHolding(tokenId);
  if (indexed) {
    const heldFor =
      BigInt(Math.floor(Date.now() / 1000)) - indexed.holdingSince;
    return {
      owner: indexed.owner,
      status: "wrapped",
      durationText: formatDuration(heldFor < 0n ? 0n : heldFor),
    };
  }

  try {
    const owner = await tokenOwner(env.MAINNET_RPC_URL, cfg.primary.address, tokenId);
    return {
      owner,
      status: "not wrapped",
      durationText: "n/a",
    };
  } catch {
    return null;
  }
};

const buildData = () => {
  const cfg = getProjectConfig();
  const builder = new SlashCommandBuilder()
    .setName("wrapped")
    .setDescription(`View wrap status for ${displayNameOf(cfg.primary)} tokens`);
  builder.addIntegerOption((o) => {
    o.setName("id").setDescription("Token ID").setRequired(true);
    if (cfg.primary.totalSupply !== undefined) {
      o.setMinValue(0).setMaxValue(cfg.primary.totalSupply - 1);
    }
    return o;
  });
  return builder;
};

export const wrapped = {
  data: {
    name: "wrapped",
    toJSON: () => buildData().toJSON(),
  },
  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    const cfg = getProjectConfig();
    const id = interaction.options.getInteger("id", true);
    const tokenId = BigInt(id);
    const displayName = displayNameOf(cfg.primary);

    const [info, image] = await Promise.all([
      fetchInfo(tokenId),
      fetchTokenImage(env.MAINNET_RPC_URL, cfg.primary.address, tokenId),
    ]);

    if (!info) {
      await interaction.editReply(
        `${displayName} #${id} doesn't exist or couldn't be loaded.`,
      );
      return;
    }

    const ownerName = await displayAddress(env.MAINNET_RPC_URL, info.owner, shortAddr);

    const embed = new EmbedBuilder()
      .setColor(info.status === "wrapped" ? WRAPPED_COLOR : UNWRAPPED_COLOR)
      .setTitle(`${displayName} #${id} | ${info.status}`)
      .setURL(openseaToken(cfg.primary.address, tokenId))
      .addFields(
        { name: "Owner", value: `[${ownerName}](${explorerAddr(info.owner)})`, inline: true },
        { name: "Held for", value: info.durationText, inline: true },
      );

    if (image) embed.setImage(image);

    await interaction.editReply({ embeds: [embed] });
  },
};
