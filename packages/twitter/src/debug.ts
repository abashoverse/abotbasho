import { TwitterApi } from "twitter-api-v2";
import { getProjectConfig, type AnyEvent } from "@abotbasho/shared";
import { env } from "./env.js";
import { composeTweet } from "./format.js";
import { tokenImageUrl, uploadTokenMedia } from "./media.js";

const VITALIK = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;
const NICK = "0x983110309620D911731Ac0932219af06091b6744" as const;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const cfg = getProjectConfig();
const now = BigInt(Math.floor(Date.now() / 1000));

const fakeSale: AnyEvent = {
  type: "sale",
  id: "debug-sale",
  contract: cfg.primary.label,
  contractAddress: cfg.primary.address,
  tokenId: 1n,
  fromAddress: VITALIK,
  toAddress: NICK,
  priceWei: 5n * 10n ** 17n,
  currency: "ETH",
  marketplace: "seaport",
  txHash: ZERO_HASH,
  blockNumber: 0n,
  logIndex: 0,
  timestamp: now,
  cursor: 0n,
};

const fakeWrap: AnyEvent = {
  type: "wrap",
  id: "debug-wrap",
  kind: "wrap",
  tokenId: 1n,
  owner: VITALIK,
  txHash: ZERO_HASH,
  blockNumber: 0n,
  logIndex: 0,
  timestamp: now,
  cursor: 0n,
};

const fakeUnwrap: AnyEvent = {
  type: "wrap",
  id: "debug-unwrap",
  kind: "unwrap",
  tokenId: 2n,
  owner: NICK,
  txHash: ZERO_HASH,
  blockNumber: 0n,
  logIndex: 0,
  timestamp: now,
  cursor: 0n,
};

const args = process.argv.slice(2);
const post = args.includes("--post");
const filtered = args.filter((a) => !a.startsWith("--"));
const which = (filtered[0] ?? "all").toLowerCase();

const allEvents: AnyEvent[] = cfg.wrapper
  ? [fakeSale, fakeWrap, fakeUnwrap]
  : [fakeSale];

const events: AnyEvent[] =
  which === "sale"
    ? [fakeSale]
    : which === "wrap"
      ? [fakeWrap]
      : which === "unwrap"
        ? [fakeUnwrap]
        : allEvents;

const messages = {
  sale: cfg.messages?.sale,
  wrap: cfg.messages?.wrap,
  unwrap: cfg.messages?.unwrap,
};

const twitter = post
  ? new TwitterApi({
      appKey: env.TWITTER_API_KEY,
      appSecret: env.TWITTER_API_SECRET,
      accessToken: env.TWITTER_ACCESS_TOKEN,
      accessSecret: env.TWITTER_ACCESS_SECRET,
    })
  : null;

for (const ev of events) {
  const [text, imageUrl] = await Promise.all([
    composeTweet(ev, env.MAINNET_RPC_URL, messages),
    tokenImageUrl(ev, env.MAINNET_RPC_URL),
  ]);
  console.log("---");
  console.log(text);
  console.log(`[length: ${text.length} / 280]`);
  console.log(`[image: ${imageUrl ?? "(none)"}]`);
  if (twitter) {
    const mediaId = await uploadTokenMedia(twitter, ev, env.MAINNET_RPC_URL);
    if (mediaId) console.log(`[media uploaded: ${mediaId}]`);
    const res = await twitter.v2.tweet(
      mediaId ? { text, media: { media_ids: [mediaId] } } : { text },
    );
    console.log(`[posted: ${res.data.id}${mediaId ? " +media" : ""}]`);
  }
}

if (!post) {
  console.log("\n(dry run, pass --post to actually tweet, costs 1 of your 500/month)");
}

process.exit(0);
