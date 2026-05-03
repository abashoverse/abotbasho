# @abotbasho/indexer

[Ponder](https://ponder.sh) app that subscribes to `Transfer` (and optionally `Wrapped` / `Unwrapped`) on the configured contracts, decodes the matching marketplace event from each transaction's receipt, and writes rows to Postgres. Bots reach it over a small HTTP API.

This package assumes you've already read the [root README](../../README.md) and have `abotbasho.config.ts` configured.

## Contents

1. [What it does](#what-it-does)
2. [Setup](#setup)
3. [API](#api)
4. [Schema](#schema)
5. [Customizing](#customizing)
   - [Adding a marketplace](#adding-a-marketplace)
   - [Wrapper contract assumptions](#wrapper-contract-assumptions)
   - [Adding a chain](#adding-a-chain)
6. [Notes](#notes)

## What it does

For each `Transfer` on the primary contract:

1. Skip if `from` or `to` is the zero address (mint or burn).
2. Skip if `from` or `to` is the configured wrapper address (those are wraps/unwraps, not sales).
3. Pull the full transaction receipt and run it through every registered marketplace decoder until one returns a price.
4. If a decoder matches, insert a row into `sale_events` with the price, currency, marketplace, parties, and a monotonic `cursor`.
5. Pure transfers (gifts, manual moves) are intentionally ignored: no decoder match, no row.

When a wrapper is configured, the indexer also listens for the wrapper's `Wrapped(owner, tokenId)` and `Unwrapped(owner, tokenId)` events, writes them to `wrap_events`, and tracks current wrapper holdings in `wrapper_holdings`.

## Setup

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PONDER_RPC_URL_1` | yes | Ethereum mainnet RPC URL. Anything that supports `eth_getLogs` works. |
| `DATABASE_URL` | yes (Docker) | Postgres connection string. Ponder uses Postgres in production, falls back to PGLite for local dev. |
| `PONDER_PORT` | no | API port. Default 42069. |
| `DATABASE_SCHEMA` | no | Postgres schema name. Defaults to the database name in Docker compose. |

### Local development

```sh
bun run dev:indexer   # ponder dev
```

Ponder auto-reloads handler changes. The local dev mode uses PGLite, so no separate Postgres process is required. Data lives in `.ponder/`.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/events?since=<cursor>&limit=<n>` | Returns `{ sales, wraps }` arrays of events with `cursor > since`. Bots use this to poll. `limit` defaults to 50, capped at 200. |
| `GET /api/recent?type=<all\|sales\|wraps\|unwraps>&limit=<n>` | Reverse chronological. Used by `/recent` in Discord. `limit` defaults to 5, capped at 50. |
| `GET /api/holding?tokenId=<id>` | Returns the wrapper holding row for a token, or `{ holding: null }`. Used by `/wrapped` and (when a wrapper is configured) `/view` in Discord. |
| `GET /sql/*` | Ponder's built-in SQL-over-HTTP endpoint. Bots talk to the indexer through `INDEXER_SQL_URL` derived from this. |

## Schema

Three tables, all defined in `ponder.schema.ts`:

```
sale_events
  id              text  PK     "<blockNumber>-<logIndex>"
  contract        text         primary or wrapper label, set per-event
  contractAddress hex          contract address that emitted the Transfer
  tokenId         bigint
  fromAddress     hex
  toAddress       hex
  priceWei        bigint
  currency        text         "ETH" | "WETH"
  marketplace     text         "seaport" | "blur" | ...
  txHash          hex
  blockNumber     bigint
  logIndex        integer
  timestamp       bigint
  cursor          bigint       blockNumber * 1_000_000 + logIndex (monotonic)

wrap_events
  id              text  PK     "<blockNumber>-<logIndex>"
  kind            text         "wrap" | "unwrap"
  tokenId         bigint
  owner           hex
  txHash          hex
  blockNumber     bigint
  logIndex        integer
  timestamp       bigint
  cursor          bigint

wrapper_holdings
  id              text  PK     tokenId as string
  tokenId         bigint
  owner           hex
  holdingSince    bigint       block timestamp when the wrapper started holding this token
  blockNumber     bigint
```

The `cursor` column is the basis for the bots' polling: each bot persists the last seen cursor and asks for `events?since=<cursor>`.

## Customizing

### Adding a marketplace

The marketplace decoder pipeline lives in `packages/shared/src/marketplaces/`. Currently shipped:

- **Seaport** (OpenSea + Seaport-compatible) v1.4 / v1.5 / v1.6: `OrderFulfilled` event.
- **Blur** Exchange v2: `Execution721Packed` and `Execution721TakerFeePacked`.

To add a new marketplace (LooksRare, X2Y2, Sudoswap, etc.):

1. Add the event ABI fragment under `packages/shared/src/abis/`.
2. Create a decoder file with a function `(logs, nftAddress, tokenId) => DecodedSale | null` that scans the receipt logs and returns `{ priceWei, currency, marketplace }` if the NFT was sold via that marketplace in this tx.
3. Wire it into the dispatcher in `packages/shared/src/marketplaces/index.ts` (chain-of-responsibility: first non-null wins).

No changes to this package are needed; the indexer already pulls the full receipt for every transfer and dispatches to whichever decoders are registered.

### Wrapper contract assumptions

The bundled `WrapperAbi` (`packages/shared/src/abis/Wrapper.ts`) assumes the wrapper emits:

- `Wrapped(address indexed owner, uint256 indexed tokenId)`
- `Unwrapped(address indexed owner, uint256 indexed tokenId)`

If your wrapper uses different signatures, edit that file. The indexer registration in `src/index.ts` is signature-agnostic; it just calls `handleWrap` with `kind: "wrap" | "unwrap"`.

If your collection has no wrapper, leave the `wrapper` block out of `abotbasho.config.ts`. The indexer will then only register the primary contract and only emit sale events.

### Adding a chain

Currently the indexer is hardcoded to Ethereum mainnet (chain ID 1) and the shared helpers (`packages/shared/src/{ens,metadata,tokenInfo}.ts`) use the mainnet viem client. Adapting to other EVM chains takes a few coordinated edits:

- `packages/indexer/ponder.config.ts`: change the `chains` block (id, RPC URL, network name).
- `packages/shared/src/ens.ts`, `metadata.ts`, `tokenInfo.ts`: swap the `mainnet` chain import.
- `packages/shared/src/format.ts`: replace the `etherscan.io` and `opensea.io` URL builders.

ENS only exists on mainnet; on other chains, drop the resolver call or wire in a chain-specific name service (Basenames, etc.). PRs welcome.

## Notes

- ENS reverse resolution uses viem's `getEnsName`, which forward-verifies; names that don't resolve back to the address are dropped. Done in `packages/shared/src/ens.ts` with a 1-hour cache.
- Token images are fetched on demand from `tokenURI`, with IPFS URIs rewritten through the configured gateway (`config.ipfsGateway`). Cache is in-memory per process.
- Ponder's reorg handling means recent events may be re-emitted after a reorg; the bots are idempotent at the cursor level (they re-post if a row's cursor exceeds the saved one), so a deep reorg can cause a duplicate post for events near the tip. Acceptable for this use case.
