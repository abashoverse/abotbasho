# abotbasho

A self-hosted Discord and Twitter/X bot that posts NFT sales (and optional wrap/unwrap events) for any ERC-721 collection on Ethereum mainnet, in real time.

Sales are decoded directly from `OrderFulfilled` (Seaport) and `Execution721Packed` / `Execution721TakerFeePacked` (Blur Exchange v2). No third-party API key, no rate limits, no webhook scraping.

Background and motivation: [Self-hosted NFT sales bot (2026)](https://blog.abashoverse.com/posts/self-hosted-nft-sales-bot-2026).

> **Chain support:** Defaults to Ethereum mainnet. Other EVM chains are selected via the `INDEXER_CHAIN_ID` env var; built-in profiles live in `packages/shared/src/chain.ts` (`mainnet` and `anvil` ship by default). Add more profiles there to support Base, Polygon, etc. See [packages/indexer/README.md → Adding a chain](./packages/indexer/README.md#adding-a-chain).

## Contents

1. [Architecture](#architecture)
2. [Quick start](#quick-start)
3. [Project config](#project-config)
4. [Environment variables](#environment-variables)
5. [Holder verification (optional)](#holder-verification-optional)
6. [Local development with anvil](#local-development-with-anvil)
7. [Per-package docs](#per-package-docs)

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
| `PONDER_RPC_URL_<chainId>` | indexer + bots | RPC URL for the chain you're indexing. Suffix matches `INDEXER_CHAIN_ID` (e.g. `PONDER_RPC_URL_1` for mainnet). Anything that supports `eth_getLogs` works. |
| `DISCORD_TOKEN` | discord | Bot token from the Discord Developer Portal. |
| `DISCORD_CLIENT_ID` | discord | Application ID. |
| `DISCORD_GUILD_ID` | discord | Server (guild) ID where slash commands register. |
| `DISCORD_CHANNEL_ID` | discord | Default channel for all event types. |
| `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` | twitter | App + user credentials for X. |

### Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `INDEXER_CHAIN_ID` | `1` | Chain id the indexer + bots target. `1` = mainnet, `31337` = local anvil. Add more in `packages/shared/src/chain.ts`. |
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
| **delegate.cash v2** | yes (hot wallet acting for cold) | Layered on SIWE. Server live-checks the registry; only `delegateAll` and `delegateContract` are accepted (token-scoped delegations are rejected). |
| **OpenSea bio** | no | Fallback for users who can't sign. Off by default; requires `OPENSEA_API_KEY`. |

### Per-link revocation policy

A `verification.links` row asserts *"this wallet was proven to hold and still holds"*. When a `Transfer` drops a linked wallet's `balanceOf` to 0, the link row is **deleted** and the user has to redo verification to relink. There is **no auto-regrant**: re-receiving an NFT into a previously-linked wallet does nothing. This closes the wallet-resale attack: even if the wallet's private key is later sold, the new owner can't ride the previous user's verification.

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

4. **Front it with TLS.** `verify-web` listens on `:3000` over HTTP. Put Caddy, Traefik, or nginx in front to terminate TLS; never expose `:3000` to the public internet directly. The path tokens used in verify URLs rely on TLS for confidentiality.

5. **Move the bot's role above the holder role.** The bot can only manage roles below its own highest role. The verify plugin checks this at apply time and skips roles it can't reach.

### Customizing the verify page

`packages/verify-web` ships a single-page SvelteKit app for the SIWE flow. The visual design is driven entirely by CSS custom properties in `packages/verify-web/src/app.css`. To re-skin it for your fork:

1. **Colors.** Edit the `:root` and `:root.dark` blocks at the top of `app.css`. The four most worth overriding are `--bg`, `--fg`, `--border`, and `--accent`. Page components (the card, buttons, error/ok blocks, mono code labels) all read from these tokens, so changes propagate without touching `+page.svelte`.

2. **Fonts.** The default stack is system fonts so the page works without licensed font files. To bundle your own brand fonts, drop the files into `packages/verify-web/static/fonts/`, add `@font-face` rules at the bottom of `app.css`, and update `--font-display` / `--font-body` / `--font-mono`.

3. **Light/dark default.** The page defaults to dark and respects `prefers-color-scheme`. The pre-paint script in `packages/verify-web/src/app.html` reads `localStorage["verify-theme"]` first if you want to ship a theme toggle later.

4. **Copy.** Title, eyebrow, lede, and footer text live in `packages/verify-web/src/routes/v/[token]/+page.svelte`. The user-facing error labels are mapped from indexer error codes via `errorLabel(...)` in the same file.

After editing, rebuild verify-web (`docker compose ... up -d --build verify-web`) for the changes to land.

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

## Local development with anvil

For iterating on the indexer, verify flow, or marketplace decoders without burning mainnet gas, the repo ships a `compose.dev.yml` overlay that swaps in a local [anvil](https://book.getfoundry.sh/anvil/) node forking your mainnet RPC. The fork preserves real collection state and the delegate.cash registry, so production code paths exercise unchanged.

### Setup

1. Bring the stack up (verify profile included if you want to test that flow):

   ```sh
   docker compose -f docker-compose.yml -f compose.dev.yml --profile verify up -d --build
   ```

   This boots `anvil` (forking from `PONDER_RPC_URL_1`), then the indexer and verify-web with `INDEXER_CHAIN_ID=31337`.

2. Seed the dev wallet with an NFT from your configured `cfg.primary` collection:

   ```sh
   bun run dev:seed              # transfers tokenId 1 from cfg.primary
   bun run dev:seed 4242         # transfers a specific tokenId
   ```

   The script reads `ownerOf(tokenId)` on the fork, impersonates that owner via `anvil_impersonateAccount`, funds them, and transfers the token to anvil's account 0 (`0xf39F…2266`). Re-run after restarting anvil; state lives in memory.

   To seed a wrapped token instead (handy for testing the delegate.cash flow when a cold wallet holds the wrapped version), use the wrapper variant:

   ```sh
   bun run dev:seed-wrapper          # tokenId 1 from cfg.wrapper
   bun run dev:seed-wrapper 4242     # specific tokenId
   ```

3. Import the dev wallet into MetaMask. Anvil's account 0 has a public, well-known private key:

   ```
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```

   Then add a custom network: name `Anvil`, RPC `http://127.0.0.1:8545`, chain id `31337`, symbol `ETH`.

### Test loop

- Run `/verify` in your Discord guild → page opens at `http://localhost:3000/v/<token>` (or wherever your `verify.publicUrl` points). Sign with the imported anvil account. Role applies within `pollIntervalMs`.
- To exercise revocation: `bun run dev:unseed` (transfers primary tokenId 1 to `0x…dEaD`; pass `<tokenId> [recipient]` to override). The indexer's Transfer hook fires, `balanceOf` drops to 0, the link row is deleted, and the role is revoked on next poll. No gas, no waiting. Re-run `bun run dev:seed` to put the NFT back. For wrapper-side revocation, use `bun run dev:unseed-wrapper`.

### Caveats

- The fork is in-memory; restarting `anvil` resets to fresh fork state. Re-run `bun run dev:seed`.
- `tokenId 1` may not exist in every collection. Pass an existing tokenId as the second arg.
- `verify.publicUrl` and `VERIFY_PUBLIC_DOMAIN` still need to match where the browser opens the page (typically `http://localhost:3000`).
- After modifying indexer code (ponder.config.ts, schema, handlers) Ponder will refuse to reuse the existing schema with a `Schema 'abotbasho' was previously used by a different Ponder app` error. The simplest fix is a clean reset:

  ```sh
  docker compose -f docker-compose.yml -f compose.dev.yml --profile verify down -v
  docker compose -f docker-compose.yml -f compose.dev.yml --profile verify up -d --build
  bun run dev:seed
  ```

  If you want to preserve `verification.links` rows, drop only the Ponder schema instead: `docker compose exec indexer-db psql -U ponder abotbasho -c "DROP SCHEMA abotbasho CASCADE;"`.

## Per-package docs

- [packages/discord/README.md](./packages/discord/README.md) for Discord app setup, slash commands, plugin authoring, and runtime `/config`.
- [packages/twitter/README.md](./packages/twitter/README.md) for X developer app setup, free tier limits, and the debug command.
- [packages/indexer/README.md](./packages/indexer/README.md) for Ponder + Postgres details, marketplace decoder extension, wrapper contract assumptions, and adding a chain.

## License

MIT. See [LICENSE](./LICENSE).
