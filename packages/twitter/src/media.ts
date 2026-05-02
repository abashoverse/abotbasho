import type { TwitterApi } from "twitter-api-v2";
import { fetchTokenImage, getProjectConfig, type AnyEvent } from "@abotbasho/shared";

const MAX_IMAGE_BYTES = 5_000_000; // Twitter v1.1 media/upload caps at 5MB

const imageContractFor = (event: AnyEvent) =>
  event.type === "sale" ? event.contractAddress : getProjectConfig().primary.address;

export const tokenImageUrl = (event: AnyEvent, rpcUrl: string) =>
  fetchTokenImage(rpcUrl, imageContractFor(event), event.tokenId);

const downloadWithLimit = async (
  url: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; mimeType: string } | null> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;

  const len = res.headers.get("content-length");
  if (len && Number(len) > maxBytes) {
    console.warn(`[twitter] image content-length ${len} exceeds ${maxBytes}, skipping`);
    return null;
  }

  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      console.warn(`[twitter] image stream exceeded ${maxBytes} bytes, aborting`);
      return null;
    }
    chunks.push(value);
  }

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const mimeType = res.headers.get("content-type") ?? "image/png";
  return { buffer, mimeType };
};

export const uploadTokenMedia = async (
  twitter: TwitterApi,
  event: AnyEvent,
  rpcUrl: string,
): Promise<string | null> => {
  const url = await tokenImageUrl(event, rpcUrl);
  if (!url) return null;
  try {
    const data = await downloadWithLimit(url, MAX_IMAGE_BYTES);
    if (!data) return null;
    return await twitter.v1.uploadMedia(data.buffer, { mimeType: data.mimeType });
  } catch (err) {
    console.warn("[twitter] media upload failed:", err);
    return null;
  }
};
