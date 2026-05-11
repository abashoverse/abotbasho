# abotbasho

A self-hosted Discord and Twitter/X bot that posts NFT sales (and optional wrap/unwrap events) for any ERC-721 collection on Ethereum mainnet, in real time. Optional NFT-holder verification grants Discord roles to wallet owners via SIWE, delegate.cash, or an OpenSea bio code.

Sales are decoded directly from `OrderFulfilled` (Seaport) and `Execution721Packed` / `Execution721TakerFeePacked` (Blur Exchange v2). No third-party API key, no rate limits, no webhook scraping.

Background and motivation: [Self-hosted NFT sales bot (2026)](https://blog.abashoverse.com/posts/self-hosted-nft-sales-bot-2026).

> **Chain support:** Defaults to Ethereum mainnet. Other EVM chains are selected via the `INDEXER_CHAIN_ID` env var; built-in profiles live in `packages/shared/src/chain.ts` (`mainnet` and `anvil` ship by default). Add more profiles there to support Base, Polygon, etc. See [packages/indexer/README.md → Adding a chain](./packages/indexer/README.md#adding-a-chain).

## Contents

1. [Architecture](#architecture)
2. [Quick start](#quick-start)
3. [Project config](#project-config)
4. [Environment variables](#environment-variables)
5. [Holder verification](#holder-verification)
6. [Production deploy](#production-deploy)
7. [Admin commands](#admin-commands)
8. [Local development with anvil](#local-development-with-anvil)
9. [Customizing](#customizing)
10. [Per-package docs](#per-package-docs)

## Architecture

```
┌──────────┐  HTTP  ┌──────────┐  HTTP  ┌──────────┐
│   RPC    │ ─────▶ │ indexer  │ ─────▶ │ discord  │
│ chain    │        │ Ponder   │        │   bot    │
└──────────┘        │ Postgres │        └──────────┘
                    │ + Hono   │  HTTP  ┌──────────┐
                    │ :42069   │ ─────▶ │ twitter  │
                    └──────────┘        │   bot    │
                          ▲             └──────────┘
                  SIWE /  │
                   bio    │
                          │
                    ┌──────────┐
                    │verify-web│  optional, profile=verify
                    │ SvelteKit│
                    │  :3000   │
                    └──────────┘
```

| Package | Role |
| --- | --- |
| `packages/indexer` | Ponder app: indexes contract events, decodes marketplace sales, exposes a polling API + verify routes. |
| `packages/discord` | discord.js bot with a plugin host (events poster, token info, runtime `/config`, optional wrapper, RSS, holder verification). |
| `packages/twitter` | twitter-api-v2 bot for X (free tier, OAuth 1.0a). |
| `packages/verify-web` | SvelteKit single-page app for the holder verification flow (SIWE + delegate.cash + OpenSea bio). Optional; only built when running with `--profile verify`. |
| `packages/shared` | ABIs, marketplace decoders, ENS resolver, project config loader, chain registry, poller, wire types. |

The indexer is the source of truth. Each consumer (Discord bot, Twitter bot, verify-web) is independent, so you can run only the parts you need.

## Quick start

This section gets the bot indexing and posting locally. For a public deployment, see [Production deploy](#production-deploy).

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

```sh
cp abotbasho.config.example.ts abotbasho.config.ts
```

Edit `primary.address`, `primary.deployBlock`, and `project.name`. This is the **only file you should need to edit** to point the bot at a different collection. `abotbasho.config.ts` is gitignored.

Schema details in [Project config](#project-config).

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

## Project config

`abotbasho.config.ts` is loaded at startup by the indexer, the Discord bot, the Twitter bot, and verify-web.

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
  wrapper?: {            // optional; if set, holdings + verification span both contracts
    label: string;
    displayName?: string;
    pluralName?: string; // shown in tweets for wrap events
    address: Address;
    deployBlock: bigint;
  };
  messages?: {           // default copy appended per event type
    sale?: string;
    wrap?: string;
    unwrap?: string;
  };
  pollIntervalMs?: number; // ms between indexer polls. Default 10000. 0 disables.
  ipfsGateway?: string;    // default https://ipfs.io/ipfs/
  tweetPrefix?: string;    // prepended to every tweet's title line. Discord unaffected.
  explorerUrl?: string;    // base URL for tx/address links. Default https://etherscan.io.
  verify?: VerifyConfig;   // see Holder verification below
  plugins?: Record<string, unknown>; // per-plugin slices, see packages/discord/README.md
}

interface VerifyConfig {
  enabled: boolean;
  roleId: string;            // Discord role granted to verified holders
  publicUrl: string;         // public URL of verify-web
  pollIntervalMs?: number;   // role-event drain cadence. Default 5000.
  delegateCash?: boolean;    // accept delegate.cash hot/cold delegation. Default true.
  openseaBio?: boolean;      // bio-code fallback. Default false; needs OPENSEA_API_KEY.
  openseaSlug?: string;      // collection slug; required when openseaBio=true.
  sourceCodeUrl?: string;    // optional Source code button on the embed posted via /verify-admin post.
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

### Required if `verify.enabled: true`

| Variable | Purpose |
| --- | --- |
| `VERIFY_INTERNAL_SECRET` | 32-byte hex shared between bot and indexer. Generate with `openssl rand -hex 32`. |
| `WALLETCONNECT_PROJECT_ID` | For verify-web's wallet connector. Free at https://cloud.reown.com. |
| `OPENSEA_API_KEY` | Only when `verify.openseaBio: true`. Free dev tier at https://docs.opensea.io/reference/api-keys. |

### Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `INDEXER_CHAIN_ID` | `1` | Chain id the indexer + bots target. `1` = mainnet, `31337` = local anvil. Add more in `packages/shared/src/chain.ts`. |
| `PUBLIC_INDEXER_CHAIN_ID` | `1` | Chain id exposed to verify-web's browser bundle. Must match `INDEXER_CHAIN_ID`. |
| `VERIFY_PUBLIC_DOMAIN` | derived from `verify.publicUrl` | SIWE message domain. Set if your reverse proxy rewrites the host header. |
| `VERIFY_WEB_HOST_PORT` | `3000` | Host port mapped to verify-web's container. Change if 3000 is taken (umami, grafana, etc.). Always loopback-bound. |
| `VERIFICATION_DB_URL` | (uses `DATABASE_URL`) | Optional least-privilege Postgres role with grants only on `verification.*`. See [Production deploy](#production-deploy). |
| `PONDER_PORT` | `42069` | Internal indexer port. |
| `INDEXER_SQL_URL` | `http://localhost:42069/sql` | Where bots reach the indexer. Compose sets it to `http://indexer:42069/sql`. |
| `ABOTBASHO_CONFIG_PATH` | (unset) | Absolute path override for `abotbasho.config.ts`. |
| `DISCORD_SALES_CHANNEL_ID`, `DISCORD_WRAPS_CHANNEL_ID`, `DISCORD_UNWRAPS_CHANNEL_ID`, `DISCORD_BLOG_CHANNEL_ID` | `DISCORD_CHANNEL_ID` | Per-event-type channel overrides. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `ponder`, `ponder`, `abotbasho` | Docker compose only. Override to run multiple bots on one host without volume conflicts. |

## Holder verification

Optional feature, off by default. When enabled, configured bots reconcile holder access for users who can prove on-chain ownership of at least one NFT in `cfg.primary` (or its wrapper if configured). On Discord that's a role grant or removal; on Telegram it's a single-use chat invite or a kick from the gated supergroup. Access is reconciled in real time from on-chain `Transfer` events.

Either Discord, Telegram, or both can be configured. The schema is platform-agnostic (`platform`, `platform_user_id`, `platform_scope_id`), and each bot only drains `role_events` for its own platform.

### Methods

| Method | Signature required? | Notes |
| --- | --- | --- |
| **SIWE** (EIP-4361) | yes (hot wallet that holds) | Default path. The wallet signs a message bound to the user's platform id (Discord or Telegram) and a server nonce. |
| **delegate.cash v2** | yes (hot wallet acting for cold) | Layered on SIWE or bio. Server live-checks the registry; only `delegateAll` and `delegateContract` are accepted (token-scoped delegations are rejected). Works for primary OR wrapper delegation when both are configured. |
| **OpenSea bio** | no | Off by default; requires `OPENSEA_API_KEY`. The bot generates a one-time code; the user pastes it in their OpenSea profile bio; the indexer fetches the bio and matches. |

All three methods enter through the same web page (`packages/verify-web`); the user picks SIWE or OpenSea-bio via tabs.

### Discord flow

A persistent embedded message is the canonical entrypoint. After admins post it once with `/verify-admin post`, members click a **Verify** button and get an ephemeral message with their personal verification link. The page handles SIWE, delegate.cash, and OpenSea bio in tabs.

A fallback `/verify` slash command exists for users who prefer a command path; it produces the same ephemeral link without the embed.

### Telegram flow

Users DM the bot and run `/verify` (group chats are silently ignored to avoid leaking single-use tokens). The bot replies with the same verification URL as the Discord flow. After a successful sign, the indexer queues a `grant` event; the bot drains it, creates a single-use chat invite link via the Telegram Bot API (`member_limit: 1`, short expiry), and DMs the link to the user.

When a Transfer drops a verified holder to zero balance, the indexer queues a `revoke` event. The bot calls `banChatMember` (kick) immediately followed by `unbanChatMember(only_if_banned=true)` so the user is removed but can rejoin after re-verifying. Set `verify.telegram.kickSemantics: false` to leave the ban sticky and require a manual unban.

### Per-link revocation policy

A `verification.links` row asserts *"this wallet was proven to hold and still holds"*. When a `Transfer` drops a linked wallet's `balanceOf` to 0, the link row is **deleted** and the user has to redo verification to relink. There is **no auto-regrant**: re-receiving an NFT into a previously-linked wallet does nothing. This closes the wallet-resale attack: even if the wallet's private key is later sold, the new owner can't ride the previous user's verification.

If the user has multiple linked wallets and only one drops to zero, only that link row is deleted; the role stays as long as at least one link is still proven.

### Known limitation: wallet private-key sale

If the private key of a linked wallet is sold or compromised *without an on-chain Transfer*, the holder role persists until that wallet next moves the NFT. Detecting this requires periodic forced re-SIWE, which is out of scope for v1. Admins can `/verify-admin force-revoke <user>` to remove access manually.

## Production deploy

End-to-end runbook for deploying with verification enabled. If you don't want verification, skip steps 3, 4, 6, 7 and just run `docker compose up -d --build`.

### 1. Discord setup (skip if you're only using Telegram)

- Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications) and invite it to your guild with at least `applications.commands` + `bot` scope and `Manage Roles` + `Send Messages` + `Embed Links` permissions.
- Create the holder role in your guild. **Move the bot's role above it** in the role list. Discord only lets a bot manage roles below its own highest role.
- (Optional, only needed for `/verify-admin sweep`) In the Dev Portal: Bot → toggle **SERVER MEMBERS INTENT** on. The bot config already requests it; without the toggle, the sweep command will fail with a clear error.

### 1b. Telegram setup (skip if you're only using Discord)

- Create a bot with [@BotFather](https://t.me/BotFather): `/newbot`, give it a name and username, copy the token.
- Disable group privacy so the bot can read group messages it isn't directly @-mentioned in: `/setprivacy` → select your bot → **Disable**. Not strictly required for the verify flow (commands are DM-only) but recommended for future features.
- Create a private supergroup that will be your gated holders chat. Add the bot to it as **admin** with **Invite Users via Link** and **Ban Users** permissions enabled.
- Get the chat id: send any message in the group, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` (replace `<TOKEN>` with your bot token). Look for `"chat":{"id":-100…}` in the JSON response. That negative number is your chat id.

### 2. Config + env

```sh
cp abotbasho.config.example.ts abotbasho.config.ts
cp .env.example .env
```

Fill in your collection details in `abotbasho.config.ts`. Fill in `PONDER_RPC_URL_1` and the `DISCORD_*` (and `TWITTER_*` if posting to X) values in `.env`.

### 3. Enable verification (optional)

Add a `verify` block to `abotbasho.config.ts`. At least one of `discord` or `telegram` is required when `enabled: true`. Set both to support both platforms in parallel.

```ts
verify: {
  enabled: true,
  publicUrl: "https://verify.example.xyz",
  delegateCash: true,
  // openseaBio: true,        // enables the OS-bio path
  // openseaSlug: "my-coll",
  // sourceCodeUrl: "https://github.com/your-fork/abotbasho",
  discord: {
    roleId: "<discord role id>",
  },
  // telegram: {
  //   chatId: "-1001234567890",      // from step 1b
  //   inviteLinkExpirySec: 600,      // single-use invite TTL, default 600
  //   kickSemantics: true,           // ban + unban so re-verify can rejoin
  // },
}
```

Add to `.env`:

```sh
echo "VERIFY_INTERNAL_SECRET=$(openssl rand -hex 32)" >> .env
echo "WALLETCONNECT_PROJECT_ID=<from cloud.reown.com>" >> .env
echo "PUBLIC_INDEXER_CHAIN_ID=1" >> .env
# echo "TELEGRAM_BOT_TOKEN=<from @BotFather>" >> .env    # only if verify.telegram is set
# echo "OPENSEA_API_KEY=<from docs.opensea.io>" >> .env  # only if openseaBio: true
# echo "VERIFY_WEB_HOST_PORT=3004" >> .env               # only if host port 3000 is taken
```

### 4. TLS via reverse proxy

`verify-web` listens on plain HTTP and binds to `127.0.0.1:${VERIFY_WEB_HOST_PORT:-3000}` (loopback only). Put nginx/Caddy/Traefik in front to terminate TLS. The path tokens used in verify URLs rely on TLS for confidentiality, so **never expose the verify-web port publicly**.

Example nginx vhost (`/etc/nginx/sites-available/verify.example.xyz`):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name verify.example.xyz;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 30s;
        proxy_connect_timeout 10s;
    }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/verify.example.xyz /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d verify.example.xyz
```

`Host` and `X-Forwarded-*` matter: the indexer uses `Host` for the SIWE domain check and reads `X-Forwarded-For` for per-IP rate limiting.

### 5. Bring it up

```sh
docker compose --profile verify up -d --build
# Add --profile telegram if verify.telegram is configured:
# docker compose --profile verify --profile telegram up -d --build
docker compose --profile verify logs -f indexer discord verify-web
```

Without `--profile verify`, only the indexer + bots come up; the `verify-web` container stays off. The `telegram` service is opt-in via its own profile to keep Discord-only deployments unchanged.

Wait for:
- `indexer`: `Started returning 200 responses from /ready endpoint`
- `discord`: `[plugin:verify] enabled (role=..., poll=5000ms, ...)`
- `telegram` (if enabled): `[telegram] logged in as @<botname>` and `[telegram] verify poller running every 5000ms for chat <chatId>`
- `verify-web`: should log nothing notable. Confirm with `curl -sI https://verify.example.xyz | head -1` returning `HTTP/2 200` (or 404 on root, which is correct since only `/v/<token>` is a real route).

### 6. Post the verification embed

In your Discord guild, run `/verify-admin post` in whatever channel you want the persistent embed to live. The embed has a primary **Verify** button (and an optional **Source code** button if you set `verify.sourceCodeUrl`). Members click **Verify** to start the flow.

### 7. Optional: least-privilege Postgres role

To restrict the verification pool's grants, create a dedicated role and set `VERIFICATION_DB_URL`:

```sql
CREATE ROLE verify_app LOGIN PASSWORD '...';
GRANT USAGE ON SCHEMA verification TO verify_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA verification TO verify_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA verification TO verify_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA verification GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO verify_app;
```

Migrations still need a role that can `CREATE` in the schema; run them once with the superuser, then switch the indexer to `VERIFICATION_DB_URL=postgresql://verify_app:...`.

### Upgrading: Ponder schema reset

After pulling indexer code changes that touch `ponder.config.ts`, `ponder.schema.ts`, or the Transfer handler in `src/index.ts`, Ponder will refuse to reuse the existing schema with `Schema 'abotbasho' was previously used by a different Ponder app`. To recover:

```sh
# Stop indexer-dependent services (preserve indexer-db)
docker compose stop discord twitter indexer

# Drop the Ponder schema (verification.* schema is separate and survives)
docker compose exec indexer-db psql -U ponder abotbasho \
  -c "DROP SCHEMA abotbasho CASCADE;"

# Bring everything back up; indexer re-syncs from deployBlock
docker compose --profile verify up -d --build
```

Pure API-route or Discord-side changes (e.g., adding `/verify-admin` subcommands) don't change Ponder's build hash and don't need a schema reset.

If you want to skip the bot's "replay all old sales as if new" behavior after re-sync, set the cursor file to a high value before bringing the bot back up, e.g. `echo '{"cursor":"99999999000000"}' > /var/lib/docker/volumes/abotbasho_discord-data/_data/cursor.json` (adjust path / cursor value to your setup).

## Admin commands

Discord slash commands gated to `Manage Server` permission. Available when `verify.enabled: true`.

| Command | Purpose |
| --- | --- |
| `/verify-admin post` | Drops a persistent embedded message in the current channel with a primary **Verify** button (and **Source code** link button if `verify.sourceCodeUrl` is set). Members click Verify to start the flow without needing a slash command. |
| `/verify-admin status user:@user` | Shows the user's verified wallet links: address, method (siwe/delegate/bio), signer (if delegate), verification timestamp. |
| `/verify-admin force-revoke user:@user` | Removes all of the user's links from `verification.links` and immediately removes the role. Bypasses the normal Transfer-driven revocation path. Use for incidents, abuse, or transitions. |
| `/verify-admin list` | Total count verified through abotbasho, breakdown by method, first-verification date, first 20 user mentions. Useful for monitoring adoption. |
| `/verify-admin sweep mode:dry-run\|apply` | Cross-references current holder role assignments against `verification.links`. Reports (`dry-run`) or removes (`apply`) the role from members who hold it but have no link row. Useful for migrating from another verifier. Requires the SERVER MEMBERS INTENT enabled in the Dev Portal. The apply path is throttled to ~10 role removals per second and audit-reasons each removal as `verify-admin sweep: not in verification.links`. |

User-facing slash commands:

| Command | Purpose |
| --- | --- |
| `/verify` | Reply with a fresh ephemeral verification link. Same destination as the embed Verify button. |
| `/unverify` | Remove all of the user's own links and role. Self-service. |

## Local development with anvil

For iterating on the indexer, verify flow, or marketplace decoders without burning mainnet gas, the repo ships a `compose.dev.yml` overlay that swaps in a local [anvil](https://book.getfoundry.sh/anvil/) node forking your mainnet RPC. The fork preserves real collection state and the delegate.cash registry, so production code paths exercise unchanged.

### Setup

1. Bring the stack up (verify profile included if you want to test that flow):

   ```sh
   docker compose -f docker-compose.yml -f compose.dev.yml --profile verify up -d --build
   ```

   This boots `anvil` (forking from `PONDER_RPC_URL_1`), then the indexer and verify-web with `INDEXER_CHAIN_ID=31337`.

2. Seed the dev wallet with an NFT from your configured collection:

   ```sh
   bun run dev:seed                   # tokenId 1 from cfg.primary
   bun run dev:seed 4242              # specific tokenId
   bun run dev:seed-wrapper           # tokenId 1 from cfg.wrapper (for delegate-from-wrapper testing)
   bun run dev:seed-wrapper 4242
   ```

   The script reads `ownerOf(tokenId)` on the fork, impersonates that owner via `anvil_impersonateAccount`, funds them, and transfers the token to anvil's account 0 (`0xf39F…2266`). Re-run after restarting anvil; state lives in memory.

3. Import the dev wallet into MetaMask. Anvil's account 0 has a public, well-known private key:

   ```
   0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```

   Add a custom network: name `Anvil`, RPC `http://127.0.0.1:8545`, chain id `31337`, symbol `ETH`.

### Test loop

- **Verify (grant)**: Run `/verify` in your Discord guild → page opens at `http://localhost:3000/v/<token>`. Sign with the imported anvil account. Role applies within `pollIntervalMs`.
- **Verify (revoke via Transfer)**: `bun run dev:unseed` (or `dev:unseed-wrapper`) transfers the NFT to `0x…dEaD`. The indexer's Transfer hook fires, `balanceOf` drops to 0, the link row is deleted, and the role is revoked on next poll. Re-run `dev:seed` to restore.
- **Verify (revoke via admin)**: `/verify-admin force-revoke @yourself` removes the link without touching chain state.

### Caveats

- The fork is in-memory; restarting `anvil` resets to fresh state. Re-run `dev:seed`.
- `tokenId 1` may not exist in every collection. Pass an existing tokenId as the second arg.
- `verify.publicUrl` and `VERIFY_PUBLIC_DOMAIN` must match where the browser opens the page (typically `http://localhost:3000`).
- Indexer code changes (`ponder.config.ts`, schema, handlers) trigger Ponder's "schema previously used by a different Ponder app" guard. Reset with:

  ```sh
  docker compose -f docker-compose.yml -f compose.dev.yml --profile verify down -v
  docker compose -f docker-compose.yml -f compose.dev.yml --profile verify up -d --build
  bun run dev:seed
  ```

  To preserve `verification.links` rows across resets, drop only the Ponder schema: `docker compose exec indexer-db psql -U ponder abotbasho -c "DROP SCHEMA abotbasho CASCADE;"`.

## Customizing

### Verify page theme

`packages/verify-web` is a single-page SvelteKit app whose visual design is driven entirely by CSS custom properties in `packages/verify-web/src/app.css`.

1. **Colors.** Edit the `:root` and `:root.dark` blocks at the top of `app.css`. The four most worth overriding are `--bg`, `--fg`, `--border`, and `--accent`. Page components (the card, buttons, error/ok blocks, mono code labels, tabs) all read from these tokens, so changes propagate without touching `+page.svelte`.

2. **Fonts.** The default stack is system fonts so the page works without licensed font files. To bundle your own brand fonts, drop the files into `packages/verify-web/static/fonts/`, add `@font-face` rules at the bottom of `app.css`, and update `--font-display` / `--font-body` / `--font-mono`.

3. **Light/dark default.** The page defaults to dark and respects `prefers-color-scheme`. The pre-paint script in `packages/verify-web/src/app.html` reads `localStorage["verify-theme"]` first if you want to ship a theme toggle later.

4. **Copy.** Title, eyebrow, lede, footer text, error labels, and step-by-step instructions live in `packages/verify-web/src/routes/v/[token]/+page.svelte`. The user-facing error labels are mapped from indexer error codes via `errorLabel(...)` in the same file.

After editing, rebuild verify-web (`docker compose ... up -d --build verify-web`).

### Discord embed

Title, description, and color of the persistent embed posted by `/verify-admin post` live in `packages/discord/src/plugins/verify/commands/verify-admin.ts` (`EMBED_COLOR`, the `embed.setTitle(...)`/`setDescription(...)` calls in the `post` branch). The Verify button label is in `buttons.ts`.

The optional **Source code** button is shown when `verify.sourceCodeUrl` is set in your config; pointing it at your fork's GitHub repo is a way to show users the source they're trusting.

### Block explorer URL

`format.ts` defaults to `https://etherscan.io` for tx/address links in Discord embeds + tweets. Set `cfg.explorerUrl: "https://basescan.org"` (or whatever) to swap in a different chain's explorer. OpenSea collection links are currently mainnet-only (`/assets/ethereum/`); see `packages/indexer/README.md` for status.

## Per-package docs

- [packages/discord/README.md](./packages/discord/README.md) for Discord app setup, plugin authoring, and runtime `/config`.
- [packages/twitter/README.md](./packages/twitter/README.md) for X developer app setup, free tier limits, and the debug command.
- [packages/indexer/README.md](./packages/indexer/README.md) for Ponder + Postgres details, marketplace decoder extension, wrapper contract assumptions, and adding a chain.

## License

MIT. See [LICENSE](./LICENSE).
