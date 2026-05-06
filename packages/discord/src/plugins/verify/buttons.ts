import type { ButtonHandler } from "../types.js";
import { replyWithVerifyLink } from "./start-flow.js";

export const VERIFY_BUTTON_ID = "verify:start";

export const verifyButton: ButtonHandler = {
  customId: VERIFY_BUTTON_ID,
  execute: async (interaction) => {
    await replyWithVerifyLink(interaction);
  },
};
