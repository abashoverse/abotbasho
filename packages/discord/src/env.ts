import { loadConfig, loadRootEnv } from "@abotbasho/shared";

loadRootEnv();
await loadConfig();

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
};

export const env = {
  DISCORD_TOKEN: required("DISCORD_TOKEN"),
  DISCORD_CLIENT_ID: required("DISCORD_CLIENT_ID"),
  DISCORD_GUILD_ID: required("DISCORD_GUILD_ID"),
  DISCORD_CHANNEL_ID: required("DISCORD_CHANNEL_ID"),
  DATA_DIR: process.env.DISCORD_DATA_DIR ?? "./data",
  INDEXER_SQL_URL: process.env.INDEXER_SQL_URL ?? "http://localhost:42069/sql",
  INDEXER_API_URL: (process.env.INDEXER_SQL_URL ?? "http://localhost:42069/sql").replace(/\/sql\/?$/, ""),
  MAINNET_RPC_URL: required("PONDER_RPC_URL_1"),
  VERIFY_INTERNAL_SECRET: process.env.VERIFY_INTERNAL_SECRET ?? "",
  CURSOR_FILE: process.env.CURSOR_FILE ?? "./data/cursor.json",
  CONFIG_FILE: process.env.DISCORD_CONFIG_FILE ?? "./data/config.json",
};
