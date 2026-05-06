import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { replyWithVerifyLink } from "../start-flow.js";

export const verify = {
  data: new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify NFT holdings to get the holder role"),
  execute: async (interaction: ChatInputCommandInteraction) => {
    await replyWithVerifyLink(interaction);
  },
};
