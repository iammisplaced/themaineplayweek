// Helpers shared by app.js, map-view.js, admin-films.js and scripts/generate-film-pages.mjs.
// Keep this file free of DOM access at import time so Node can load it too.

export const SUPABASE_URL = "https://rjfsjoratsfqcyyjseqm.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqZnNqb3JhdHNmcWN5eWpzZXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mzc5MDgsImV4cCI6MjA4ODIxMzkwOH0.dmcQ_ffwmm4JIKTjSUNNYLGQ9w_v1mR6VRMZimVnLNg";

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
