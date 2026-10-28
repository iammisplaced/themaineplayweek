// Shared by the api/ functions (Vercel doesn't serve files starting with "_" as routes).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../js/shared.js";

// Supabase confirms the token belongs to a current user. Any signed-in user is an admin
// here, matching the database's "Auth write" policies.
export async function isSignedIn(authorization) {
  if (!/^Bearer \S+$/.test(authorization || "")) return false;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization },
    signal: AbortSignal.timeout(10000),
  });
  return response.ok;
}
