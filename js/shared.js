// Helpers shared by app.js, map-view.js, admin-films.js and scripts/generate-film-pages.mjs.
// Keep this file free of DOM access at import time so Node can load it too.

export const SUPABASE_URL = "https://rjfsjoratsfqcyyjseqm.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqZnNqb3JhdHNmcWN5eWpzZXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mzc5MDgsImV4cCI6MjA4ODIxMzkwOH0.dmcQ_ffwmm4JIKTjSUNNYLGQ9w_v1mR6VRMZimVnLNg";

// Vercel branch previews (themaineplayweek-git-<branch>-….vercel.app) and localhost read
// and save the `staging` copy of the data (supabase/staging/create-staging.sql); any
// other host, including the live site, Vercel's production addresses and Node scripts,
// uses `public`. On a staging host, `?db=live` switches that tab to live data and
// `?db=staging` switches it back.
const DB_OVERRIDE_KEY = "tmp-db-override";

function pickDbSchema() {
  const host = String(globalThis.location?.hostname || "");
  const isStagingHost =
    host === "localhost" || host === "127.0.0.1" || (host.endsWith(".vercel.app") && host.includes("-git-"));
  if (!isStagingHost) return "public";
  let override = "";
  try {
    override = new URLSearchParams(globalThis.location.search).get("db") || "";
    if (override) globalThis.sessionStorage?.setItem(DB_OVERRIDE_KEY, override);
    else override = globalThis.sessionStorage?.getItem(DB_OVERRIDE_KEY) || "";
  } catch {
    // Storage can be blocked; the URL parameter still works for this page.
  }
  return override === "live" ? "public" : "staging";
}

export const SUPABASE_DB_SCHEMA = pickDbSchema();
export const SUPABASE_CLIENT_OPTIONS = Object.freeze({ db: { schema: SUPABASE_DB_SCHEMA } });

// Adds a fixed "Staging data" label so a preview can't be mistaken for the live site.
// Does nothing on `public`.
export function markStagingPage(doc = document) {
  if (SUPABASE_DB_SCHEMA !== "staging" || !doc?.body || doc.getElementById("staging-data-badge")) return;
  const badge = doc.createElement("a");
  badge.id = "staging-data-badge";
  badge.href = "?db=live";
  badge.title = "This page uses the staging copy of the data. Click to switch this tab to live data.";
  badge.textContent = "Staging data";
  badge.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:2147483647;padding:6px 10px;border-radius:999px;" +
    "background:#b42318;color:#fff;font:600 12px/1 system-ui,sans-serif;letter-spacing:.04em;" +
    "text-transform:uppercase;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.3);";
  doc.body.appendChild(badge);
}

export const FILM_SORT_WEIGHTS = Object.freeze({
  tmdbPopularity: 0.2,
  tmdbRating: 0.15,
  tmdbRecency: 0.1,
  upcomingShowings: 0.35,
  theatreCoverage: 0.15,
  staffFavoriteBoost: 0.12,
});
export const RELEASE_RECENCY_WINDOW_DAYS = 14;

// ---- Text ----

export function stripDiacritics(value) {
  const text = String(value || "");
  if (typeof text.normalize !== "function") return text;
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeSortTitle(value) {
  return String(value || "")
    .trim()
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/^the\s+/i, "")
    .toLowerCase();
}

export function slugifyTextSegment(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    .slice(0, 80);
}

// Must match the directory names written by scripts/generate-film-pages.mjs.
export function buildFilmSlug(title, year) {
  return slugifyTextSegment(
    Number.isInteger(Number(year)) && year !== "" && year !== null
      ? `${String(title || "")}-${Number(year)}`
      : String(title || "")
  );
}

export function buildFilmPageUrl(title, year) {
  return `films/${buildFilmSlug(title, year)}/`;
}

export function normalizeOutboundUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  return `https://${raw}`;
}

// ---- Values ----

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---- Location ----

// Shared by the main app and the film pages so a location set on one is used by the other.
// Shape: { mode: "zip" | "geolocation", zip, lat, lng }.
export const LOCATION_PREFERENCE_STORAGE_KEY = "tmp-location-preference-v1";

// Looks up a US ZIP code (ZIP+4 is accepted) and returns { lat, lng }, or null when it
// can't be found.
export async function geocodeUsZip(zip) {
  const zip5 = /^(\d{5})(?:-\d{4})?$/.exec(String(zip || "").trim())?.[1];
  if (!zip5) return null;
  try {
    const response = await fetch(`https://api.zippopotam.us/us/${zip5}`);
    if (!response.ok) return null;
    const place = (await response.json())?.places?.[0];
    const lat = Number(place?.latitude);
    const lng = Number(place?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

export function debounce(fn, waitMs = 150) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn(...args);
    }, Math.max(0, Number(waitMs) || 0));
  };
}

// ---- Dates & times ----

export function parseIsoDate(dateIso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateIso ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day
  ) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

export function parseIsoDateLike(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return parseIsoDate(raw.slice(0, 10));
}

export function getDayDifferenceFromToday(targetDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDay = Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((targetDay - todayDay) / 86400000);
}

export function formatDisplayDate(dateIso) {
  const date = parseIsoDate(dateIso);
  if (!date) return dateIso;
  const dayDiff = getDayDifferenceFromToday(date);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff > 1 && dayDiff <= 6) {
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  }
  const showYear = date.getFullYear() !== new Date().getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
  }).format(date);
}

// Accepts "18:30", "6:30 PM", "6:30pm" and "7 PM". Returns "HH:MM" or "" when unparseable.
export function to24HourTime(time12Hour) {
  const input = String(time12Hour ?? "").trim();

  const match24 = /^(\d{1,2}):([0-5]\d)$/.exec(input);
  if (match24) {
    const hour = Number(match24[1]);
    if (hour >= 0 && hour <= 23) {
      return `${String(hour).padStart(2, "0")}:${match24[2]}`;
    }
  }

  const match12 = /^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)$/i.exec(input);
  if (!match12) return "";

  let hour = Number(match12[1]);
  const minutes = match12[2] || "00";
  const period = match12[3].toUpperCase();

  if (hour < 1 || hour > 12) return "";

  if (period === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }

  return `${String(hour).padStart(2, "0")}:${minutes}`;
}

export function compareTimes(a, b) {
  return to24HourTime(a).localeCompare(to24HourTime(b));
}

export function getShowDateTime(dateIso, time12Hour) {
  const hhmm = to24HourTime(time12Hour);
  if (!hhmm) return null;
  const baseDate = parseIsoDate(dateIso);
  if (!baseDate) return null;
  const [hours, minutes] = hhmm.split(":").map(Number);
  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

// ---- Film ranking (used by the main app and the static film pages) ----

export function normalizeScoreRange(value, max) {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

export function normalizeLogRange(value, expectedHigh) {
  if (!Number.isFinite(value) || value <= 0 || expectedHigh <= 0) return 0;
  return Math.max(0, Math.min(1, Math.log1p(value) / Math.log1p(expectedHigh)));
}

export function calculateReleaseRecencyScore(releaseDate) {
  const release = parseIsoDateLike(releaseDate);
  if (!release) return 0;
  const daysSinceRelease = (Date.now() - release.getTime()) / 86400000;
  if (!Number.isFinite(daysSinceRelease)) return 0;
  if (daysSinceRelease <= 0) return 1;
  if (daysSinceRelease >= RELEASE_RECENCY_WINDOW_DAYS) return 0;
  return 1 - (daysSinceRelease / RELEASE_RECENCY_WINDOW_DAYS);
}

export function getFilmSortBreakdown({
  popularity,
  voteAverage,
  voteCount,
  releaseDate,
  staffFavorite,
  upcomingTimes,
  theatreCount,
}) {
  const popularityScore = normalizeScoreRange(toFiniteNumber(popularity), 100);
  const voteAverageScore = normalizeScoreRange(toFiniteNumber(voteAverage), 10);
  const voteCountValue = toFiniteNumber(voteCount);
  const voteConfidence = normalizeLogRange(voteCountValue, 10000);
  const ratingScore = voteAverageScore * voteConfidence;
  const releaseRecency = calculateReleaseRecencyScore(releaseDate);
  const upcomingShowings = normalizeLogRange(upcomingTimes, 80);
  const theatreCoverage = normalizeLogRange(theatreCount, 30);

  const tmdbScore =
    FILM_SORT_WEIGHTS.tmdbPopularity * popularityScore +
    FILM_SORT_WEIGHTS.tmdbRating * ratingScore +
    FILM_SORT_WEIGHTS.tmdbRecency * releaseRecency;
  const localDemandScore =
    FILM_SORT_WEIGHTS.upcomingShowings * upcomingShowings +
    FILM_SORT_WEIGHTS.theatreCoverage * theatreCoverage;
  const editorialBoost = staffFavorite ? FILM_SORT_WEIGHTS.staffFavoriteBoost : 0;

  return {
    finalScore: tmdbScore + localDemandScore + editorialBoost,
    tmdbScore,
    localDemandScore,
    editorialBoost,
    inputs: {
      popularity: popularityScore,
      voteAverage: voteAverageScore,
      voteCount: voteCountValue,
      voteConfidence,
      ratingScore,
      releaseRecency,
      upcomingTimes,
      upcomingShowings,
      theatreCoverage,
    },
    weights: FILM_SORT_WEIGHTS,
  };
}

// ---- Showtime notes ----

// A showing's notes field can target specific times with a time prefix, separated by ";":
//   "7:00 PM: Q&A with director; 9:30 PM: Open captions"
// Text without a time prefix (e.g. "Members night; 7pm: Q&A") applies to every time that day.
// Prefix times match regardless of formatting ("7pm" matches "7:00 PM").
const NOTE_TIME = String.raw`\d{1,2}(?::[0-5]\d)?\s*[ap]\.?m\.?`;
const NOTE_TIME_SEPARATOR = String.raw`\s*[:\u2013\u2014-]\s*`;
const NOTE_SEGMENT_SPLIT = new RegExp(String.raw`;\s*(?=${NOTE_TIME}${NOTE_TIME_SEPARATOR})`, "i");
const NOTE_TIMED_SEGMENT = new RegExp(String.raw`^(${NOTE_TIME})${NOTE_TIME_SEPARATOR}([\s\S]+)$`, "i");

export function getShowtimeNote(notes, time) {
  const text = String(notes || "").trim();
  if (!text) return "";
  const targetTime = to24HourTime(time);
  const parts = [];
  text.split(NOTE_SEGMENT_SPLIT).forEach((segment) => {
    const trimmed = segment.trim();
    if (!trimmed) return;
    const timed = NOTE_TIMED_SEGMENT.exec(trimmed);
    if (!timed) {
      parts.push(trimmed);
      return;
    }
    const prefixTime = to24HourTime(timed[1].replace(/\./g, "").replace(/\s+/g, " ").trim());
    if (prefixTime && prefixTime === targetTime) parts.push(timed[2].trim());
  });
  return parts.join(" · ");
}

function splitNoteSegments(notes) {
  return String(notes || "")
    .split(NOTE_SEGMENT_SPLIT)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

// Adds the entries of `incoming` that `existing` doesn't already have, so importing
// "7:00 PM: IMAX" keeps a hand-written "9:30 PM: Q&A with director".
export function mergeShowtimeNotes(existing, incoming) {
  const merged = splitNoteSegments(existing);
  const seen = new Set(merged.map((segment) => segment.replace(/\s+/g, " ").toLowerCase()));
  splitNoteSegments(incoming).forEach((segment) => {
    const key = segment.replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(segment);
  });
  return merged.join("; ");
}

// ---- Showtimes table ----

// The `select` that groupShowtimesIntoShowings needs from the `showtimes` table.
export const SHOWTIME_COLUMNS = "id,theatre_id,film_id,festival_id,show_date,start_time,is_premium,note,room";

// "19:05:00" or "19:05" -> "7:05 PM". "" when unparseable.
export function from24HourTime(value) {
  const match = /^(\d{1,2}):([0-5]\d)/.exec(String(value ?? "").trim());
  if (!match) return "";
  const hour = Number(match[1]);
  if (hour > 23) return "";
  const period = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12}:${match[2]} ${period}`;
}

// Turns `showtimes` rows (one per time) back into one entry per theatre, film and day,
// shaped like the old `showings` rows: { theatre_id, film_id, festival_id, show_date,
// room, notes, times, premium_times }, with times as "7:00 PM". Each time's note goes
// into `notes` so that getShowtimeNote(notes, time) gives it back: one shared note
// stays plain, otherwise each note gets its time as a prefix ("7:00 PM: Q&A").
export function groupShowtimesIntoShowings(rows) {
  const groups = new Map();
  (rows || []).forEach((row) => {
    const time = from24HourTime(row?.start_time);
    if (!time) return;
    const key = `${row.theatre_id}|${row.film_id}|${row.show_date}`;
    if (!groups.has(key)) {
      groups.set(key, {
        theatre_id: row.theatre_id,
        film_id: row.film_id,
        festival_id: null,
        show_date: row.show_date,
        room: "",
        entries: [],
      });
    }
    const group = groups.get(key);
    if (group.festival_id == null && row.festival_id != null) group.festival_id = row.festival_id;
    if (!group.room && row.room) group.room = String(row.room).trim();
    group.entries.push({ time, premium: Boolean(row.is_premium), note: String(row.note || "").trim() });
  });

  const byTime = (a, b) => compareTimes(a, b);
  return Array.from(groups.values()).map(({ entries, ...group }) => {
    const noted = entries.filter((entry) => entry.note);
    let notes = "";
    if (noted.length === entries.length && noted.every((entry) => entry.note === noted[0].note)) {
      notes = noted[0]?.note || "";
    } else if (noted.length) {
      notes = Array.from(new Set(noted.map((entry) => `${entry.time}: ${entry.note}`))).join("; ");
    }
    return {
      ...group,
      notes,
      times: Array.from(new Set(entries.filter((entry) => !entry.premium).map((entry) => entry.time))).sort(byTime),
      premium_times: Array.from(new Set(entries.filter((entry) => entry.premium).map((entry) => entry.time))).sort(byTime),
    };
  });
}

// Shows the note for any `.show-time-noted` element (data-note) in a floating tooltip on
// hover, keyboard focus, or tap. The tooltip is fixed-positioned on <body> so card
// overflow can't clip it. Safe to call more than once.
export function initShowtimeNoteTooltips(doc = document) {
  if (doc.documentElement.dataset.showtimeNotesReady) return;
  doc.documentElement.dataset.showtimeNotesReady = "true";

  const NOTED_SELECTOR = ".show-time-noted";
  const GUTTER = 8;
  let tooltip = null;
  let activeTarget = null;
  let pinned = false;

  const ensureTooltip = () => {
    if (tooltip) return tooltip;
    tooltip = doc.createElement("div");
    tooltip.className = "show-note-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    doc.body.appendChild(tooltip);
    return tooltip;
  };

  const hide = () => {
    activeTarget?.classList.remove("is-note-open");
    activeTarget = null;
    pinned = false;
    if (tooltip) tooltip.hidden = true;
  };

  const show = (target) => {
    const note = String(target?.dataset?.note || "").trim();
    if (!note) return;
    const el = ensureTooltip();
    activeTarget?.classList.remove("is-note-open");
    activeTarget = target;
    target.classList.add("is-note-open");
    el.textContent = note;
    el.hidden = false;

    const view = doc.defaultView;
    const rect = target.getBoundingClientRect();
    const tipRect = el.getBoundingClientRect();
    const maxLeft = view.innerWidth - tipRect.width - GUTTER;
    const left = Math.max(GUTTER, Math.min(rect.left + rect.width / 2 - tipRect.width / 2, maxLeft));
    const above = rect.top - tipRect.height - GUTTER;
    const placeBelow = above < GUTTER;
    el.dataset.placement = placeBelow ? "below" : "above";
    el.style.left = `${left}px`;
    el.style.top = `${placeBelow ? rect.bottom + GUTTER : above}px`;
  };

  doc.addEventListener("mouseover", (event) => {
    const target = event.target.closest?.(NOTED_SELECTOR);
    if (target && target !== activeTarget && !pinned) show(target);
  });
  doc.addEventListener("mouseout", (event) => {
    if (pinned || !activeTarget) return;
    if (activeTarget.contains(event.relatedTarget)) return;
    if (event.target.closest?.(NOTED_SELECTOR) === activeTarget) hide();
  });
  doc.addEventListener("focusin", (event) => {
    const target = event.target.closest?.(NOTED_SELECTOR);
    if (target) show(target);
  });
  doc.addEventListener("focusout", (event) => {
    if (activeTarget && event.target === activeTarget && !pinned) hide();
  });
  doc.addEventListener("click", (event) => {
    const target = event.target.closest?.(NOTED_SELECTOR);
    if (!target) {
      if (activeTarget) hide();
      return;
    }
    if (pinned && target === activeTarget) {
      hide();
      return;
    }
    show(target);
    pinned = true;
  });
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeTarget) hide();
  });
  doc.defaultView.addEventListener("scroll", () => activeTarget && hide(), { capture: true, passive: true });
  doc.defaultView.addEventListener("resize", () => activeTarget && hide());
}
