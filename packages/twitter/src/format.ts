import {
  displayAddress,
  displayNameOf,
  ethUsdPrice,
  formatAmount,
  formatUsd,
  getProjectConfig,
  shortAddr,
  weiToUsd,
  type AnyEvent,
} from "@abotbasho/shared";

const TWEET_LIMIT = 280;
const URL_LENGTH = 23;

export interface CustomMessages {
  sale?: string;
  wrap?: string;
  unwrap?: string;
}

const lengthOf = (lines: string[]): number => {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    total += /^https?:\/\//.test(line.trim()) ? URL_LENGTH : [...line].length;
    if (i < lines.length - 1) total += 1;
  }
  return total;
};

const fitCustom = (base: string[], custom?: string): string[] => {
  if (!custom) return base;
  const candidate = [...base, custom];
  const overflow = lengthOf(candidate) - TWEET_LIMIT;
  if (overflow <= 0) return candidate;
  const trimmed = custom.slice(0, Math.max(0, custom.length - overflow - 1)) + "…";
  return [...base, trimmed];
};

const displayContractFor = (label: string): string => {
  const cfg = getProjectConfig();
  if (label === cfg.primary.label) return displayNameOf(cfg.primary);
  if (cfg.wrapper && label === cfg.wrapper.label) {
    return cfg.wrapper.pluralName ?? displayNameOf(cfg.wrapper);
  }
  return label;
};

export const composeTweet = async (
  event: AnyEvent,
  rpcUrl: string,
  messages: CustomMessages,
): Promise<string> => {
  const cfg = getProjectConfig();
  const prefix = cfg.tweetPrefix ? `${cfg.tweetPrefix} ` : "";

  if (event.type === "sale") {
    const [seller, buyer, ethUsd] = await Promise.all([
      displayAddress(rpcUrl, event.fromAddress, shortAddr),
      displayAddress(rpcUrl, event.toAddress, shortAddr),
      ethUsdPrice(),
    ]);
    const priceText = formatAmount(event.priceWei, event.currency);
    const usdText = ethUsd ? ` (${formatUsd(weiToUsd(event.priceWei, ethUsd))})` : "";
    const base = [
      `${prefix}${displayContractFor(event.contract)} #${event.tokenId} | BOUGHT`,
      `💰 ${priceText}${usdText}`,
      `🛒 ${event.marketplace}`,
      `seller: ${seller}`,
      `buyer: ${buyer}`,
    ];
    return fitCustom(base, messages.sale).join("\n");
  }

  if (!cfg.wrapper) {
    throw new Error("received wrap event but no wrapper contract is configured");
  }

  const owner = await displayAddress(rpcUrl, event.owner, shortAddr);
  const isWrap = event.kind === "wrap";
  const stateLabel = isWrap ? "WRAPPED" : "UNWRAPPED";
  // wrap: primary token went into the wrapper. unwrap: wrapper token was burned.
  const labelToUse = isWrap ? cfg.primary.label : cfg.wrapper.label;
  const customMsg = isWrap ? messages.wrap : messages.unwrap;

  const base = [
    `${prefix}${displayContractFor(labelToUse)} #${event.tokenId} | ${stateLabel}`,
    `by: ${owner}`,
  ];
  return fitCustom(base, customMsg).join("\n");
};
