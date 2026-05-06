import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { startBio } from "$lib/indexer";

export const POST: RequestHandler = async ({ params }) => {
  const result = await startBio(params.token);
  if ("ok" in result && result.ok) {
    return json(result);
  }
  return json(result, { status: result.status });
};
