import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import { fetchSession } from "$lib/indexer";

export const load: PageServerLoad = async ({ params }) => {
  const session = await fetchSession(params.token);
  if (!session) throw error(404, "invalid_or_expired");
  return { token: params.token, session };
};
