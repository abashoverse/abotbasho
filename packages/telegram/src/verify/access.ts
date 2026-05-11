import { Bot, GrammyError, InlineKeyboard } from "grammy";

export interface AccessApplyResult {
  ok: boolean;
  reason?: string;
}

const isNotParticipantError = (msg: string): boolean =>
  /USER_NOT_PARTICIPANT|user is not a participant|PARTICIPANT_ID_INVALID/i.test(
    msg,
  );

/**
 * Apply a grant or revoke to the gated chat.
 *
 * Grant: createChatInviteLink(member_limit=1, short expire_date) plus a DM
 * to the user with the link. Single-use + short expiry means a stolen DM
 * after the user has already joined is useless.
 *
 * Revoke: banChatMember kicks the user from the chat. If `kickSemantics`
 * is true, an immediate unbanChatMember(only_if_banned=true) restores their
 * ability to rejoin via a future invite, which matches the "no auto-regrant
 * but re-verify can rejoin" policy from the indexer.
 *
 * On `user_not_in_chat`, revoke is treated as success: the desired end
 * state (user not in chat) holds, no work to do.
 */
export const applyAccessEvent = async (
  bot: Bot,
  params: {
    chatId: string;
    userId: string;
    desiredState: "grant" | "revoke";
    inviteLinkExpirySec: number;
    kickSemantics: boolean;
  },
): Promise<AccessApplyResult> => {
  if (params.desiredState === "grant") {
    let inviteLink: string;
    try {
      const expireDate =
        Math.floor(Date.now() / 1000) + params.inviteLinkExpirySec;
      const res = await bot.api.createChatInviteLink(params.chatId, {
        member_limit: 1,
        expire_date: expireDate,
      });
      inviteLink = res.invite_link;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `createChatInviteLink_failed: ${msg}` };
    }
    try {
      const keyboard = new InlineKeyboard().url(
        "Join holders group",
        inviteLink,
      );
      await bot.api.sendMessage(
        params.userId,
        `Verified. Your single-use invite (expires in ${Math.round(
          params.inviteLinkExpirySec / 60,
        )} min). Tap the button below to join.`,
        { reply_markup: keyboard },
      );
    } catch (err) {
      // Most common cause: user never DMed the bot before /verify (shouldn't
      // happen since they used /verify in DM, but possible if they purged
      // the chat) or the user has blocked the bot. The invite link will
      // expire on its own; no leak.
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `sendMessage_failed: ${msg}` };
    }
    return { ok: true };
  }

  // revoke
  try {
    await bot.api.banChatMember(params.chatId, Number(params.userId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof GrammyError && isNotParticipantError(msg)) {
      return { ok: true, reason: "user_not_in_chat" };
    }
    return { ok: false, reason: `banChatMember_failed: ${msg}` };
  }
  if (params.kickSemantics) {
    try {
      await bot.api.unbanChatMember(params.chatId, Number(params.userId), {
        only_if_banned: true,
      });
    } catch (err) {
      // The user is already kicked at this point; failure to unban just
      // means they can't rejoin via a future invite until a manual unban.
      // Report it but don't loop on revoke retries.
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: `unbanChatMember_failed: ${msg}` };
    }
  }
  return { ok: true };
};
