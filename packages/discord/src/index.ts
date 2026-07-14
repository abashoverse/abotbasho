import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
} from "discord.js";
import { env } from "./env.js";
import { initConfig } from "./config.js";
import {
  allButtons,
  allCommands,
  loadPlugins,
  shutdownPlugins,
} from "./plugins/loader.js";
import { plugins } from "./plugins/registry.js";

await initConfig(env.CONFIG_FILE);

const client = new Client({
  // GuildMembers is a privileged intent (toggle in the Discord Developer
  // Portal: Bot → SERVER MEMBERS INTENT). Required for /verify-admin sweep
  // to enumerate every member with the holder role; without it, the bot
  // can only see members it has interacted with directly. Safe to leave
  // off if you don't run the sweep, but the bot won't error either way.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  // Prevent any message we send from triggering @everyone / @here / role / user pings,
  // even if external content (RSS title, og:title, custom message) contains the syntax.
  allowedMentions: { parse: [] },
});

client.once("clientReady", async (c) => {
  console.log(`[discord] logged in as ${c.user.tag}`);

  await loadPlugins(client, plugins, env.DATA_DIR);

  try {
    const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
    const cmds = allCommands();
    await rest.put(
      Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
      { body: cmds.map((cmd) => cmd.data.toJSON()) },
    );
    console.log(`[discord] registered ${cmds.length} slash command(s)`);
  } catch (err) {
    console.error("[discord] command registration failed:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const cmd = allCommands().find((c) => c.data.name === interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction);
    } catch (err) {
      console.error(`[discord] /${interaction.commandName} failed:`, err);
      const msg = "Command failed.";
      if (interaction.deferred) await interaction.editReply(msg);
      else if (!interaction.replied)
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (interaction.isButton()) {
    const handler = allButtons().find((b) => b.customId === interaction.customId);
    if (!handler) return;
    try {
      await handler.execute(interaction);
    } catch (err) {
      console.error(`[discord] button ${interaction.customId} failed:`, err);
      const msg = "Button action failed.";
      if (interaction.deferred) await interaction.editReply(msg);
      else if (!interaction.replied)
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    }
    return;
  }
});

// Bun + @discordjs/ws@1.2.3: on a transient gateway network blip, ws emits an
// 'error' whose payload isn't a plain object under Bun, so the library's
// onError (`"code" in error`) throws on a non-object and the process exits 1.
// discord.js reconnects on its own, so log and stay alive instead of dying.
client.on("error", (err) => console.error("[discord] client error:", err));
client.on("shardError", (err) => console.error("[discord] shard error:", err));
process.on("uncaughtException", (err) => {
  console.error("[discord] uncaughtException (continuing):", err);
});
process.on("unhandledRejection", (err) => {
  console.error("[discord] unhandledRejection (continuing):", err);
});

await client.login(env.DISCORD_TOKEN);

const shutdown = async () => {
  console.log("[discord] shutting down");
  await shutdownPlugins();
  await client.destroy();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
