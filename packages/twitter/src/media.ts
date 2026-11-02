import { EUploadMimeType, type TwitterApi } from "twitter-api-v2";
import { loadTokenImage, type AnyEvent, type TokenImage } from "@abotbasho/shared";

// Sales carry the contract they happened on. Wraps and unwraps don't, so they
// let loadTokenImage walk its default order (primary, then wrapper).
const preferredContract = (event: AnyEvent) =>
  event.type === "sale" ? event.contractAddress : undefined;

export const tokenImage = (event: AnyEvent, rpcUrl: string): Promise<TokenImage | null> =>
  loadTokenImage(rpcUrl, event.tokenId, preferredContract(event));

export const uploadTokenMedia = async (
  twitter: TwitterApi,
  event: AnyEvent,
  rpcUrl: string,
): Promise<string | null> => {
  const image = await tokenImage(event, rpcUrl);
  if (!image) return null;
  try {
    // X retired the v1.1 media/upload endpoint (2025-03-31), so v1.uploadMedia
    // now fails and every sale posts image-less. The v2 chunked media endpoint
    // is the supported path and works with the same OAuth 1.0a user context.
    return await twitter.v2.uploadMedia(image.data, {
      media_type: image.mimeType as EUploadMimeType,
      media_category: "tweet_image",
    });
  } catch (err) {
    console.warn("[twitter] media upload failed:", err);
    return null;
  }
};
