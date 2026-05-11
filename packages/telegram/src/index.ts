import { Bot, type Context, InlineKeyboard } from "grammy";
import {
  DEFAULT_VERIFY_POLL_INTERVAL_MS,
  getProjectConfig,
} from "@abotbasho/shared";
import { env } from "./env.js";
import { startSiwe, unlink } from "./verify/client.js";
import { drainRoleEvents } from "./verify/poller.js";

const cfg = getProjectConfig();
const verifyCfg = cfg.verify;
const telegramCfg = verifyCfg?.telegram;
const verifyEnabled = verifyCfg?.enabled === true && telegramCfg !== undefined;

if (!verifyEnabled) {
  console.log(
    "[telegram] verify.telegram not configured; bot will idle (no commands, no poller).",
  );
}
if (verifyEnabled && !env.VERIFY_INTERNAL_SECRET) {
  console.error(
    "[telegram] VERIFY_INTERNAL_SECRET is not set; /verify will fail.",
  );
}

const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// Restrict the verify flow to private chats (DMs). The /verify URL contains
// a one-time token bound to a single user id, so emitting it in a group
// would leak it to everyone in the room. Group messages with these commands
// are silently ignored.
const inDm = (ctx: Context): boolean => ctx.chat?.type === "private";

bot.command("start", async (ctx) => {
  if (!inDm(ctx)) return;
  if (verifyEnabled) {
    await ctx.reply(
      `Welcome. Run /verify to prove on-chain ownership of ${cfg.project.name} and get a single-use invite to the holders group.`,
    );
  } else {
    await ctx.reply(
      `Hi. ${cfg.project.name} verification isn't configured on this bot.`,
    );
  }
});

if (verifyEnabled && telegramCfg) {
  bot.command("verify", async (ctx) => {
    if (!inDm(ctx)) return;
    if (!ctx.from) return;
    try {
      const { url } = await startSiwe({
        telegramUserId: String(ctx.from.id),
        chatId: telegramCfg.chatId,
      });
      const keyboard = new InlineKeyboard().url(
        "Open verification page",
        url,
      );
      await ctx.reply(
        [
          `Sign in to verify your ${cfg.project.name} holdings.`,
          ``,
          `The link below is valid for 10 minutes. delegate.cash hot/cold delegation is supported on the page.`,
        ].join("\n"),
        {
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        },
      );
    } catch (err) {
      console.error("[telegram /verify] startSiwe failed:", err);
      await ctx.reply("Verification is currently unavailable.");
    }
  });

  bot.command("unverify", async (ctx) => {
    if (!inDm(ctx)) return;
    if (!ctx.from) return;
    try {
      await unlink({
        telegramUserId: String(ctx.from.id),
        chatId: telegramCfg.chatId,
      });
      await ctx.reply(
        "Your wallet links have been removed. You'll be kicked from the holders group shortly.",
      );
    } catch (err) {
      console.error("[telegram /unverify] unlink failed:", err);
      await ctx.reply("Unverify is currently unavailable.");
    }
  });
}

bot.catch((err) => {
  console.error("[telegram] update handler error:", err.error);
});

// Surface the command list in the Telegram client UI (commands menu).
if (verifyEnabled) {
  try {
    await bot.api.setMyCommands([
      {
        command: "verify",
        description: "Verify NFT holdings and get a chat invite",
      },
      {
        command: "unverify",
        description: "Remove your wallet links and exit the chat",
      },
    ]);
  } catch (err) {
    console.error("[telegram] setMyCommands failed:", err);
  }
}

// Verify poller. grammy doesn't have a plugin "intervals" runner like the
// Discord package, so a plain setInterval is the simplest fit. The drain
// itself is concurrency-safe via the indexer's atomic role_events updates.
let pollerHandle: ReturnType<typeof setInterval> | null = null;
if (verifyEnabled && telegramCfg) {
  const intervalMs =
    verifyCfg?.pollIntervalMs ?? DEFAULT_VERIFY_POLL_INTERVAL_MS;
  pollerHandle = setInterval(() => {
    drainRoleEvents({
      bot,
      chatId: telegramCfg.chatId,
      inviteLinkExpirySec: telegramCfg.inviteLinkExpirySec ?? 600,
      kickSemantics: telegramCfg.kickSemantics !== false,
      log: (...args) => console.log("[telegram poller]", ...args),
      errorLog: (...args) => console.error("[telegram poller]", ...args),
    }).catch((err) => console.error("[telegram poller] drain failed:", err));
  }, intervalMs);
  console.log(
    `[telegram] verify poller running every ${intervalMs}ms for chat ${telegramCfg.chatId}`,
  );
}

const shutdown = async () => {
  console.log("[telegram] shutting down");
  if (pollerHandle) clearInterval(pollerHandle);
  await bot.stop();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

// Long-poll for updates. Not awaited (canonical grammy pattern): the
// promise lives as long as polling, so awaiting would deadlock the
// process here. The setInterval above and grammy's network handles keep
// the event loop alive; SIGINT/SIGTERM call bot.stop() which lets the
// process exit cleanly.
bot.start({
  onStart: (info) => {
    console.log(`[telegram] logged in as @${info.username}`);
  },
});
