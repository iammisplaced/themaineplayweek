// Returns one film's TMDb details (with credits) for the admin's "Refresh TMDb" button.
// The TMDb key stays on the server (Vercel env var TMDB_API_KEY), and only signed-in
// admins can use it: the request must carry the caller's Supabase access token.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../js/shared.js";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request) {
  const tmdbId = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return Response.json({ error: "id must be a positive whole number" }, { status: 400, headers: NO_STORE });
  }

  const apiKey = String(process.env.TMDB_API_KEY || "").trim();
  if (!apiKey) {
    return Response.json({ error: "TMDB_API_KEY isn't set on the server" }, { status: 500, headers: NO_STORE });
  }

  try {
    if (!(await isSignedIn(request.headers.get("authorization")))) {
      return Response.json({ error: "Sign in again, then retry" }, { status: 401, headers: NO_STORE });
    }

    const response = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}` +
        `?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) {
      // Pass TMDb's own status through (404 = no film with that ID) without echoing the key.
      const body = await response.json().catch(() => ({}));
      const message = body.status_message || "request failed";
      return Response.json({ error: `TMDb ${response.status}: ${message}` }, { status: response.status, headers: NO_STORE });
    }
    return Response.json(await response.json(), { headers: NO_STORE });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502, headers: NO_STORE });
  }
}

// Supabase confirms the token belongs to a current user. Any signed-in user is an admin
// here, matching the database's "Auth write" policies.
async function isSignedIn(authorization) {
  if (!/^Bearer \S+$/.test(authorization || "")) return false;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization },
    signal: AbortSignal.timeout(10000),
  });
  return response.ok;
}
