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
5. [Holder verification (optional)](#holder-verification-optional)
6. [Per-package docs](#per-package-docs)

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

## Holder verification (optional)

Off by default. When enabled, the bot grants a Discord role to users who can prove on-chain ownership of at least one NFT in `cfg.primary` (or its wrapper). The Discord role is reconciled in real time from on-chain `Transfer` events.

### Methods

| Method | Signature required? | Notes |
| --- | --- | --- |
| **SIWE** (EIP-4361) | yes (hot wallet that holds) | Default path. |
| **delegate.cash v2** | yes (hot wallet acting for cold) | Layered on SIWE. Server live-checks the registry; only `delegateAll` and `delegateContract` are accepted — token-scoped delegations are rejected. |
| **OpenSea bio** | no | Fallback for users who can't sign. Off by default; requires `OPENSEA_API_KEY`. |

### Per-link revocation policy

A `verification.links` row asserts *"this wallet was proven to hold and still holds"*. When a `Transfer` drops a linked wallet's `balanceOf` to 0, the link row is **deleted** and the user has to redo verification to relink. There is **no auto-regrant** — re-receiving an NFT into a previously-linked wallet does nothing. This closes the wallet-resale attack: even if the wallet's private key is later sold, the new owner can't ride the previous user's verification.

### Known limitation: wallet private-key sale

If the private key of a linked wallet is sold or compromised *without an on-chain Transfer*, the holder role persists until that wallet next moves the NFT. Detecting this requires periodic forced re-SIWE, which is out of scope for v1. Admins can `/verify-admin force-revoke <user>` to remove access manually.

### Enabling the feature

1. **Config.** Add a `verify` block to `abotbasho.config.ts`:

   ```ts
   verify: {
     enabled: true,
     roleId: "<Discord role ID granted to verified holders>",
     publicUrl: "https://verify.example.xyz",
     // pollIntervalMs: 5000,
     // delegateCash: true,
     // openseaBio: false,
     // openseaSlug: "my-collection",
   }
   ```

2. **Env.** Generate a 32-byte secret shared between bot and indexer and set the WalletConnect project id:

   ```sh
   echo "VERIFY_INTERNAL_SECRET=$(openssl rand -hex 32)" >> .env
   echo "WALLETCONNECT_PROJECT_ID=<your-id>" >> .env  # https://cloud.reown.com
   ```

3. **Bring up the verify-web service** behind the `verify` Compose profile:

   ```sh
   docker compose --profile verify up -d --build
   ```

4. **Front it with TLS.** `verify-web` listens on `:3000` over HTTP. Put Caddy, Traefik, or nginx in front to terminate TLS — never expose `:3000` to the public internet directly. The path tokens used in verify URLs rely on TLS for confidentiality.

5. **Move the bot's role above the holder role.** The bot can only manage roles below its own highest role. The verify plugin checks this at apply time and skips roles it can't reach.

### Optional: least-privilege Postgres role

To restrict the verification pool's grants, create a dedicated role and set `VERIFICATION_DB_URL` to its connection string:

```sql
CREATE ROLE verify_app LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA verification TO verify_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA verification TO verify_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA verification TO verify_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA verification GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO verify_app;
```

Migrations still need a role that can `CREATE` in the DB; run them once with the superuser, then switch the indexer to `VERIFICATION_DB_URL=postgresql://verify_app:...`.

## Per-package docs

- [packages/discord/README.md](./packages/discord/README.md) for Discord app setup, slash commands, plugin authoring, and runtime `/config`.
- [packages/twitter/README.md](./packages/twitter/README.md) for X developer app setup, free tier limits, and the debug command.
- [packages/indexer/README.md](./packages/indexer/README.md) for Ponder + Postgres details, marketplace decoder extension, wrapper contract assumptions, and adding a chain.

## License

MIT. See [LICENSE](./LICENSE).
