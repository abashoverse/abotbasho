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

const BASIC_COLOR = 0xb56b3a;
const WRAPPED_COLOR = 0x5865f2;

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

const buildData = () => {
  const cfg = getProjectConfig();
  const builder = new SlashCommandBuilder()
    .setName("view")
    .setDescription(`View ${displayNameOf(cfg.primary)} token info`);
  builder.addIntegerOption((o) => {
    o.setName("id").setDescription("Token ID").setRequired(true);
    if (cfg.primary.totalSupply !== undefined) {
      o.setMinValue(0).setMaxValue(cfg.primary.totalSupply - 1);
    }
    return o;
  });
  return builder;
};

export const view = {
  data: {
    name: "view",
    toJSON: () => buildData().toJSON(),
  },
  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply();
    const cfg = getProjectConfig();
    const id = interaction.options.getInteger("id", true);
    const tokenId = BigInt(id);
    const displayName = displayNameOf(cfg.primary);

    const wrapped = cfg.wrapper ? await fetchIndexerHolding(tokenId) : null;

    let owner: Address;
    if (wrapped) {
      owner = wrapped.owner;
    } else {
      try {
        owner = await tokenOwner(
          env.MAINNET_RPC_URL,
          cfg.primary.address,
          tokenId,
        );
      } catch {
        await interaction.editReply(
          `${displayName} #${id} doesn't exist or couldn't be loaded.`,
        );
        return;
      }
    }

    const [ownerName, image] = await Promise.all([
      displayAddress(env.MAINNET_RPC_URL, owner, shortAddr),
      fetchTokenImage(env.MAINNET_RPC_URL, cfg.primary.address, tokenId),
    ]);

    const embed = new EmbedBuilder()
      .setColor(wrapped ? WRAPPED_COLOR : BASIC_COLOR)
      .setTitle(wrapped ? `${displayName} #${id} | wrapped` : `${displayName} #${id}`)
      .setURL(openseaToken(cfg.primary.address, tokenId))
      .addFields({
        name: "Owner",
        value: `[${ownerName}](${explorerAddr(owner)})`,
        inline: true,
      });

    if (wrapped) {
      const heldFor =
        BigInt(Math.floor(Date.now() / 1000)) - wrapped.holdingSince;
      embed.addFields({
        name: "Held for",
        value: formatDuration(heldFor < 0n ? 0n : heldFor),
        inline: true,
      });
    }

    if (image) embed.setImage(image);

    await interaction.editReply({ embeds: [embed] });
  },
};
