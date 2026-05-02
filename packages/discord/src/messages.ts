import { getProjectConfig } from "@abotbasho/shared";
import { getConfig } from "./config.js";
import { allMessageKinds } from "./plugins/extensions.js";

export const messageFor = (kind: string): string | undefined => {
  const runtime = getConfig().messages[kind];
  if (runtime) return runtime;
  const projectMsgs = getProjectConfig().messages as
    | Record<string, string | undefined>
    | undefined;
  return projectMsgs?.[kind];
};

export const allMessages = (): Record<string, string | undefined> => {
  const result: Record<string, string | undefined> = {};
  for (const kind of allMessageKinds()) {
    result[kind.id] = messageFor(kind.id);
  }
  return result;
};
