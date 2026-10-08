// Experimental mobile-first "playing tonight" deck. Reads the live Supabase data (read-only)
// and shows one big card per film playing today. Swipe right (interested) or left (not
// interested), scroll down for details and showtimes, and get your list at the end. The list
// only lasts for the visit.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  escapeHtml,
  buildFilmSlug,
  normalizeOutboundUrl,
  toFiniteNumber,
  getShowDateTime,
  getFilmSortBreakdown,
} from "../js/shared.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.getElementById("app");
const placeButton = document.getElementById("place-button");
const placeLabel = document.getElementById("place-label");
const placeSheet = document.getElementById("place-sheet");
const placeStatus = document.getElementById("place-status");
const townSelect = document.getElementById("town-select");
const filmSheet = document.getElementById("film-sheet");
const introSheet = document.getElementById("intro-sheet");
const filmSheetBody = document.getElementById("film-sheet-body");

const MIN_LEAD_MINUTES = 10;
const SWIPE_THRESHOLD = 0.25; // share of the card width a drag must travel to count
const DRAG_START_PX = 8;
const PLACE_STORAGE_KEY = "playweek-swipe-place";
const INTRO_STORAGE_KEY = "playweek-swipe-intro-seen";
const SUBSTACK_URL = "https://themaineplayweek.substack.com";
const INSTAGRAM_URL = "https://www.instagram.com/themaineplayweek/";

const data = { films: new Map(), theatres: new Map(), ticketLinks: new Map(), showings: [] };
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let place = readSavedPlace();
let deck = [];
let deckDay = "today";
let index = 0;
// Film id -> "yes" (interested) or "no", in the order they were swiped.
const choices = new Map();

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

function addDays(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

async function loadData() {
  const [films, theatres, theatreFilms, showings] = await Promise.all([
    fetchAll(
      "films",
      "id,title,year,ticket_link,staff_favorite,staff_favorite_by,featured_on_playweek,featured_on_playweek_url,synopsis,tmdb_json",
      (q) => q.order("id")
    ),
    fetchAll("theatres", "id,name,city,latitude,longitude", (q) => q.order("id")),
    fetchAll("theatre_films", "theatre_id,film_id,ticket_link", (q) => q.order("theatre_id").order("film_id")),
    fetchAll("showings", "theatre_id,film_id,show_date,times,premium_times", (q) => q.gte("show_date", addDays(0)).order("id")),
  ]);

  films.forEach((row) => {
    const tmdb = row.tmdb_json && typeof row.tmdb_json === "object" ? row.tmdb_json : {};
    const posterUrl = String(tmdb.posterUrl || "").trim();
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
      // The stored poster is TMDb's w342 size; a full-screen card needs the larger one.
      posterUrl,
      cardPosterUrl: posterUrl.replace("/t/p/w342/", "/t/p/w780/"),
    });
  });
  theatres.forEach((row) => data.theatres.set(row.id, row));
  theatreFilms.forEach((row) => {
    if (row.ticket_link) data.ticketLinks.set(`${row.theatre_id}:${row.film_id}`, row.ticket_link);
  });
  data.showings = showings;
}

// Every upcoming showtime, flattened, with past times dropped. The data mixes "3:49pm"
// and "3:49 PM", so times are deduped on the parsed value; premium wins a tie.
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

function milesBetween(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

function getTheatreDistance(theatreId) {
  const theatre = data.theatres.get(theatreId);
  if (!place || !Number.isFinite(theatre?.latitude) || !Number.isFinite(theatre?.longitude)) return null;
  return milesBetween(place, { lat: theatre.latitude, lon: theatre.longitude });
}

// One card per film with showtimes left today (or tomorrow, once today's are over), in the
// main site's ranking order, nudged toward films playing closer to you.
function buildDeck() {
  const upcoming = getUpcomingSlots();
  const today = addDays(0);
  const tomorrow = addDays(1);
  deckDay = upcoming.some((slot) => slot.date === today) ? "today" : "tomorrow";
  const day = deckDay === "today" ? today : tomorrow;

  const allByFilm = groupBy(upcoming, (slot) => slot.filmId);
  const dayByFilm = groupBy(
    upcoming.filter((slot) => slot.date === day),
    (slot) => slot.filmId
  );

  deck = [...dayByFilm.entries()]
    .map(([filmId, slots]) => {
      const film = data.films.get(filmId);
      const allSlots = allByFilm.get(filmId) || [];
      const { finalScore } = getFilmSortBreakdown({
        popularity: film.popularity,
        voteAverage: film.voteAverage,
        voteCount: film.voteCount,
        releaseDate: film.releaseDate,
        staffFavorite: film.staffFavorite,
        upcomingTimes: allSlots.length,
        theatreCount: new Set(allSlots.map((slot) => slot.theatreId)).size,
      });
      const distances = slots.map((slot) => getTheatreDistance(slot.theatreId)).filter((miles) => miles !== null);
      const nearestMiles = distances.length ? Math.min(...distances) : null;
      const score = finalScore - (nearestMiles === null ? 0 : Math.min(0.6, nearestMiles / 150));
      slots.sort((a, b) => a.at - b.at);
      return { film, slots, nearestMiles, score };
    })
    .sort((a, b) => b.score - a.score);
  index = 0;
  choices.clear();
}

function groupBy(items, keyOf) {
  const groups = new Map();
  items.forEach((item) => {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return groups;
}

// ---- Place ----

function readSavedPlace() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLACE_STORAGE_KEY) || "null");
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon) && saved.label) return saved;
  } catch {
    // Storage can be blocked; fall back to all of Maine.
  }
  return null;
}

function setPlace(next) {
  place = next;
  try {
    if (next) localStorage.setItem(PLACE_STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(PLACE_STORAGE_KEY);
  } catch {
    // Not remembered between visits, which is fine.
  }
  placeLabel.textContent = next ? (next.label === "your location" ? "Near you" : `Near ${next.label}`) : "All of Maine";
  if (data.films.size) {
    buildDeck();
    render();
  }
}

function fillTownSelect() {
  const towns = new Map();
  data.theatres.forEach((theatre) => {
    if (!theatre.city || !Number.isFinite(theatre.latitude) || !Number.isFinite(theatre.longitude)) return;
    if (!towns.has(theatre.city)) towns.set(theatre.city, { lat: theatre.latitude, lon: theatre.longitude });
  });
  [...towns.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([town, coords]) => {
      const option = new Option(town, town);
      option.dataset.lat = coords.lat;
      option.dataset.lon = coords.lon;
      townSelect.add(option);
    });
}

// ---- Rendering ----

function formatRuntime(minutes) {
  if (!minutes) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

function formatMiles(miles) {
  if (miles === null) return "";
  return miles < 1 ? "Under a mile away" : `${Math.round(miles)} mi away`;
}

// Where and when to lead with: the nearest theatre's next showing when a place is set,
// otherwise the earliest showing anywhere.
function getLead(entry) {
  const { slots, nearestMiles } = entry;
  const theatreCount = new Set(slots.map((slot) => slot.theatreId)).size;
  const next =
    nearestMiles === null
      ? slots[0]
      : slots.find((slot) => getTheatreDistance(slot.theatreId) === nearestMiles) || slots[0];
  const others = theatreCount - 1;
  return {
    line: `${deckDay === "today" ? "Next at" : "Tomorrow at"} ${next.time}, ${data.theatres.get(next.theatreId).name}`,
    secondLine: [
      nearestMiles !== null ? formatMiles(nearestMiles) : "",
      others > 0 ? `${nearestMiles !== null ? "plus" : "Also at"} ${others} more ${others === 1 ? "theatre" : "theatres"}` : "",
    ]
      .filter(Boolean)
      .join(", "),
  };
}

// role: "is-top" (the swipeable card), "is-next" (the one underneath) or "is-static" (in the
// film sheet opened from your list).
function renderCard(entry, role) {
  const { film } = entry;
  const { line, secondLine } = getLead(entry);
  const titleTag = { "is-top": "h1", "is-static": "h2" }[role] || "p";
  const attributes = {
    "is-top": `tabindex="0" aria-roledescription="card" aria-label="${escapeHtml(film.title)}"`,
    "is-next": 'aria-hidden="true"',
  }[role] || "";
  return `
    <article class="card ${role}" ${attributes}>
      ${
        film.cardPosterUrl
          ? `<img class="card-poster" src="${escapeHtml(film.cardPosterUrl)}" alt="" draggable="false" />`
          : `<div class="card-poster no-poster" aria-hidden="true"></div>`
      }
      ${
        role === "is-top"
          ? `<span class="stamp stamp-yes" aria-hidden="true">Interested</span>
      <span class="stamp stamp-no" aria-hidden="true">Not for me</span>`
          : ""
      }
      <div class="card-info">
        ${film.staffFavorite ? `<p class="badge">Staff favourite</p>` : ""}
        <${titleTag} class="card-title">${escapeHtml(film.title)}${film.year ? ` <span class="card-year">${film.year}</span>` : ""}</${titleTag}>
        <p class="card-meta">${escapeHtml(line)}</p>
        ${secondLine ? `<p class="card-meta card-meta-soft">${escapeHtml(secondLine)}</p>` : ""}
      </div>
    </article>`;
}

function renderShowtimes(entry) {
  const byTheatre = groupBy(entry.slots, (slot) => slot.theatreId);
  return [...byTheatre.entries()]
    .map(([theatreId, slots]) => ({ theatre: data.theatres.get(theatreId), miles: getTheatreDistance(theatreId), slots }))
    .sort((a, b) => (a.miles ?? 0) - (b.miles ?? 0) || a.slots[0].at - b.slots[0].at)
    .map(({ theatre, miles, slots }) => {
      const ticketUrl = normalizeOutboundUrl(data.ticketLinks.get(`${theatre.id}:${entry.film.id}`) || entry.film.ticketLink);
      const distance = miles === null ? "" : `, ${formatMiles(miles).toLowerCase()}`;
      return `
        <article class="theatre">
          <h3>${escapeHtml(theatre.name)}</h3>
          <p class="theatre-where">${escapeHtml(theatre.city)}${distance}</p>
          <p class="times">${slots
            .map((slot) => `<span class="time${slot.premium ? " premium" : ""}">${slot.premium ? "Premium " : ""}${escapeHtml(slot.time)}</span>`)
            .join("")}</p>
          ${ticketUrl ? `<a class="tickets" href="${escapeHtml(ticketUrl)}" target="_blank" rel="noopener">Get tickets</a>` : ""}
        </article>`;
    })
    .join("");
}

function renderDetails(entry, { footer = true } = {}) {
  const { film } = entry;
  const facts = [
    film.director ? `Directed by ${escapeHtml(film.director)}` : "",
    formatRuntime(film.runtime),
    film.certification ? `Rated ${escapeHtml(film.certification)}` : "",
  ].filter(Boolean);
  const filmPage = `../films/${buildFilmSlug(film.title, film.year)}/`;
  return `
    <section class="details" aria-label="About ${escapeHtml(film.title)}">
      ${facts.length ? `<p class="facts">${facts.join(", ")}</p>` : ""}
      ${film.genres.length ? `<p class="genres">${film.genres.map((genre) => `<span>${escapeHtml(genre)}</span>`).join("")}</p>` : ""}
      ${film.synopsis ? `<p class="synopsis">${escapeHtml(film.synopsis)}</p>` : ""}
      ${film.stars.length ? `<p class="stars">With ${escapeHtml(film.stars.join(", "))}</p>` : ""}
      ${
        film.staffFavorite && film.staffFavoriteBy
          ? `<p class="staff-note">Picked as a staff favourite by ${escapeHtml(film.staffFavoriteBy)}.</p>`
          : ""
      }
      ${
        film.articleUrl
          ? `<a class="article" href="${escapeHtml(film.articleUrl)}" target="_blank" rel="noopener">
        <img src="../assets/brand/substack.png" alt="" width="40" height="40" />
        <span>We wrote about ${escapeHtml(film.title)}. Read it on The Maine Playweek Substack.</span>
      </a>`
          : ""
      }
      <h2>${deckDay === "today" ? "Showtimes today" : "Showtimes tomorrow"}</h2>
      ${renderShowtimes(entry)}
      <a class="film-page" href="${escapeHtml(filmPage)}">All showtimes for ${escapeHtml(film.title)}</a>
      ${footer ? renderFooter() : ""}
    </section>`;
}

function renderFooter() {
  return `
    <footer class="more">
      See every showtime in Maine at <a href="../">The Maine Playweek</a>, read our writing on
      <a href="${SUBSTACK_URL}" target="_blank" rel="noopener">Substack</a>, and follow along on
      <a href="${INSTAGRAM_URL}" target="_blank" rel="noopener">Instagram</a>.
    </footer>`;
}

function renderControls() {
  const atEnd = index >= deck.length;
  const undo = `<button type="button" class="round small" data-action="back" ${index === 0 ? "disabled" : ""}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a5 5 0 0 1 0 10h-3" /></svg>
        <span class="visually-hidden">Undo last choice</span>
      </button>`;
  // Not interested, undo, interested; only undo is left at the end of the deck.
  if (atEnd) return `<nav class="controls" aria-label="Cards">${undo}</nav>`;
  return `
    <nav class="controls" aria-label="Cards">
      <button type="button" class="round" data-action="no">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        <span class="visually-hidden">Not interested</span>
      </button>
      ${undo}
      <button type="button" class="round primary" data-action="yes">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
        <span class="visually-hidden">Interested</span>
      </button>
    </nav>`;
}

function getList() {
  return deck.filter((entry) => choices.get(entry.film.id) === "yes");
}

function renderEnd() {
  const list = getList();
  const dayWord = deckDay === "today" ? "today" : "tomorrow";
  const intro = list.length
    ? `<h1>Your list for ${dayWord}</h1>
        <p>You're interested in ${list.length} of the ${deck.length} films playing ${dayWord}. Tap one for showtimes and tickets.</p>
        <ul class="my-list">
          ${list
            .map((entry) => {
              const { line } = getLead(entry);
              return `<li>
            <button type="button" data-open="${entry.film.id}">
              ${
                entry.film.posterUrl
                  ? `<img src="${escapeHtml(entry.film.posterUrl)}" alt="" width="342" height="513" />`
                  : `<span class="no-poster thumb" aria-hidden="true"></span>`
              }
              <span class="list-text">
                <span class="list-title">${escapeHtml(entry.film.title)}</span>
                <span class="list-when">${escapeHtml(line)}</span>
              </span>
            </button>
          </li>`;
            })
            .join("")}
        </ul>
        <p class="temp-note">This list isn't saved. It clears when you reload or leave the page, so screenshot it if you want to keep it.</p>`
    : `<h1>Nothing caught your eye</h1>
        <p>You passed on all ${deck.length} films playing ${dayWord}. Start over, or see the whole week on the full site.</p>`;
  return `
      <section class="end">
        ${intro}
        <button type="button" class="button" data-action="restart">Start over</button>
        <a class="text-link" href="../">See all showtimes</a>
        ${renderFooter()}
      </section>
      ${renderControls()}`;
}

function render() {
  window.scrollTo({ top: 0 });
  if (!deck.length) {
    app.innerHTML = `
      <section class="end">
        <h1>Nothing's on the schedule</h1>
        <p>There are no showtimes left today or tomorrow${place ? " near here" : ""}. See what's coming up on the full site.</p>
        <a class="button" href="../">See all showtimes</a>
      </section>`;
    return;
  }
  if (index >= deck.length) {
    app.innerHTML = renderEnd();
    return;
  }
  const entry = deck[index];
  const nextEntry = deck[index + 1];
  app.innerHTML = `
    ${deckDay === "tomorrow" && index === 0 ? `<p class="day-note">Today's showings are over, so these are tomorrow's.</p>` : ""}
    <div class="deck">
      ${nextEntry ? renderCard(nextEntry, "is-next") : ""}
      ${renderCard(entry, "is-top")}
    </div>
    <p class="scroll-hint">
      <span class="count">${index + 1} of ${deck.length}${listCountText()}</span>
      Scroll for showtimes and tickets
    </p>
    ${renderDetails(entry)}
    ${renderControls()}`;
  attachSwipe(app.querySelector(".card.is-top"));
}

function listCountText() {
  const count = getList().length;
  return count ? `, ${count} on your list` : "";
}

// ---- Moving through the deck ----

// direction 1 = swiped right (interested), -1 = swiped left (not interested).
function decide(direction) {
  if (index >= deck.length) return;
  choices.set(deck[index].film.id, direction > 0 ? "yes" : "no");
  const card = app.querySelector(".card.is-top");
  if (!card || reduceMotion.matches) {
    index += 1;
    render();
    return;
  }
  flyOut(card, direction);
}

// Undo: bring the last card back from the side it left on and forget that choice.
function goBack() {
  if (index === 0) return;
  index -= 1;
  const filmId = deck[index].film.id;
  const side = choices.get(filmId) === "yes" ? "right" : "left";
  choices.delete(filmId);
  render();
  const card = app.querySelector(".card.is-top");
  if (card && !reduceMotion.matches) card.classList.add(`is-returning-${side}`);
}

function flyOut(card, direction) {
  card.style.setProperty(direction > 0 ? "--yes" : "--no", "1");
  const distance = window.innerWidth * 1.2 * direction;
  card.style.transition = "transform 260ms ease-in";
  card.style.transform = `translateX(${distance}px) rotate(${direction * 18}deg)`;
  app.querySelector(".card.is-next")?.classList.add("is-rising");
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    index += 1;
    render();
  };
  card.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, 400);
}

// Horizontal drags move the card; vertical drags are left to the browser so the page still
// scrolls (the card has touch-action: pan-y). A tap scrolls down to the details.
function attachSwipe(card) {
  if (!card) return;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dragging = false;
  let pointerId = null;
  const nextCard = app.querySelector(".card.is-next");

  const reset = () => {
    card.style.transition = "transform 200ms ease-out";
    card.style.transform = "";
    card.style.removeProperty("--yes");
    card.style.removeProperty("--no");
    if (nextCard) nextCard.style.transform = "";
    dragging = false;
    pointerId = null;
  };

  card.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    dragging = false;
    card.style.transition = "none";
  });

  card.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointerId) return;
    dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging) {
      if (Math.abs(dx) < DRAG_START_PX || Math.abs(dx) < Math.abs(dy)) return;
      dragging = true;
      try {
        card.setPointerCapture(pointerId);
      } catch {
        // Capture only keeps the drag going if the finger leaves the card; it's fine without.
      }
    }
    card.style.transform = `translateX(${dx}px) rotate(${dx * 0.05}deg)`;
    const progress = Math.min(1, Math.abs(dx) / (card.offsetWidth * SWIPE_THRESHOLD));
    card.style.setProperty("--yes", dx > 0 ? progress : 0);
    card.style.setProperty("--no", dx < 0 ? progress : 0);
    if (nextCard) nextCard.style.transform = `scale(${0.94 + 0.06 * progress})`;
  });

  card.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pointerId) return;
    if (!dragging) {
      pointerId = null;
      if (Math.abs(event.clientX - startX) < DRAG_START_PX && Math.abs(event.clientY - startY) < DRAG_START_PX) {
        app.querySelector(".details")?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth" });
      }
      return;
    }
    if (Math.abs(dx) > card.offsetWidth * SWIPE_THRESHOLD) {
      pointerId = null;
      decide(Math.sign(dx));
    } else {
      reset();
    }
  });

  card.addEventListener("pointercancel", reset);
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  const { action } = button.dataset;
  if (action === "yes") decide(1);
  else if (action === "no") decide(-1);
  else if (action === "back") goBack();
  else if (action === "restart") {
    index = 0;
    choices.clear();
    render();
  } else if (button.dataset.open) {
    openFilm(Number(button.dataset.open));
  }
});

document.addEventListener("keydown", (event) => {
  if (placeSheet.open || filmSheet.open || introSheet.open || event.target.closest?.("select, input, textarea")) return;
  if (event.key === "ArrowRight") decide(1);
  else if (event.key === "ArrowLeft") decide(-1);
  else if (event.key === "Backspace") goBack();
});

// ---- Film sheet (opened from your list) ----

function openFilm(filmId) {
  const entry = deck.find((candidate) => candidate.film.id === filmId);
  if (!entry) return;
  filmSheet.setAttribute("aria-label", entry.film.title);
  filmSheetBody.innerHTML = `
    <div class="sheet-card">${renderCard(entry, "is-static")}</div>
    ${renderDetails(entry, { footer: false })}
    <p class="temp-note">On your list for this visit only. It clears when you reload or leave the page.</p>`;
  filmSheet.showModal();
  filmSheetBody.scrollTop = 0;
}

filmSheet.addEventListener("click", (event) => {
  if (event.target === filmSheet || event.target.closest("[data-action='close-film']")) filmSheet.close();
});

// ---- Place sheet ----

placeButton.addEventListener("click", () => {
  placeStatus.textContent = "";
  townSelect.value = place && place.label !== "your location" ? place.label : "";
  placeSheet.showModal();
});

placeSheet.addEventListener("click", (event) => {
  // A click on the backdrop closes the sheet.
  if (event.target === placeSheet) {
    placeSheet.close();
    return;
  }
  const option = event.target.closest("[data-place]");
  if (!option) return;
  if (option.dataset.place === "anywhere") {
    setPlace(null);
    placeSheet.close();
  } else if (option.dataset.place === "locate") {
    if (!navigator.geolocation) {
      placeStatus.textContent = "This browser can't share your location. Choose a town instead.";
      return;
    }
    placeStatus.textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPlace({ lat: position.coords.latitude, lon: position.coords.longitude, label: "your location" });
        placeSheet.close();
      },
      () => {
        placeStatus.textContent = "Location is turned off for this site. Choose a town instead.";
      },
      { timeout: 10000, maximumAge: 600000 }
    );
  }
});

townSelect.addEventListener("change", () => {
  const option = townSelect.selectedOptions[0];
  if (!option?.value) return;
  setPlace({ lat: Number(option.dataset.lat), lon: Number(option.dataset.lon), label: option.value });
  placeSheet.close();
});

// ---- Intro (first visit only) ----

function showIntroOnce() {
  try {
    if (localStorage.getItem(INTRO_STORAGE_KEY)) return;
  } catch {
    // Storage blocked: show it, it just won't be remembered.
  }
  introSheet.showModal();
}

// Saved as soon as it's dismissed (Start swiping or Escape) rather than on "close", which
// browsers may deliver late.
function markIntroSeen() {
  try {
    localStorage.setItem(INTRO_STORAGE_KEY, "1");
  } catch {
    // Not remembered between visits, which is fine.
  }
}

introSheet.querySelector("form").addEventListener("submit", markIntroSeen);
introSheet.addEventListener("cancel", markIntroSeen);

// ---- Start ----

showIntroOnce();
setPlace(place);
loadData()
  .then(() => {
    fillTownSelect();
    buildDeck();
    render();
  })
  .catch((error) => {
    console.error(error);
    app.innerHTML = `
      <section class="end">
        <h1>Showtimes didn't load</h1>
        <p>Check your connection, then reload the page.</p>
        <button type="button" class="button" onclick="location.reload()">Reload</button>
      </section>`;
  });
