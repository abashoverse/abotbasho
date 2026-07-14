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

// Startup auth check, used only to log the handle. A transient failure here
// (a 429 from Twitter's tight /2/users/me limit, a network blip) must not
// hard-crash the container: an unhandled rejection exits the process, Docker
// restarts it, and the restart immediately re-hits the same limit, looping.
// Retry with backoff, then start the poller anyway if it never succeeds. The
// poller already catches and logs per-tweet failures, and tweeting uses a
// different endpoint than /2/users/me, so a `me()` rate limit doesn't imply
// tweets will fail.
const AUTH_CHECK_MAX_ATTEMPTS = 5;
for (let attempt = 1; ; attempt++) {
  try {
    const me = await twitter.v2.me();
    console.log(`[twitter] authenticated as @${me.data.username}`);
    break;
  } catch (err) {
    if (attempt >= AUTH_CHECK_MAX_ATTEMPTS) {
      console.warn(
        `[twitter] startup auth check failed after ${attempt} attempts; ` +
          `starting poller anyway (check API credentials if tweets keep failing):`,
        err,
      );
      break;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(30_000, 1000 * 2 ** attempt)),
    );
  }
}

const cfg = getProjectConfig();
const messages = {
  sale: cfg.messages?.sale,
  wrap: cfg.messages?.wrap,
  unwrap: cfg.messages?.unwrap,
};
const intervalMs = cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

const onEvent = async (event: AnyEvent) => {
  // Mints are Discord-only; the Twitter bot has no mint copy template.
  if (event.type === "mint") {
    console.log(`[twitter] skipping mint cursor=${event.cursor}`);
    return;
  }
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
