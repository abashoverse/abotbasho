import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Client } from "discord.js";
import type { DiscordPlugin, PluginContext, SlashCommand } from "./types.js";

interface LoadedPlugin {
  plugin: DiscordPlugin;
  context: PluginContext;
  intervalHandles: ReturnType<typeof setInterval>[];
}

const loaded: LoadedPlugin[] = [];

export const loadPlugins = async (
  client: Client,
  plugins: DiscordPlugin[],
  baseDataDir: string,
): Promise<void> => {
  for (const plugin of plugins) {
    if (plugin.enabled === false) {
      console.log(`[plugin:${plugin.name}] disabled, skipping`);
      continue;
    }

    const dataDir = join(baseDataDir, "plugins", plugin.name);
    await mkdir(dataDir, { recursive: true });

    const context: PluginContext = {
      client,
      pluginName: plugin.name,
      log: (...args) => console.log(`[plugin:${plugin.name}]`, ...args),
      errorLog: (...args) => console.error(`[plugin:${plugin.name}]`, ...args),
      dataDir,
    };

    try {
      if (plugin.init) await plugin.init(context);
    } catch (err) {
      context.errorLog("init failed:", err);
      continue;
    }

    const intervalHandles: ReturnType<typeof setInterval>[] = [];
    for (const interval of plugin.intervals ?? []) {
      const run = async () => {
        try {
          await interval.handler(context);
        } catch (err) {
          context.errorLog(`interval ${interval.name} failed:`, err);
        }
      };
      if (interval.runImmediately) void run();
      intervalHandles.push(setInterval(run, interval.intervalMs));
    }

    loaded.push({ plugin, context, intervalHandles });
    context.log("loaded");
  }
};

export const allCommands = (): SlashCommand[] =>
  loaded.flatMap((p) => p.plugin.commands ?? []);

export const shutdownPlugins = async (): Promise<void> => {
  for (const { plugin, context, intervalHandles } of loaded.slice().reverse()) {
    for (const h of intervalHandles) clearInterval(h);
    try {
      if (plugin.shutdown) await plugin.shutdown(context);
    } catch (err) {
      context.errorLog("shutdown failed:", err);
    }
  }
};
