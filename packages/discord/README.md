# @abotbasho/discord

discord.js v14 bot that polls the indexer and posts a rich embed per event. Plugin-based: drop a folder under `src/plugins/` and you're done.

This package assumes you've already read the [root README](../../README.md) and have `abotbasho.config.ts` configured.

## Contents

1. [Discord app setup](#discord-app-setup)
2. [Environment variables](#environment-variables)
3. [Slash commands](#slash-commands)
4. [Channel and message routing](#channel-and-message-routing)
5. [Plugins](#plugins)
   - [How plugins work](#how-plugins-work)
   - [Reading plugin config](#reading-plugin-config)
   - [Shipped plugins](#shipped-plugins)
   - [Adding event handlers, slots, and message kinds](#adding-event-handlers-slots-and-message-kinds)
6. [Troubleshooting](#troubleshooting)

## Discord app setup

1. Go to <https://discord.com/developers/applications> and click **New Application**.
2. Under **Bot**, generate a token. Set it as `DISCORD_TOKEN` in `.env`.
3. Copy the **Application ID** at the top of the General Information page. Set it as `DISCORD_CLIENT_ID`.
4. In your Discord server, enable **Developer Mode** (User Settings → Advanced), then right-click the server icon → "Copy Server ID". Set it as `DISCORD_GUILD_ID`.
5. Right-click the channel you want events posted in → "Copy Channel ID". Set it as `DISCORD_CHANNEL_ID`.
6. Build the OAuth invite URL under **OAuth2 → URL Generator**.
   - **Scopes:** `bot` *and* `applications.commands`.
   - **Bot permissions:** View Channel, Send Messages, Embed Links.

   Open the resulting URL and add the bot to your server.

If you forget `applications.commands`, slash commands won't appear in the server.

## Environment variables

The core bot only needs the four required vars below. Plugins can opt to read additional per-slot channel overrides; those are listed under each plugin.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token. |
| `DISCORD_CLIENT_ID` | yes | Application ID. |
| `DISCORD_GUILD_ID` | yes | Server ID where commands are registered. |
| `DISCORD_CHANNEL_ID` | yes | Default channel for all event types. |
| `DISCORD_DATA_DIR` | no | Persistent state dir. Default `./data`. Docker compose mounts `/data`. |
| `DISCORD_CONFIG_FILE` | no | Runtime config JSON path. Default `<DATA_DIR>/config.json`. |
| `CURSOR_FILE` | no | Indexer cursor JSON path. Default `<DATA_DIR>/cursor.json`. |

Plugin-owned env vars: `DISCORD_SALES_CHANNEL_ID` (events), `DISCORD_WRAPS_CHANNEL_ID` and `DISCORD_UNWRAPS_CHANNEL_ID` (wrapper, only when `abotbasho.config.ts` has a `wrapper`), `DISCORD_BLOG_CHANNEL_ID` (rss).

## Slash commands

| Command | Who | Plugin | Effect |
| --- | --- | --- | --- |
| `/recent [type] [count]` | everyone | events | Show recent events as embeds. `type` choices come from registered handlers (`all`, `sales`, plus `wraps`/`unwraps` when the wrapper plugin is active). `count` is 1-10. |
| `/view <id>` | everyone | tokens | Image, owner, opensea link. `id` bounds come from `primary.totalSupply` if set. When `wrapper` is configured and the token is currently wrapped, also shows wrap status and holding duration. |
| `/wrapped <id>` | everyone | wrapper | Wrap status, holding duration, owner. Only registered when `abotbasho.config.ts` has a `wrapper`. |
| `/config view` | admin (Manage Server) | config | Show the current effective configuration. Lists message kinds and channel slots contributed by every active plugin. |
| `/config message <type> [text]` | admin | config | Set or clear a custom message. `type` choices come from registered message kinds (`sale`, plus `wrap`/`unwrap` when the wrapper plugin is active). Persists to `data/config.json`. |
| `/config channel <slot> [channel]` | admin | config | Route a slot to a specific channel. Slot choices come from registered slots (`default`, `sales`, `blog`, plus `wraps`/`unwraps` when the wrapper plugin is active). |
| `/config preview <type>` | admin | config | Render a sample embed using current config (no posting). |
| `/debug <type>` | admin | events | Post sample event(s) through the routing pipeline (verifies channel access). `type` choices come from registered handlers' samples. |
| `/blog <url>` | admin | rss | Unfurls a URL via og:tags (or matches against the RSS feed if same host) and posts to the blog channel. |

## Channel and message routing

Each event type can be sent to its own channel via per-type env vars. Anything left unset falls through to `DISCORD_CHANNEL_ID`.

**Channel resolution order** (any slot):

```
runtime override (/config channel)  →  env var (DISCORD_*_CHANNEL_ID)  →  DISCORD_CHANNEL_ID
```

**Custom message resolution order:**

```
runtime override (/config message)  →  abotbasho.config.ts messages.*  →  unset
```

Runtime overrides live in `data/config.json` (volume-mounted in Docker). The router lives in `src/channels.ts` if you need to extend it (e.g., per-collection channels).

## Plugins

### How plugins work

Each plugin lives in `src/plugins/<name>/` and exports a `DiscordPlugin`:

```ts
interface DiscordPlugin {
  name: string;
  description?: string;
  enabled?: boolean;
  init?(ctx: PluginContext): Promise<void>;
  shutdown?(ctx: PluginContext): Promise<void>;
  commands?: SlashCommand[];     // contributed slash commands
  intervals?: PluginInterval[];  // recurring jobs (cron-ish)
}
```

The loader (`plugins/loader.ts`) creates a per-plugin data dir at `<DATA_DIR>/plugins/<name>/`, runs `init`, schedules `intervals`, and aggregates `commands` for Discord registration.

**To add a plugin:**

1. Create a folder under `plugins/`.
2. Export a `DiscordPlugin` object.
3. Register it in `plugins/registry.ts`.

### Reading plugin config

Plugins read their config from `abotbasho.config.ts` under the `plugins` block, keyed by plugin name. Use the `pluginConfig<T>(name)` helper from `@abotbasho/shared` and validate the slice yourself in your plugin's module:

```ts
// in abotbasho.config.ts
plugins: {
  myPlugin: { url: "...", limit: 10 },
},

// in src/plugins/my-plugin/index.ts
import { pluginConfig } from "@abotbasho/shared";

interface MyPluginConfig { url: string; limit?: number }

const validate = (raw: unknown): MyPluginConfig | null => {
  if (raw === undefined) return null;
  // ...your validation
  return raw as MyPluginConfig;
};

const cfg = validate(pluginConfig<unknown>("myPlugin"));
```

Each plugin owns its schema. The Twitter bot doesn't load `plugins.*` at all, so plugin keys naturally stay Discord-only.

### Shipped plugins

#### `events`

Polls the indexer and posts each new event as an embed. Owns `/recent` and `/debug`. Ships with a built-in `sale` handler that registers the `sales` channel slot (env override `DISCORD_SALES_CHANNEL_ID`) and the `sale` message kind.

No plugin-specific config; reads `pollIntervalMs` from the top-level `abotbasho.config.ts`.

#### `wrapper`

Posts wrap/unwrap embeds and provides `/wrapped <id>`. Only active when `abotbasho.config.ts` has a `wrapper`; otherwise the plugin is disabled and registers nothing (no commands, no slots, no message kinds, no handlers).

When active, registers:

- channel slots `wraps` (env: `DISCORD_WRAPS_CHANNEL_ID`) and `unwraps` (env: `DISCORD_UNWRAPS_CHANNEL_ID`)
- message kinds `wrap` and `unwrap`
- event handlers for both wrap kinds, dispatched from the events plugin's poller

`/wrapped <id>` shows the current wrap status of a token (wrapped / not wrapped), holding duration if wrapped, and the owner. Reads from the indexer's `/api/holding` endpoint, falls back to an on-chain `ownerOf` call if the token isn't currently wrapped.

The indexer-side wrapper handling stays config-driven (Ponder requires static contract registration), so the wrapper itself is set on the top-level `abotbasho.config.ts.wrapper` field, not under `plugins.wrapper`.

#### `tokens`

Token info commands. Provides `/view <id>` (image, owner, opensea link). Reads `primary.totalSupply` from `abotbasho.config.ts` to set the `id` option's upper bound. When `wrapper` is configured, `/view` also queries the indexer's `/api/holding` endpoint and adds wrap status + holding duration for currently-wrapped tokens.

No plugin-specific config; no channel slots, no message kinds, no event handlers. Drop this plugin from `registry.ts` if you don't want a token viewer.

#### `config`

Provides `/config view | message | channel | preview`. Persists runtime overrides to `data/config.json`. Choices for message kinds and channel slots come from whatever the other plugins have registered.

No plugin-specific config.

#### `rss`

Polls an RSS/Atom feed and posts new entries to the channel routed for the `blog` slot. Also provides `/blog <url>` for manual posts (works whether or not auto-polling is configured).

```ts
// abotbasho.config.ts
plugins: {
  rss: {
    url: "https://blog.example.com/rss.xml",
    pollIntervalMs: 5 * 60 * 1000, // optional, default 5 minutes
  },
},
```

Omit `plugins.rss` to disable auto-posting (the `/blog` command stays available). State (seen entry IDs, capped at 500) lives in `<DATA_DIR>/plugins/rss/seen.json`. Format support: RSS 2.0 and Atom. Image extraction: `<enclosure>`, `<media:content>`, `<media:thumbnail>`.

On first run with no state, the plugin marks all current entries as seen *without posting* (no spam on cold start). Subsequent polls post any new entry.

### Adding event handlers, slots, and message kinds

Plugins that want to contribute to `/recent`, `/debug`, and the routing pipeline register specs in `plugins/extensions.ts`:

```ts
// in your plugin's index.ts
import {
  registerChannelSlot,
  registerEventHandler,
  registerMessageKind,
} from "../extensions.js";

registerChannelSlot({ id: "listings", envVar: "DISCORD_LISTINGS_CHANNEL_ID" });
registerMessageKind({ id: "listing", sample: sampleListing });
registerEventHandler({
  match: (e) => e.type === "listing",
  channelSlot: "listings",
  messageKind: "listing",
  buildEmbed: async (event, rpcUrl, customMessage) => { /* ... */ },
  recentChoice: { name: "listings", value: "listings" },
  debugChoice: { name: "listing", value: "listing", sample: sampleListing },
});
```

Slash command choices are built lazily, so registration order across plugins doesn't matter.

## Troubleshooting

- **Slash commands don't appear in the server.** OAuth invite was missing the `applications.commands` scope. Re-invite with the correct URL.
- **Bot starts but never posts.** Check `pollIntervalMs` in `abotbasho.config.ts` (0 disables polling). Check `INDEXER_SQL_URL` is reachable. Try `/debug all` to verify channel access without waiting for a real sale.
- **Wrap events double-post as sales.** Make sure your wrapper address is set correctly in `abotbasho.config.ts`. The indexer filters out transfers where the wrapper is one of the parties, but only if it knows the wrapper address.
- **`/view` shows "doesn't exist".** Token ID is out of range or the contract reverted. Check `primary.totalSupply` in `abotbasho.config.ts`.
- **`/wrapped` doesn't show up.** The wrapper plugin only activates when `abotbasho.config.ts` has a `wrapper`. Add the wrapper block and restart the bot.
