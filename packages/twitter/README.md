# @abotbasho/twitter

twitter-api-v2 client for X (free tier, OAuth 1.0a). Polls the indexer and posts a tweet per event with the token image attached.

This package assumes you've already read the [root README](../../README.md) and have `abotbasho.config.ts` configured.

## Contents

1. [X developer app setup](#x-developer-app-setup)
2. [Environment variables](#environment-variables)
3. [Tweet layout](#tweet-layout)
4. [Free tier and post budget](#free-tier-and-post-budget)
5. [Debug command](#debug-command)
6. [Troubleshooting](#troubleshooting)

## X developer app setup

1. Go to <https://developer.x.com/> and create a project + app.
2. Under your app's **Settings → User authentication settings**, set permissions to **Read and write**.

   **Do this before generating tokens.** Tokens generated with read-only permissions cannot post even after you change the setting; you have to regenerate.

3. Under **Keys and tokens**:
   - Copy "API Key and Secret" → `TWITTER_API_KEY`, `TWITTER_API_SECRET`.
   - Generate "Access Token and Secret" → `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`.
4. The bot uses your authenticated user account, so post as the account whose tokens you generated.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `TWITTER_API_KEY` | yes | App key. |
| `TWITTER_API_SECRET` | yes | App secret. |
| `TWITTER_ACCESS_TOKEN` | yes | User access token (must be generated *after* enabling Read+Write). |
| `TWITTER_ACCESS_SECRET` | yes | User access token secret. |
| `CURSOR_FILE` | no | Where to persist the indexer cursor. Default `./data/cursor.json`. |

## Tweet layout

```
<tweetPrefix> <DisplayName> #<id> | BOUGHT
💰 0.5 ETH ($1,234.56)
🛒 seaport
seller: vitalik.eth
buyer: 0x9831…6744
<custom message from abotbasho.config.ts messages.sale>
```

The leading `<tweetPrefix>` (and trailing space) is omitted unless `abotbasho.config.ts` sets `tweetPrefix` (typically an emoji or short brand mark). Wrap/unwrap variants drop the price and marketplace lines.

The composer fits the custom message under 280 chars by truncating it (with an ellipsis) if needed; URLs are counted as 23 chars per X's convention.

The Twitter free tier doesn't support the `tweet_with_media` v2 endpoint, so the bot uploads media via the v1.1 `media/upload` endpoint and attaches the resulting `media_id` to the tweet. Images larger than 5 MB are skipped.

## Free tier and post budget

500 posts/month rolling. With high-volume collections plus multiple event kinds (sale + wrap + unwrap), wrap/unwrap loops can burn through this fast. Rough budgeting:

- 1 sale + 1 wrap + 1 unwrap per "round trip" = 3 posts.
- 500 / 3 ≈ 166 round trips/month before you're rate limited.

If you're at risk of hitting the cap, you have two options:

**Option 1: disable wrap/unwrap on Twitter only.** Leave the `wrapper` block out of `abotbasho.config.ts` *for the Twitter deploy*. Use `ABOTBASHO_CONFIG_PATH` to point the Twitter container at a Twitter-specific config that omits `wrapper` while Discord keeps the full config.

**Option 2: filter low-value sales.** Add a price floor in `src/index.ts`'s `onEvent`. For example, drop sales below 0.1 ETH:

```ts
const onEvent = async (event: AnyEvent) => {
  if (event.type === "sale" && event.priceWei < 10n ** 17n) return;
  // ...
};
```

## Debug command

```sh
bun run debug:twitter             # dry run, prints the tweets that would post
bun run debug:twitter sale --post # actually post just a sale (costs 1 of your 500/month)
bun run debug:twitter all --post  # post one of each event type
```

Useful for verifying credentials, checking custom message length, and seeing how the format renders before going live.

## Troubleshooting

- **"403 Forbidden" or "Read-only application cannot POST".** Tokens were generated before enabling Read+Write. Regenerate access tokens.
- **Posts succeed but no image attached.** Check the bot's startup log for `[twitter] media upload failed`. Likely the token's `tokenURI` returned an unresolvable IPFS URI; try setting `ipfsGateway` in `abotbasho.config.ts` to a faster gateway (e.g. `https://w3s.link/ipfs/`).
- **Rate limit hit mid-month.** You burned the 500/month cap. See [Free tier and post budget](#free-tier-and-post-budget) above for filters.
