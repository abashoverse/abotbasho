import { TwitterApi } from "twitter-api-v2";
import {
  DEFAULT_POLL_INTERVAL_MS,
  getProjectConfig,
  startPoller,
  type AnyEvent,
} from "@abotbasho/shared";
import { env } from "./env.js";
import { composeTweet } from "./format.js";
import { uploadTokenMedia } from "./media.js";

const twitter = new TwitterApi({
  appKey: env.TWITTER_API_KEY,
  appSecret: env.TWITTER_API_SECRET,
  accessToken: env.TWITTER_ACCESS_TOKEN,
  accessSecret: env.TWITTER_ACCESS_SECRET,
});

const me = await twitter.v2.me();
console.log(`[twitter] authenticated as @${me.data.username}`);

const cfg = getProjectConfig();
const messages = {
  sale: cfg.messages?.sale,
  wrap: cfg.messages?.wrap,
  unwrap: cfg.messages?.unwrap,
};
const intervalMs = cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

const onEvent = async (event: AnyEvent) => {
  const text = await composeTweet(event, env.MAINNET_RPC_URL, messages);
  try {
    const mediaId = await uploadTokenMedia(twitter, event, env.MAINNET_RPC_URL);
    const res = await twitter.v2.tweet(
      mediaId ? { text, media: { media_ids: [mediaId] } } : { text },
    );
    console.log(
      `[twitter] posted ${event.type} cursor=${event.cursor} tweet=${res.data.id}${mediaId ? " +media" : ""}`,
    );
  } catch (err) {
    console.error("[twitter] post failed:", err);
    throw err;
  }
};

const poller =
  intervalMs > 0
    ? startPoller({
        indexerUrl: env.INDEXER_API_URL,
        cursorFile: env.CURSOR_FILE,
        intervalMs,
        onEvent,
        onError: (err) => console.error("[twitter] poll error:", err),
      })
    : (console.log("[twitter] poller disabled (pollIntervalMs <= 0)"),
       { stop: () => {} });

const shutdown = () => {
  console.log("[twitter] shutting down");
  poller.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
