# abotbasho

A self-hosted Discord and Twitter/X bot that posts NFT sales (and optional wrap/unwrap events) for any ERC-721 collection on Ethereum mainnet, in real time.

Sales are decoded directly from `OrderFulfilled` (Seaport) and `Execution721Packed` / `Execution721TakerFeePacked` (Blur Exchange v2). No third-party API key, no rate limits, no webhook scraping.

Background and motivation: [Self-hosted NFT sales bot (2026)](https://blog.abashoverse.com/posts/self-hosted-nft-sales-bot-2026).

> **Chain support:** Ethereum mainnet only out of the box. Adapting to another EVM chain (Base, Polygon, Arbitrum, etc.) takes a handful of coordinated edits in the indexer config, shared chain helpers, and explorer URL builders. See [packages/indexer/README.md → Adding a chain](./packages/indexer/README.md#adding-a-chain).

## Contents

1. [Architecture](#architecture)
2. [Quick start](#quick-start)
3. [Project config](#project-config)
4. [Environment variables](#environment-variables)
5. [Per-package docs](#per-package-docs)

## Architecture

```
┌──────────┐  HTTP  ┌──────────┐  HTTP  ┌──────────┐
│   RPC    │ ─────▶ │ indexer  │ ─────▶ │ discord  │
│ mainnet  │        │ Ponder   │        │   bot    │
└──────────┘        │ Postgres │        └──────────┘
                    │ + Hono   │  HTTP  ┌──────────┐
                    │ :42069   │ ─────▶ │ twitter  │
                    └──────────┘        │   bot    │
                                        └──────────┘
```

| Package | Role |
| --- | --- |
| `packages/indexer` | Ponder app: indexes contract events, decodes marketplace sales, exposes a polling API. |
| `packages/discord` | discord.js bot with a plugin host (events poster, token info, runtime `/config`, optional wrapper, RSS). |
| `packages/twitter` | twitter-api-v2 bot for X (free tier, OAuth 1.0a). |
| `packages/shared` | ABIs, marketplace decoders, ENS resolver, project config loader, poller, wire types. |

The indexer is the source of truth. Each bot is independent, so you can run only Discord, only Twitter, or both.

## Quick start

### Prerequisites

- [Bun](https://bun.sh/) 1.1+
- An Ethereum mainnet RPC URL (Alchemy, dRPC, Infura, or your own node)
- A Discord bot token + server. Walkthrough in the [Discord README](./packages/discord/README.md).
- Optional: Twitter/X dev app credentials. Walkthrough in the [Twitter README](./packages/twitter/README.md).
- Docker + Docker Compose for production deploys (skippable for local dev).

### 1. Clone and install

```sh
git clone https://github.com/your-fork/abotbasho && cd abotbasho
bun install
```

### 2. Create your `abotbasho.config.ts`

The repo ships `abotbasho.config.example.ts` as a generic template. Copy it and edit in your collection's values:

```sh
cp abotbasho.config.example.ts abotbasho.config.ts
```

This is the **only file you should need to edit** to point the bot at a different collection. `abotbasho.config.ts` is gitignored so your per-deployment values don't accidentally get pushed.

Full schema in [Project config](#project-config) below.

### 3. Set up `.env`

```sh
cp .env.example .env
```

Fill in `PONDER_RPC_URL_1`, `DISCORD_*`, `TWITTER_*`, and `DISCORD_CHANNEL_ID`. The per-package READMEs cover where each value comes from.

### 4. Run locally (each service in its own terminal)

```sh
bun run dev:indexer   # Ponder dev mode, hot-reloads handlers
bun run dev:discord   # discord.js with --watch
bun run dev:twitter   # twitter-api-v2 with --watch
```

You only need the parts you actually use. `dev:indexer + dev:discord` is enough if you don't post to X.

### 5. Deploy with Docker Compose

```sh
docker compose up -d --build
docker compose logs -f
```

Discord-only (no Twitter):

```sh
docker compose up -d --build indexer-db indexer discord
```

The indexer's port `42069` is bound to `127.0.0.1` only; the bots reach it over the Docker network.

## Project config

`abotbasho.config.ts` is loaded at startup by the indexer, the Discord bot, and the Twitter bot.

```ts
interface AbotbashoConfig {
  project: {
    name: string;        // shown in embed footers, RSS user-agent, etc.
    url?: string;
  };
  primary: {
    label: string;       // unique key used by the indexer
    displayName?: string;
    address: Address;
    deployBlock: bigint;
    totalSupply?: number; // sets /view bounds in Discord
  };
  wrapper?: {            // optional
    label: string;
    displayName?: string;
    pluralName?: string; // shown in tweets for wrap events
    address: Address;
    deployBlock: bigint;
  };
  messages?: {           // default copy appended per event type
    sale?: string;       // Discord renders as embed footer; Twitter as body line
    wrap?: string;
    unwrap?: string;
  };
  pollIntervalMs?: number; // ms between indexer polls. Default 10000. 0 disables.
  ipfsGateway?: string;    // default https://ipfs.io/ipfs/
  tweetPrefix?: string;    // prepended to every tweet's title line (e.g. an emoji). Discord unaffected.
  plugins?: Record<string, unknown>; // per-plugin slices, see packages/discord/README.md
}
```

Resolution order:

1. `ABOTBASHO_CONFIG_PATH` (env var, absolute path) if set.
2. `abotbasho.config.ts`, walking up from the current working directory.

## Environment variables

`.env` holds **secrets and per-deployment IDs only**. Everything else (poll cadence, IPFS gateway, plugin configs, custom messages, contract addresses) lives in `abotbasho.config.ts`.

### Required

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PONDER_RPC_URL_1` | indexer + bots | Ethereum mainnet RPC URL (Alchemy, dRPC, Infura, your own node). Bots use it for ENS + token metadata. |
| `DISCORD_TOKEN` | discord | Bot token from the Discord Developer Portal. |
| `DISCORD_CLIENT_ID` | discord | Application ID. |
| `DISCORD_GUILD_ID` | discord | Server (guild) ID where slash commands register. |
| `DISCORD_CHANNEL_ID` | discord | Default channel for all event types. |
| `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` | twitter | App + user credentials for X. |

### Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `PONDER_PORT` | `42069` | Internal indexer port. |
| `INDEXER_SQL_URL` | `http://localhost:42069/sql` | Where bots reach the indexer. Compose sets it to `http://indexer:42069/sql`. |
| `ABOTBASHO_CONFIG_PATH` | (unset) | Absolute path override for `abotbasho.config.ts`. Useful for running multiple bots from one repo. |
| `DISCORD_SALES_CHANNEL_ID`, `DISCORD_WRAPS_CHANNEL_ID`, `DISCORD_UNWRAPS_CHANNEL_ID`, `DISCORD_BLOG_CHANNEL_ID` | `DISCORD_CHANNEL_ID` | Per-event-type channel overrides. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `ponder`, `ponder`, `abotbasho` | Docker compose only. Override to run multiple bots on one host without volume conflicts. |

## Per-package docs

- [packages/discord/README.md](./packages/discord/README.md) for Discord app setup, slash commands, plugin authoring, and runtime `/config`.
- [packages/twitter/README.md](./packages/twitter/README.md) for X developer app setup, free tier limits, and the debug command.
- [packages/indexer/README.md](./packages/indexer/README.md) for Ponder + Postgres details, marketplace decoder extension, wrapper contract assumptions, and adding a chain.

## License

MIT. See [LICENSE](./LICENSE).
