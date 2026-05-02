import type {
  ChatInputCommandInteraction,
  Client,
  SlashCommandBuilder,
} from "discord.js";

export interface SlashCommand {
  data: Pick<SlashCommandBuilder, "name" | "toJSON">;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface PluginContext {
  client: Client;
  pluginName: string;
  log: (...args: unknown[]) => void;
  errorLog: (...args: unknown[]) => void;
  dataDir: string;
}

export interface PluginInterval {
  name: string;
  intervalMs: number;
  runImmediately?: boolean;
  handler: (ctx: PluginContext) => Promise<void>;
}

export interface DiscordPlugin {
  name: string;
  description?: string;
  enabled?: boolean;
  init?: (ctx: PluginContext) => Promise<void>;
  shutdown?: (ctx: PluginContext) => Promise<void>;
  commands?: SlashCommand[];
  intervals?: PluginInterval[];
}
