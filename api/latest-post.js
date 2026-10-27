// Returns the newest Substack post for the homepage card, read from the RSS feed.
// Substack doesn't allow cross-origin requests from the browser, and refuses GitHub's
// runners (403), so Vercel fetches it here. The response is cached for a day, so the
// feed is read about once a day.

const FEED_URL = "https://themaineplayweek.substack.com/feed";
const USER_AGENT = "themaineplayweek-showtimes (+https://showtimes.themaineplayweek.com)";

export async function GET() {
  try {
    const response = await fetch(FEED_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`Substack feed request failed (${response.status})`);
    }

    const post = parseLatestPost(await response.text());
    if (!post.title || !post.canonical_url) {
      throw new Error("Substack feed returned no usable post");
    }

    return Response.json(post, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400" },
    });
  } catch (error) {
    // Not cached, so the next visitor tries the feed again.
    return Response.json({ error: error.message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

function parseLatestPost(feed) {
  const item = feed.match(/<item>([\s\S]*?)<\/item>/)?.[1] || "";
  return {
    title: readTag(item, "title"),
    canonical_url: readTag(item, "link"),
    subtitle: readTag(item, "description"),
    cover_image: decodeEntities(item.match(/<enclosure[^>]*\burl="([^"]*)"/)?.[1] || ""),
    author: readTag(item, "dc:creator"),
  };
}

// Text of the first <tag> in the item, whether it's wrapped in CDATA or entity-encoded.
function readTag(xml, tag) {
  const value = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] || "";
  const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return (cdata ? cdata[1] : decodeEntities(value)).trim();
}

function decodeEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
