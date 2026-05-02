import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import {
  displayAddress,
  displayNameOf,
  etherscanAddr,
  fetchTokenImage,
  getProjectConfig,
  openseaToken,
  shortAddr,
  tokenOwner,
} from "@abotbasho/shared";
import type { Address } from "viem";
import { env } from "../../../env.js";

const VIEW_COLOR = 0xb56b3a;

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

    let owner: Address;
    try {
      owner = await tokenOwner(env.MAINNET_RPC_URL, cfg.primary.address, tokenId);
    } catch {
      await interaction.editReply(
        `${displayName} #${id} doesn't exist or couldn't be loaded.`,
      );
      return;
    }

    const [ownerName, image] = await Promise.all([
      displayAddress(env.MAINNET_RPC_URL, owner, shortAddr),
      fetchTokenImage(env.MAINNET_RPC_URL, cfg.primary.address, tokenId),
    ]);

    const embed = new EmbedBuilder()
      .setColor(VIEW_COLOR)
      .setTitle(`${displayName} #${id}`)
      .setURL(openseaToken(cfg.primary.address, tokenId))
      .addFields({
        name: "Owner",
        value: `[${ownerName}](${etherscanAddr(owner)})`,
        inline: true,
      });

    if (image) embed.setImage(image);

    await interaction.editReply({ embeds: [embed] });
  },
};
