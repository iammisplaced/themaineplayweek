// Starts the "Film Pages Sync" GitHub Action, so the static film pages pick up an admin
// save in a few minutes instead of at the next daily run. Only signed-in admins can call it.
// The GitHub token (Vercel env var GITHUB_DISPATCH_TOKEN) is a fine-grained token for this
// repo with "Actions: Read and write".

import { isSignedIn } from "./_supabase-auth.js";

const NO_STORE = { "Cache-Control": "no-store" };
const WORKFLOW_URL =
  "https://api.github.com/repos/iammisplaced/themaineplayweek/actions/workflows/film-pages-supabase-sync.yml/dispatches";

export async function POST(request) {
  const token = String(process.env.GITHUB_DISPATCH_TOKEN || "").trim();
  if (!token) {
    return Response.json({ error: "GITHUB_DISPATCH_TOKEN isn't set on the server" }, { status: 500, headers: NO_STORE });
  }

  try {
    if (!(await isSignedIn(request.headers.get("authorization")))) {
      return Response.json({ error: "Sign in again, then retry" }, { status: 401, headers: NO_STORE });
    }

    // The workflow's concurrency group queues at most one run behind the current one, so
    // several saves in a row become one or two rebuilds.
    const response = await fetch(WORKFLOW_URL, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return Response.json(
        { error: `GitHub ${response.status}: ${body.message || "request failed"}` },
        { status: 502, headers: NO_STORE }
      );
    }
    return Response.json({ started: true }, { headers: NO_STORE });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502, headers: NO_STORE });
  }
}
