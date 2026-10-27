#!/usr/bin/env node

// Saves the newest Substack post to data/latest-post.json for the homepage card. Substack
// doesn't allow cross-origin requests from the browser, so a daily GitHub Action runs this.
// The file has no timestamp, so it only changes (and gets committed) when a new post appears.

import fs from "node:fs/promises";
import path from "node:path";

const ARCHIVE_URL = "https://themaineplayweek.substack.com/api/v1/archive?sort=new&limit=1";
const outputPath = path.resolve(process.cwd(), "data/latest-post.json");

const response = await fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(30000) });
if (!response.ok) {
  throw new Error(`Substack archive request failed (${response.status})`);
}

const posts = await response.json();
const post = Array.isArray(posts) ? posts[0] : null;
if (!post?.title || !post?.canonical_url) {
  throw new Error("Substack archive returned no usable post");
}

const latestPost = {
  title: post.title,
  canonical_url: post.canonical_url,
  subtitle: post.subtitle || post.description || "",
  cover_image: post.cover_image || "",
  author: post.publishedBylines?.[0]?.name || "",
};

await fs.writeFile(outputPath, `${JSON.stringify(latestPost, null, 2)}\n`);
console.log(`Saved "${latestPost.title}" to ${path.relative(process.cwd(), outputPath)}`);
