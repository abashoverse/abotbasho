import { Client, GatewayIntentBits, type TextChannel } from "discord.js";
import { type AnyEvent } from "@abotbasho/shared";
import { env } from "./env.js";
import { initConfig } from "./config.js";
import { messageFor } from "./messages.js";
import "./plugins/registry.js"; // side-effect: registers all event handlers
import { allEventHandlers, handlerForEvent } from "./plugins/extensions.js";

await initConfig(env.CONFIG_FILE);

const which = (process.argv[2] ?? "all").toLowerCase();
const handlers = allEventHandlers().filter((h) => h.debugChoice);

const events: AnyEvent[] =
  which === "all"
    ? handlers.map((h) => h.debugChoice!.sample())
    : (() => {
        const match = handlers.find((h) => h.debugChoice!.value === which);
        return match ? [match.debugChoice!.sample()] : [];
      })();

if (events.length === 0) {
  console.error(
    `[debug] no handler matched "${which}". Available: ${handlers.map((h) => h.debugChoice!.value).join(", ") || "(none)"}`,
  );
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(env.DISCORD_TOKEN);

const channel = await client.channels.fetch(env.DISCORD_CHANNEL_ID);
if (!channel || !channel.isTextBased()) {
  throw new Error(`Channel ${env.DISCORD_CHANNEL_ID} not text-based`);
}
const textChannel = channel as TextChannel;

for (const ev of events) {
  const handler = handlerForEvent(ev);
  if (!handler) continue;
  const embed = await handler.buildEmbed(
    ev,
    env.MAINNET_RPC_URL,
    messageFor(handler.messageKind),
  );
  const data = embed.toJSON();
  const label =
    ev.type === "sale" ? "sale" : (ev as { kind?: string }).kind ?? ev.type;
  console.log(
    `[debug] ${label}: image=${data.image?.url ?? "(none)"} title=${data.title}`,
  );
  await textChannel.send({ embeds: [embed] });
}

await client.destroy();
process.exit(0);
