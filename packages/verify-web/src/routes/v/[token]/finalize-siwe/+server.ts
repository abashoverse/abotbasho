import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { finalizeSiwe } from "$lib/indexer";

export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json()) as {
    message?: string;
    signature?: string;
    delegated_from?: string;
  };
  if (!body.message || !body.signature) {
    return json({ error: "message_and_signature_required" }, { status: 400 });
  }
  const result = await finalizeSiwe({
    token: params.token,
    message: body.message,
    signature: body.signature,
    delegated_from: body.delegated_from,
  });
  if ("ok" in result && result.ok) {
    return json(result);
  }
  return json(result, { status: result.status });
};
