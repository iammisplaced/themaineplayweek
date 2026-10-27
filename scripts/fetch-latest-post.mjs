#!/usr/bin/env node

// Saves the newest Substack post to data/latest-post.json for the homepage card. Substack
// doesn't allow cross-origin requests from the browser, so a daily GitHub Action runs this.
// It reads the RSS feed: Substack's JSON API refuses requests from GitHub's servers (403),
// while the feed is meant for automated readers.
// The file has no timestamp, so it only changes (and gets committed) when a new post appears.

import fs from "node:fs/promises";
import path from "node:path";

const FEED_URL = "https://themaineplayweek.substack.com/feed";
const USER_AGENT = "themaineplayweek-showtimes (+https://showtimes.themaineplayweek.com)";
const outputPath = path.resolve(process.cwd(), "data/latest-post.json");

const response = await fetch(FEED_URL, {
  headers: { "User-Agent": USER_AGENT },
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) {
  throw new Error(`Substack feed request failed (${response.status})`);
}

const feed = await response.text();
const item = feed.match(/<item>([\s\S]*?)<\/item>/)?.[1] || "";

const latestPost = {
  title: readTag(item, "title"),
  canonical_url: readTag(item, "link"),
  subtitle: readTag(item, "description"),
  cover_image: decodeEntities(item.match(/<enclosure[^>]*\burl="([^"]*)"/)?.[1] || ""),
  author: readTag(item, "dc:creator"),
};
if (!latestPost.title || !latestPost.canonical_url) {
  throw new Error("Substack feed returned no usable post");
}

await fs.writeFile(outputPath, `${JSON.stringify(latestPost, null, 2)}\n`);
console.log(`Saved "${latestPost.title}" to ${path.relative(process.cwd(), outputPath)}`);

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
