// Experimental mobile-first "find your film" quiz. Reads the live Supabase data (read-only),
// asks a few questions, and recommends one film with upcoming showtimes in Maine.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  escapeHtml,
  buildFilmSlug,
  normalizeOutboundUrl,
  toFiniteNumber,
  normalizeLogRange,
  parseIsoDateLike,
  formatDisplayDate,
  getShowDateTime,
} from "../js/shared.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const screen = document.getElementById("screen");
const progress = document.getElementById("progress");
const topBar = document.querySelector(".top");
const seenExplainer = document.getElementById("seen-explainer");

const SEEN_CARD_COUNT = 5;
const RECOGNIZABLE_VOTE_COUNT = 2000;
const NEARBY_RADII_MILES = [35, 70, 140];
const MIN_LEAD_MINUTES = 10;
const SUBSTACK_URL = "https://themaineplayweek.substack.com";
const INSTAGRAM_URL = "https://www.instagram.com/themaineplayweek/";

const MOODS = [
  { key: "light", label: "Something light and fun", genres: ["Comedy", "Animation", "Family", "Romance", "Music"] },
  { key: "edge", label: "On the edge of my seat", genres: ["Thriller", "Horror", "Action", "Mystery", "Crime"] },
  { key: "feel", label: "Make me feel something", genres: ["Drama", "Romance", "Music", "History", "War"] },
  { key: "think", label: "Make me think", genres: ["Documentary", "Drama", "Science Fiction", "Mystery", "History"] },
  { key: "spectacle", label: "Big-screen spectacle", genres: ["Action", "Adventure", "Science Fiction", "Fantasy", "Animation"] },
];

const WHEN_OPTIONS = [
  { key: "tonight", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "weekend", label: "This weekend" },
  { key: "week", label: "Any day this week" },
];

const ERA_OPTIONS = [
  { key: "new", label: "New releases" },
  { key: "classic", label: "Classics and revivals" },
  { key: "either", label: "Either is fine" },
];

const HIDDEN_GENRES = new Set(["TV Movie", "Short", "Short Film", "Film Festival", "Experimental", "Nature"]);

// Question screens in order; the result screen comes after the last one.
const FULL_STEPS = ["where", "when", "genres", "mood", "seen", "era"];
// "I'm feeling lucky" asks only where and when, then picks from the best-rated films with
// a lot more randomness.
const LUCKY_STEPS = ["where", "when"];
const JITTER = { full: 0.08, lucky: 0.6 };

const data = { ready: null, films: new Map(), theatres: new Map(), showings: [], ticketLinks: new Map() };

let answers;
let steps = FULL_STEPS;
let stepIndex = -1;
let seenCards = [];
let seenIndex = 0;
let seenExplained = false;
let ranked = [];
let pickIndex = 0;

function resetAnswers() {
  answers = {
    location: null,
    where: "",
    when: "",
    genres: new Set(),
    mood: "",
    ratings: new Map(),
    era: "",
  };
}

// ---- Data ----

async function fetchAll(table, columns, build = (q) => q) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data: chunk, error } = await build(supabase.from(table).select(columns)).range(from, from + pageSize - 1);
    if (error) throw new Error(`Couldn't read ${table}: ${error.message}`);
    rows.push(...(chunk || []));
    if (!chunk || chunk.length < pageSize) break;
  }
  return rows;
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function loadData() {
  const today = toIsoDate(new Date());
  const [films, theatres, theatreFilms, showings] = await Promise.all([
    fetchAll("films", "id,title,year,ticket_link,staff_favorite,staff_favorite_by,featured_on_playweek,featured_on_playweek_url,synopsis,tmdb_json", (q) => q.order("id")),
    fetchAll("theatres", "id,name,city,latitude,longitude", (q) => q.order("id")),
    fetchAll("theatre_films", "theatre_id,film_id,ticket_link", (q) => q.order("theatre_id").order("film_id")),
    fetchAll("showings", "theatre_id,film_id,show_date,times,premium_times", (q) => q.gte("show_date", today).order("id")),
  ]);

  films.forEach((row) => {
    const tmdb = row.tmdb_json && typeof row.tmdb_json === "object" ? row.tmdb_json : {};
    data.films.set(row.id, {
      id: row.id,
      title: row.title,
      year: row.year,
      ticketLink: row.ticket_link || "",
      staffFavorite: Boolean(row.staff_favorite),
      staffFavoriteBy: String(row.staff_favorite_by || "").trim(),
      articleUrl: row.featured_on_playweek ? normalizeOutboundUrl(row.featured_on_playweek_url) : "",
      synopsis: String(tmdb.overview || row.synopsis || "").trim(),
      genres: Array.isArray(tmdb.genres) ? tmdb.genres.filter(Boolean) : [],
      director: String(tmdb.director || "").trim(),
      stars: Array.isArray(tmdb.stars) ? tmdb.stars.filter(Boolean) : [],
      runtime: toFiniteNumber(tmdb.runtime),
      certification: String(tmdb.certification || "").trim(),
      voteAverage: toFiniteNumber(tmdb.voteAverage),
      voteCount: toFiniteNumber(tmdb.voteCount),
      popularity: toFiniteNumber(tmdb.popularity),
      releaseDate: String(tmdb.releaseDate || "").trim(),
      posterUrl: String(tmdb.posterUrl || "").trim(),
    });
  });
  theatres.forEach((row) => data.theatres.set(row.id, row));
  theatreFilms.forEach((row) => {
    if (row.ticket_link) data.ticketLinks.set(`${row.theatre_id}:${row.film_id}`, row.ticket_link);
  });
  data.showings = showings;
}

const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

// Every upcoming individual showtime, flattened, with past times dropped. The data mixes
// "3:49pm" and "3:49 PM", so times are deduped on the parsed value; premium wins a tie.
function getUpcomingSlots() {
  const cutoff = Date.now() + MIN_LEAD_MINUTES * 60000;
  const slotsByKey = new Map();
  data.showings.forEach((row) => {
    if (!data.films.has(row.film_id) || !data.theatres.has(row.theatre_id)) return;
    const add = (time, premium) => {
      const at = getShowDateTime(row.show_date, time);
      if (!at || at.getTime() < cutoff) return;
      const key = `${row.film_id}:${row.theatre_id}:${at.getTime()}`;
      if (slotsByKey.get(key)?.premium) return;
      slotsByKey.set(key, { filmId: row.film_id, theatreId: row.theatre_id, date: row.show_date, time: timeFormat.format(at), premium, at });
    };
    (row.times || []).forEach((time) => add(time, false));
    (row.premium_times || []).forEach((time) => add(time, true));
  });
  return [...slotsByKey.values()];
}

function getWindowDates(when) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const offset = (days) => {
    const date = new Date(today);
    date.setDate(date.getDate() + days);
    return toIsoDate(date);
  };
  if (when === "tonight") return new Set([offset(0)]);
  if (when === "tomorrow") return new Set([offset(1)]);
  if (when === "weekend") {
    // Friday through Sunday of this week; if it's already the weekend, from today.
    const weekday = today.getDay();
    const start = weekday === 0 || weekday >= 5 ? 0 : 5 - weekday;
    const end = weekday === 0 ? 0 : 7 - weekday;
    const dates = new Set();
    for (let day = start; day <= end; day += 1) dates.add(offset(day));
    return dates;
  }
  const dates = new Set();
  for (let day = 0; day < 7; day += 1) dates.add(offset(day));
  return dates;
}

function milesBetween(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

function getTheatreDistance(theatreId) {
  const theatre = data.theatres.get(theatreId);
  if (!answers.location || !Number.isFinite(theatre?.latitude) || !Number.isFinite(theatre?.longitude)) return null;
  return milesBetween(answers.location, { lat: theatre.latitude, lon: theatre.longitude });
}

// ---- Recommendation ----

function buildTasteProfile() {
  const genreWeights = new Map();
  const bump = (genre, amount) => genreWeights.set(genre, (genreWeights.get(genre) || 0) + amount);
  answers.genres.forEach((genre) => bump(genre, 1));
  const mood = MOODS.find((option) => option.key === answers.mood);
  mood?.genres.forEach((genre) => bump(genre, 0.6));

  const loved = [];
  const disliked = [];
  answers.ratings.forEach((rating, filmId) => {
    const film = data.films.get(filmId);
    if (!film) return;
    if (rating === "loved") {
      loved.push(film);
      film.genres.forEach((genre) => bump(genre, 0.5));
    } else if (rating === "nope") {
      disliked.push(film);
      film.genres.forEach((genre) => bump(genre, -0.4));
    }
  });
  return { genreWeights, mood, loved, disliked };
}

function listPhrase(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function scoreFilm(film, profile, nearestMiles) {
  const reasons = [];
  let score = 0;

  // Genre fit, scaled so films tagged with many genres don't win by volume.
  const genres = film.genres;
  if (genres.length) {
    const total = genres.reduce((sum, genre) => sum + (profile.genreWeights.get(genre) || 0), 0);
    score += total / Math.sqrt(genres.length);
    const picked = genres.filter((genre) => answers.genres.has(genre));
    if (picked.length) {
      reasons.push({ weight: 1 + picked.length * 0.2, text: `It's ${listPhrase(picked.map((g) => g.toLowerCase()))}, which you said you're into.` });
    }
    if (profile.mood && genres.some((genre) => profile.mood.genres.includes(genre))) {
      reasons.push({ weight: 0.8, text: `It fits "${profile.mood.label.toLowerCase()}."` });
    }
  }

  // Shared people and genres with films they loved or didn't.
  profile.loved.forEach((lovedFilm) => {
    if (film.director && film.director === lovedFilm.director) {
      score += 1.5;
      reasons.push({ weight: 2, text: `It's from ${film.director}, who directed ${lovedFilm.title}.` });
    }
    const sharedStars = film.stars.filter((star) => lovedFilm.stars.includes(star));
    if (sharedStars.length) {
      score += 0.5 * sharedStars.length;
      reasons.push({ weight: 1.6, text: `${listPhrase(sharedStars)} ${sharedStars.length > 1 ? "are" : "is"} in it, like in ${lovedFilm.title}.` });
    }
    const sharedGenres = film.genres.filter((genre) => lovedFilm.genres.includes(genre));
    if (sharedGenres.length >= 2) {
      reasons.push({ weight: 1.2, text: `You loved ${lovedFilm.title}, and this is cut from similar cloth.` });
    }
  });
  profile.disliked.forEach((dislikedFilm) => {
    if (film.director && film.director === dislikedFilm.director) score -= 1;
  });

  // Era preference.
  const release = parseIsoDateLike(film.releaseDate);
  const ageDays = release ? (Date.now() - release.getTime()) / 86400000 : null;
  const ageYears = ageDays === null ? (film.year ? new Date().getFullYear() - film.year : null) : ageDays / 365;
  if (answers.era === "new" && ageYears !== null) {
    if (ageDays !== null && ageDays <= 120) {
      score += 0.8;
      reasons.push({ weight: 0.9, text: "It's a new release." });
    } else if (ageYears > 10) {
      score -= 0.6;
    }
  } else if (answers.era === "classic" && ageYears !== null) {
    if (ageYears >= 15) {
      score += 0.8;
      reasons.push({ weight: 0.9, text: `It's a ${Math.floor(film.year / 10) * 10}s film back on the big screen.` });
    } else if (ageYears < 2) {
      score -= 0.4;
    }
  }

  // Quality, weighted by how many people have rated it.
  const rating = (film.voteAverage / 10) * normalizeLogRange(film.voteCount, 10000);
  score += 0.8 * rating;
  if (film.voteAverage >= 7.5 && film.voteCount >= 500) {
    reasons.push({ weight: 0.7, text: `It averages ${film.voteAverage.toFixed(1)} out of 10 on TMDb.` });
  }

  if (film.staffFavorite) {
    score += 0.3;
    const by = film.staffFavoriteBy ? ` (${film.staffFavoriteBy})` : "";
    reasons.push({ weight: 1.1, text: `It's a Playweek staff favourite${by}.` });
  }

  if (nearestMiles !== null) score -= Math.min(0.8, nearestMiles / 120);

  // A little randomness so starting over doesn't always give the same answer.
  score += Math.random() * (steps === LUCKY_STEPS ? JITTER.lucky : JITTER.full);

  reasons.sort((a, b) => b.weight - a.weight);
  const uniqueReasons = [...new Set(reasons.map((reason) => reason.text))].slice(0, 3);
  return { score, reasons: uniqueReasons };
}

function rankFilms() {
  const windowDates = getWindowDates(answers.when);
  let slots = getUpcomingSlots().filter((slot) => windowDates.has(slot.date));

  // Prefer nearby theatres, widening the radius until something's playing.
  if (answers.location) {
    for (const radius of NEARBY_RADII_MILES) {
      const nearby = slots.filter((slot) => (getTheatreDistance(slot.theatreId) ?? Infinity) <= radius);
      if (nearby.length) {
        slots = nearby;
        break;
      }
    }
  }

  const slotsByFilm = new Map();
  slots.forEach((slot) => {
    if (!slotsByFilm.has(slot.filmId)) slotsByFilm.set(slot.filmId, []);
    slotsByFilm.get(slot.filmId).push(slot);
  });

  const profile = buildTasteProfile();
  const results = [];
  slotsByFilm.forEach((filmSlots, filmId) => {
    if (answers.ratings.has(filmId) && answers.ratings.get(filmId) !== "unseen") return;
    const film = data.films.get(filmId);
    const distances = filmSlots.map((slot) => getTheatreDistance(slot.theatreId)).filter((d) => d !== null);
    const nearestMiles = distances.length ? Math.min(...distances) : null;
    const { score, reasons } = scoreFilm(film, profile, nearestMiles);
    results.push({ film, slots: filmSlots, score, reasons });
  });
  return results.sort((a, b) => b.score - a.score);
}

// ---- Rendering ----

function renderProgress() {
  // Hidden on the intro (along with the wordmark); all lit on the result.
  const active = stepIndex >= 0;
  topBar.hidden = !active;
  progress.hidden = !active;
  if (!active) return;
  progress.innerHTML = steps.map((_, index) => {
    const state = index < stepIndex ? "done" : index === stepIndex ? "current" : "";
    return `<li class="bulb ${state}"><span class="visually-hidden">Question ${index + 1}${index === stepIndex ? " (current)" : ""}</span></li>`;
  }).join("");
}

function show(html, { focus = true } = {}) {
  screen.innerHTML = html;
  renderProgress();
  window.scrollTo({ top: 0 });
  if (focus) screen.querySelector("h1")?.focus({ preventScroll: true });
}

function questionShell({ title, hint = "", body, nextLabel = "", nextDisabled = false, showNext = true }) {
  nextLabel ||= stepIndex === steps.length - 1 ? "Pick my film" : "Next";
  return `
    <section class="question">
      <h1 tabindex="-1">${title}</h1>
      ${hint ? `<p class="hint">${hint}</p>` : ""}
      ${body}
    </section>
    <nav class="actions">
      ${stepIndex > 0 ? `<button type="button" class="ghost" data-action="back">Back</button>` : ""}
      ${showNext ? `<button type="button" class="primary" data-action="next" ${nextDisabled ? "disabled" : ""}>${nextLabel}</button>` : ""}
    </nav>`;
}

function optionList(name, options, selected) {
  return `<div class="options" role="radiogroup">
    ${options
      .map(
        (option) => `
      <button type="button" class="option" role="radio" aria-checked="${option.key === selected}" data-${name}="${escapeHtml(option.key)}">
        <span class="lamp" aria-hidden="true"></span>${escapeHtml(option.label)}
      </button>`
      )
      .join("")}
  </div>`;
}

function renderIntro() {
  stepIndex = -1;
  show(
    `<section class="intro">
      <div class="keep-calm">
        <picture>
          <source srcset="../assets/brand/TMP%20logo%20dark.png" media="(prefers-color-scheme: light)" />
          <img class="crest" src="../assets/brand/TMP%20logo%20light.png" alt="" width="3300" height="3300" />
        </picture>
        <h1 tabindex="-1"><span>Go</span> <span>see</span> <span class="small-word">a</span> <span>movie</span></h1>
      </div>
      <p class="lede">Answer six quick questions, or just two if you're feeling lucky, and The Maine Playweek will pick one film playing at a Maine theatre this week, with showtimes.</p>
      <p class="status" id="load-status">Loading this week's showtimes…</p>
    </section>
    <nav class="actions">
      <button type="button" class="ghost lucky" data-action="start" data-mode="lucky" disabled>I'm Feeling Lucky</button>
      <button type="button" class="primary" data-action="start" disabled>Start</button>
    </nav>`
  );
  data.ready
    .then(() => {
      const count = new Set(getUpcomingSlots().map((slot) => slot.filmId)).size;
      document.getElementById("load-status").textContent = `${count} films are playing in Maine over the coming days.`;
      screen.querySelectorAll('[data-action="start"]').forEach((button) => (button.disabled = false));
    })
    .catch((error) => {
      console.error(error);
      document.getElementById("load-status").innerHTML =
        `Showtimes didn't load. Check your connection, then <button type="button" class="inline" data-action="reload">reload</button>.`;
    });
}

function getTheatreCities() {
  const cities = new Map();
  data.theatres.forEach((theatre) => {
    if (!theatre.city || !Number.isFinite(theatre.latitude) || !Number.isFinite(theatre.longitude)) return;
    if (!cities.has(theatre.city)) cities.set(theatre.city, { lat: theatre.latitude, lon: theatre.longitude });
  });
  return [...cities.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderWhere() {
  const location = answers.location;
  const cityOptions = getTheatreCities()
    .map(([city]) => `<option value="${escapeHtml(city)}" ${location?.label === city ? "selected" : ""}>${escapeHtml(city)}</option>`)
    .join("");
  const anywhereChosen = answers.location === null && answers.where === "anywhere";
  show(
    questionShell({
      title: "Where are you?",
      hint: "We'll look at theatres near you first.",
      body: `
        <div class="options">
          <button type="button" class="option" data-action="locate" aria-pressed="${location?.label === "your location"}">
            <span class="lamp" aria-hidden="true"></span>Use my location
          </button>
          <label class="option select-option ${location && location.label !== "your location" ? "is-on" : ""}">
            <span class="lamp" aria-hidden="true"></span>
            <span class="visually-hidden">Choose a town</span>
            <select data-action="city">
              <option value="">Near a town…</option>
              ${cityOptions}
            </select>
          </label>
          <button type="button" class="option" data-action="anywhere" aria-pressed="${anywhereChosen}">
            <span class="lamp" aria-hidden="true"></span>Anywhere in Maine
          </button>
        </div>
        <p class="status" id="locate-status" role="status"></p>`,
      nextDisabled: !answers.where,
    })
  );
}

function renderWhen() {
  show(
    questionShell({
      title: "When can you go?",
      body: optionList("when", WHEN_OPTIONS, answers.when),
      nextDisabled: !answers.when,
    })
  );
}

function renderGenres() {
  const counts = new Map();
  data.films.forEach((film) => film.genres.forEach((genre) => counts.set(genre, (counts.get(genre) || 0) + 1)));
  const genres = [...counts.entries()]
    .filter(([genre]) => !HIDDEN_GENRES.has(genre))
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);
  show(
    questionShell({
      title: "What do you usually like?",
      hint: "Pick as many as you want, or none.",
      body: `<div class="chips">
        ${genres
          .map(
            (genre) =>
              `<button type="button" class="chip" aria-pressed="${answers.genres.has(genre)}" data-genre="${escapeHtml(genre)}">${escapeHtml(genre)}</button>`
          )
          .join("")}
      </div>`,
      nextLabel: answers.genres.size ? "Next" : "Skip",
    })
  );
}

function renderMood() {
  show(
    questionShell({
      title: "What are you in the mood for?",
      body: optionList("mood", MOODS, answers.mood),
      nextDisabled: !answers.mood,
    })
  );
}

function pickSeenCards() {
  const pool = [...data.films.values()].filter((film) => film.posterUrl && film.voteCount >= RECOGNIZABLE_VOTE_COUNT);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Spread the cards across genres so one answer doesn't dominate.
  const picked = [];
  const usedLeadGenres = new Set();
  pool.forEach((film) => {
    if (picked.length >= SEEN_CARD_COUNT) return;
    const lead = film.genres[0] || "";
    if (usedLeadGenres.has(lead)) return;
    usedLeadGenres.add(lead);
    picked.push(film);
  });
  pool.forEach((film) => {
    if (picked.length < SEEN_CARD_COUNT && !picked.includes(film)) picked.push(film);
  });
  return picked;
}

function renderSeen() {
  if (!seenCards.length) seenCards = pickSeenCards();
  const film = seenCards[seenIndex];
  if (!film) {
    goTo(stepIndex + 1);
    return;
  }
  const rating = answers.ratings.get(film.id) || "";
  const choice = (key, label) =>
    `<button type="button" class="verdict" aria-pressed="${rating === key}" data-rating="${key}">${label}</button>`;
  show(
    questionShell({
      title: "Have you seen it?",
      hint: `${seenIndex + 1} of ${seenCards.length}`,
      body: `
        <figure class="seen-card">
          <img src="${escapeHtml(film.posterUrl)}" alt="" width="342" height="513" />
          <figcaption>${escapeHtml(film.title)}${film.year ? ` <span>(${film.year})</span>` : ""}</figcaption>
        </figure>
        <div class="verdicts">
          ${choice("loved", "Loved it")}
          ${choice("nope", "Not for me")}
          ${choice("unseen", "Haven't seen it")}
        </div>`,
      showNext: false,
    }),
    { focus: seenIndex === 0 }
  );
  // Testers took these posters for films playing now, so explain them once per quiz.
  if (!seenExplained) {
    seenExplained = true;
    seenExplainer.showModal();
  }
}

function renderEra() {
  show(
    questionShell({
      title: "New or old?",
      body: optionList("era", ERA_OPTIONS, answers.era),
      nextLabel: "Pick my film",
      nextDisabled: !answers.era,
    })
  );
}

function formatRuntime(minutes) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

function renderShowtimes(slots, filmId) {
  const byTheatre = new Map();
  slots.forEach((slot) => {
    if (!byTheatre.has(slot.theatreId)) byTheatre.set(slot.theatreId, []);
    byTheatre.get(slot.theatreId).push(slot);
  });
  const theatres = [...byTheatre.entries()]
    .map(([theatreId, theatreSlots]) => ({ theatre: data.theatres.get(theatreId), miles: getTheatreDistance(theatreId), slots: theatreSlots }))
    .sort((a, b) => (a.miles ?? 0) - (b.miles ?? 0) || a.slots[0].at - b.slots[0].at)
    .slice(0, 3);

  return theatres
    .map(({ theatre, miles, slots: theatreSlots }) => {
      const byDate = new Map();
      theatreSlots
        .sort((a, b) => a.at - b.at)
        .forEach((slot) => {
          if (!byDate.has(slot.date)) byDate.set(slot.date, []);
          byDate.get(slot.date).push(slot);
        });
      const ticketUrl = normalizeOutboundUrl(data.ticketLinks.get(`${theatre.id}:${filmId}`) || data.films.get(filmId).ticketLink);
      const distance = miles === null ? "" : miles < 1 ? ", under a mile away" : `, ${Math.round(miles)} mi away`;
      return `
        <article class="theatre">
          <h3>${escapeHtml(theatre.name)}</h3>
          <p class="where">${escapeHtml(theatre.city)}${distance}</p>
          ${[...byDate.entries()]
            .slice(0, 3)
            .map(
              ([date, dateSlots]) => `
            <div class="day">
              <span class="day-name">${escapeHtml(formatDisplayDate(date))}</span>
              <span class="times">${dateSlots
                .map((slot) => `<span class="time${slot.premium ? " premium" : ""}">${slot.premium ? "Premium " : ""}${escapeHtml(slot.time)}</span>`)
                .join("")}</span>
            </div>`
            )
            .join("")}
          ${ticketUrl ? `<a class="tickets" href="${escapeHtml(ticketUrl)}" target="_blank" rel="noopener">Get tickets</a>` : ""}
        </article>`;
    })
    .join("");
}

function renderResult() {
  stepIndex = steps.length;
  const pick = ranked[pickIndex];
  if (!pick) {
    show(`
      <section class="empty">
        <h1 tabindex="-1">Nothing's playing then</h1>
        <p class="lede">We couldn't find showtimes that match when you can go. Try a wider window.</p>
      </section>
      <nav class="actions">
        <button type="button" class="ghost" data-action="restart">Start over</button>
        <button type="button" class="primary" data-action="widen">Look at the whole week</button>
      </nav>`);
    return;
  }
  const { film, slots, reasons } = pick;
  const facts = [
    film.director ? `Directed by ${escapeHtml(film.director)}` : "",
    formatRuntime(film.runtime),
    film.certification ? `Rated ${escapeHtml(film.certification)}` : "",
  ].filter(Boolean);
  const runnersUp = ranked
    .map((entry, index) => ({ entry, index }))
    .filter(({ index }) => index !== pickIndex)
    .slice(0, 2);
  const filmPage = `../films/${buildFilmSlug(film.title, film.year)}/`;

  show(`
    <section class="result">
      <div class="marquee">
        <p class="marquee-kicker">You Should See</p>
        <h1 tabindex="-1">${escapeHtml(film.title)}</h1>
        ${film.year ? `<p class="marquee-year">${film.year}</p>` : ""}
      </div>
      <div class="pick-body">
        ${film.posterUrl ? `<img class="poster" src="${escapeHtml(film.posterUrl)}" alt="Poster for ${escapeHtml(film.title)}" width="342" height="513" />` : ""}
        <div class="pick-text">
          ${facts.length ? `<p class="facts">${facts.join(", ")}</p>` : ""}
          ${reasons.length ? `<ul class="reasons">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
        </div>
      </div>
      ${film.synopsis ? `<p class="synopsis">${escapeHtml(film.synopsis)}</p>` : ""}
      ${
        film.articleUrl
          ? `<a class="article" href="${escapeHtml(film.articleUrl)}" target="_blank" rel="noopener">
        <img src="../assets/brand/substack.png" alt="" width="40" height="40" />
        <span>We wrote about ${escapeHtml(film.title)}. Read it on The Maine Playweek Substack.</span>
      </a>`
          : ""
      }
      <h2>Where and when</h2>
      ${renderShowtimes(slots, film.id)}
      <a class="film-page" href="${escapeHtml(filmPage)}">All showtimes for ${escapeHtml(film.title)}</a>
      ${
        runnersUp.length
          ? `<h2>Also worth a look</h2>
        <ul class="runners">
          ${runnersUp
            .map(
              ({ entry, index }) => `
            <li><button type="button" data-pick="${index}">
              ${entry.film.posterUrl ? `<img src="${escapeHtml(entry.film.posterUrl)}" alt="" width="342" height="513" />` : `<span class="no-poster"></span>`}
              <span>${escapeHtml(entry.film.title)}${entry.film.year ? ` (${entry.film.year})` : ""}</span>
            </button></li>`
            )
            .join("")}
        </ul>`
          : ""
      }
      <footer class="more">
        See every showtime in Maine at <a href="../">The Maine Playweek</a>, read our writing on
        <a href="${SUBSTACK_URL}" target="_blank" rel="noopener">Substack</a>, and follow along on
        <a href="${INSTAGRAM_URL}" target="_blank" rel="noopener">Instagram</a>.
      </footer>
    </section>
    <nav class="actions">
      <button type="button" class="ghost" data-action="restart">Start over</button>
      ${ranked.length > 1 ? `<button type="button" class="primary" data-action="another">Show me another</button>` : ""}
    </nav>`);
  screen.querySelector(".marquee")?.classList.add("is-lit");
}

const RENDERERS = { where: renderWhere, when: renderWhen, genres: renderGenres, mood: renderMood, seen: renderSeen, era: renderEra };

function goTo(index) {
  if (index < 0) {
    renderIntro();
    return;
  }
  if (index >= steps.length) {
    ranked = rankFilms();
    pickIndex = 0;
    renderResult();
    return;
  }
  stepIndex = index;
  RENDERERS[steps[index]]();
}

// ---- Events ----

function setLocation(location, where) {
  answers.location = location;
  answers.where = where;
  renderWhere();
}

screen.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target || target.disabled) return;
  const { action } = target.dataset;

  if (action === "start") {
    steps = target.dataset.mode === "lucky" ? LUCKY_STEPS : FULL_STEPS;
    resetAnswers();
    seenCards = [];
    seenIndex = 0;
    seenExplained = false;
    goTo(0);
  } else if (action === "reload") {
    window.location.reload();
  } else if (action === "next") {
    goTo(stepIndex + 1);
  } else if (action === "back") {
    if (steps[stepIndex] === "seen" && seenIndex > 0) {
      seenIndex -= 1;
      renderSeen();
    } else {
      if (steps[stepIndex - 1] === "seen") seenIndex = Math.max(0, seenCards.length - 1);
      goTo(stepIndex - 1);
    }
  } else if (action === "anywhere") {
    setLocation(null, "anywhere");
  } else if (action === "locate") {
    const status = document.getElementById("locate-status");
    if (!navigator.geolocation) {
      status.textContent = "This browser can't share your location. Choose a town instead.";
      return;
    }
    status.textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition(
      (position) =>
        setLocation({ lat: position.coords.latitude, lon: position.coords.longitude, label: "your location" }, "location"),
      () => {
        status.textContent = "Location is turned off for this site. Choose a town instead.";
      },
      { timeout: 10000, maximumAge: 600000 }
    );
  } else if (action === "restart") {
    renderIntro();
  } else if (action === "widen") {
    answers.when = "week";
    goTo(steps.length);
  } else if (action === "another") {
    pickIndex = (pickIndex + 1) % ranked.length;
    renderResult();
  } else if (target.dataset.pick) {
    pickIndex = Number(target.dataset.pick);
    renderResult();
  } else if (target.dataset.when) {
    answers.when = target.dataset.when;
    renderWhen();
  } else if (target.dataset.mood) {
    answers.mood = target.dataset.mood;
    renderMood();
  } else if (target.dataset.era) {
    answers.era = target.dataset.era;
    renderEra();
  } else if (target.dataset.genre) {
    const genre = target.dataset.genre;
    if (answers.genres.has(genre)) answers.genres.delete(genre);
    else answers.genres.add(genre);
    target.setAttribute("aria-pressed", String(answers.genres.has(genre)));
    screen.querySelector('[data-action="next"]').textContent = answers.genres.size ? "Next" : "Skip";
  } else if (target.dataset.rating) {
    answers.ratings.set(seenCards[seenIndex].id, target.dataset.rating);
    seenIndex += 1;
    if (seenIndex < seenCards.length) renderSeen();
    else goTo(stepIndex + 1);
  }
});

screen.addEventListener("change", (event) => {
  if (event.target.dataset.action !== "city") return;
  const city = event.target.value;
  const match = getTheatreCities().find(([name]) => name === city);
  if (match) setLocation({ ...match[1], label: city }, "city");
  else setLocation(null, "");
});

resetAnswers();
data.ready = loadData();
renderIntro();
