import type { RequestHandler } from "./$types";
import { json } from "@sveltejs/kit";
import { finalizeBio } from "$lib/indexer";

export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json()) as {
    wallet_address?: string;
    code?: string;
    delegated_from?: string;
  };
  if (!body.wallet_address || !body.code) {
    return json(
      { error: "wallet_address_and_code_required" },
      { status: 400 },
    );
  }
  const result = await finalizeBio({
    token: params.token,
    wallet_address: body.wallet_address,
    code: body.code,
    delegated_from: body.delegated_from,
  });
  if ("ok" in result && result.ok) {
    return json(result);
  }
  return json(result, { status: result.status });
};
