import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  // Path tokens go in the URL — keep them out of any Referer header that
  // downstream resources or external links might leak into.
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};
