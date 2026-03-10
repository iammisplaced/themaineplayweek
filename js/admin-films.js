import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://rjfsjoratsfqcyyjseqm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqZnNqb3JhdHNmcWN5eWpzZXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mzc5MDgsImV4cCI6MjA4ODIxMzkwOH0.dmcQ_ffwmm4JIKTjSUNNYLGQ9w_v1mR6VRMZimVnLNg";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const QUERY_TIMEOUT_MS = 30000;
const QUERY_PAGE_SIZE = 1000;

const state = {
  query: "",
  films: [],
  userEmail: "",
  isAuthed: false,
  staffFavoriteSupported: true,
  featuredOnPlayweekSupported: true,
  favoriteSaveBusy: new Set(),
  featuredSaveBusy: new Set(),
};

const elements = {
  authGate: document.getElementById("authGate"),
  catalogApp: document.getElementById("catalogApp"),
  emailInput: document.getElementById("emailInput"),
  sendMagicLink: document.getElementById("sendMagicLink"),
  logout: document.getElementById("logout"),
  refreshCatalog: document.getElementById("refreshCatalog"),
  filmSearch: document.getElementById("filmSearch"),
  summary: document.getElementById("summary"),
  catalogList: document.getElementById("catalogList"),
  authStatus: document.getElementById("authStatus"),
  status: document.getElementById("status"),
};

await init();

async function init() {
  bindEvents();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.userEmail = session?.user?.email || "";
    updateAuthUI(Boolean(session?.user));
    await loadCatalog();
  });

  const { data } = await supabase.auth.getSession();
  const authed = Boolean(data.session?.user);
  state.userEmail = data.session?.user?.email || "";
  updateAuthUI(authed);
  await loadCatalog();
}

function bindEvents() {
  elements.sendMagicLink.addEventListener("click", async () => {
    const email = elements.emailInput.value.trim();
    if (!email) {
      setStatus("Enter your email first.");
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) {
      setStatus(`Magic link failed: ${error.message}`);
      return;
    }
    setStatus("Magic link sent. Check your email.");
  });

  elements.logout.addEventListener("click", async () => {
    await supabase.auth.signOut();
    setStatus("Logged out.");
  });

  elements.refreshCatalog.addEventListener("click", async () => {
    await loadCatalog();
  });

  elements.filmSearch.addEventListener("input", () => {
    state.query = normalize(elements.filmSearch.value);
    renderCatalog();
  });

  elements.catalogList.addEventListener("change", (event) => {
    const toggle = event.target.closest('input[data-role="favorite-toggle"]');
    if (toggle) {
      const row = toggle.closest("tr[data-film-id]");
      const byInput = row?.querySelector('input[data-role="favorite-by"]');
      if (!byInput) return;
      byInput.disabled = !toggle.checked || state.favoriteSaveBusy.has(String(row.dataset.filmId));
      if (!toggle.checked) byInput.value = "";
      return;
    }

    const featuredToggle = event.target.closest('input[data-role="featured-toggle"]');
    if (!featuredToggle) return;
    const row = featuredToggle.closest("tr[data-film-id]");
    const urlInput = row?.querySelector('input[data-role="featured-url"]');
    if (!urlInput) return;
    urlInput.disabled = !featuredToggle.checked || state.featuredSaveBusy.has(String(row.dataset.filmId));
  });

  elements.catalogList.addEventListener("click", async (event) => {
    const saveButton = event.target.closest('button[data-action="save-favorite"]');
    if (saveButton) {
      const row = saveButton.closest("tr[data-film-id]");
      if (!row) return;
      await saveStaffFavorite(row);
      return;
    }

    const saveFeaturedButton = event.target.closest('button[data-action="save-featured"]');
    if (!saveFeaturedButton) return;
    const row = saveFeaturedButton.closest("tr[data-film-id]");
    if (!row) return;
    await saveFeaturedOnPlayweek(row);
  });
}

function updateAuthUI(authed) {
  state.isAuthed = authed;
  elements.authGate.classList.toggle("hidden", authed);
  elements.catalogApp.classList.remove("hidden");
  elements.authStatus.textContent = authed
    ? `Signed in as ${state.userEmail}`
    : "Viewing read-only catalog (not signed in).";
  elements.logout.disabled = !authed;
}

async function loadCatalog() {
  try {
    setStatus("Loading film catalog...");

    setStatus("Loading films table...");
    let warnings = [];
    state.staffFavoriteSupported = true;
    state.featuredOnPlayweekSupported = true;
    let filmsResult = { data: null, error: null };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      filmsResult = await runWithTimeout(
        fetchAllRows(() => supabase.from("films").select(buildFilmSelectColumns())),
        "films"
      );
      if (!filmsResult.error) break;

      let changed = false;
      if (state.staffFavoriteSupported && isStaffFavoriteSchemaMissing(filmsResult.error)) {
        state.staffFavoriteSupported = false;
        warnings.push("films: staff favorite fields missing; run latest supabase/schema.sql");
        changed = true;
      }
      if (state.featuredOnPlayweekSupported && isFeaturedOnPlayweekSchemaMissing(filmsResult.error)) {
        state.featuredOnPlayweekSupported = false;
        warnings.push("films: featured-on-playweek fields missing; run latest supabase/schema.sql");
        changed = true;
      }
      if (!changed) break;
    }
    if (filmsResult.error) {
      setStatus(`Load failed (films): ${filmsResult.error.message}`);
      return;
    }

    setStatus("Loading related tables...");
    const [theatresResult, theatreFilmsResult, showingsResult] = await Promise.all([
      runWithTimeout(fetchAllRows(() => supabase.from("theatres").select("id,name,city")), "theatres"),
      runWithTimeout(
        fetchAllRows(() => supabase.from("theatre_films").select("theatre_id,film_id,ticket_link")),
        "theatre_films"
      ),
      runWithTimeout(
        fetchAllRows(() => supabase.from("showings").select("theatre_id,film_id,show_date,times")),
        "showings"
      ),
    ]);
    if (theatresResult.error) warnings.push(`theatres: ${theatresResult.error.message}`);
    if (theatreFilmsResult.error) warnings.push(`theatre_films: ${theatreFilmsResult.error.message}`);
    if (showingsResult.error) warnings.push(`showings: ${showingsResult.error.message}`);

    state.films = buildCatalogRows(
      filmsResult.data || [],
      theatresResult.data || [],
      theatreFilmsResult.data || [],
      showingsResult.data || []
    );

    renderSummary();
    renderCatalog();
    if (warnings.length) {
      setStatus(`Loaded ${state.films.length} films with warnings: ${warnings.join(" | ")}`);
    } else {
      setStatus(`Loaded ${state.films.length} films.`);
    }
  } catch (error) {
    setStatus(`Load error: ${error.message}`);
  }
}

async function fetchAllRows(queryBuilderFactory, pageSize = QUERY_PAGE_SIZE) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await queryBuilderFactory().range(from, to);
    if (error) return { data: null, error };
    const chunk = Array.isArray(data) ? data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return { data: rows, error: null };
}

function runWithTimeout(promise, label, timeoutMs = QUERY_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} query timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
    }),
  ]);
}

function isStaffFavoriteSchemaMissing(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("staff_favorite") || message.includes("staff_favorite_by");
}

function isFeaturedOnPlayweekSchemaMissing(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("featured_on_playweek") || message.includes("featured_on_playweek_url");
}

function buildFilmSelectColumns() {
  const columns = ["id", "title", "year", "tmdb_id", "ticket_link", "tmdb_json"];
  if (state.staffFavoriteSupported) {
    columns.push("staff_favorite", "staff_favorite_by");
  }
  if (state.featuredOnPlayweekSupported) {
    columns.push("featured_on_playweek", "featured_on_playweek_url");
  }
  return columns.join(",");
}

function buildCatalogRows(films, theatres, theatreFilms, showings) {
  const theatreById = new Map(theatres.map((row) => [String(row.id), row]));
  const theatreFilmsByFilmId = new Map();
  const showingsByFilmId = new Map();
  const theatreIdsByFilmIdFromShowings = new Map();

  theatreFilms.forEach((row) => {
    const key = String(row.film_id);
    if (!theatreFilmsByFilmId.has(key)) theatreFilmsByFilmId.set(key, []);
    theatreFilmsByFilmId.get(key).push(row);
  });

  showings.forEach((row) => {
    const key = String(row.film_id);
    if (!showingsByFilmId.has(key)) showingsByFilmId.set(key, []);
    showingsByFilmId.get(key).push(row);

    if (!theatreIdsByFilmIdFromShowings.has(key)) {
      theatreIdsByFilmIdFromShowings.set(key, new Set());
    }
    theatreIdsByFilmIdFromShowings.get(key).add(String(row.theatre_id));
  });

  const rows = films.map((film) => {
    const linkRows = theatreFilmsByFilmId.get(String(film.id)) || [];
    const showingRows = showingsByFilmId.get(String(film.id)) || [];

    const now = new Date();
    let futureTimes = 0;
    let totalTimes = 0;

    showingRows.forEach((showing) => {
      (showing.times || []).forEach((time) => {
        totalTimes += 1;
        const dateTime = getShowDateTime(showing.show_date, time);
        if (dateTime && dateTime >= now) {
          futureTimes += 1;
        }
      });
    });

    const links = linkRows.map((row) => {
      const theatre = theatreById.get(String(row.theatre_id));
      return {
        theatreName: theatre?.name || `Theatre ${row.theatre_id}`,
        theatreCity: theatre?.city || "",
        ticketLink: String(row.ticket_link || "").trim(),
      };
    });
    if (!links.length && String(film.ticket_link || "").trim()) {
      const linkedTheatreIds = theatreIdsByFilmIdFromShowings.get(String(film.id));
      if (linkedTheatreIds?.size) {
        linkedTheatreIds.forEach((theatreId) => {
          const theatre = theatreById.get(String(theatreId));
          links.push({
            theatreName: theatre?.name || `Theatre ${theatreId}`,
            theatreCity: theatre?.city || "",
            ticketLink: String(film.ticket_link || "").trim(),
          });
        });
      } else {
        links.push({
          theatreName: "All theatres",
          theatreCity: "",
          ticketLink: String(film.ticket_link || "").trim(),
        });
      }
    }

    links.sort((a, b) => `${a.theatreName} ${a.theatreCity}`.localeCompare(`${b.theatreName} ${b.theatreCity}`));

    return {
      id: film.id,
      title: film.title,
      year: film.year,
      tmdbId: film.tmdb_id,
      tmdb: film.tmdb_json || {},
      staffFavorite: Boolean(film.staff_favorite),
      staffFavoriteBy: String(film.staff_favorite_by || "").trim(),
      featuredOnPlayweek: Boolean(film.featured_on_playweek),
      featuredOnPlayweekUrl: String(film.featured_on_playweek_url || "").trim(),
      totalTimes,
      futureTimes,
      links,
      showings: showingRows,
      raw: {
        film,
        theatre_films: linkRows,
        showings: showingRows,
      },
    };
  });
  rows.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
  return rows;
}

function renderSummary() {
  const total = state.films.length;
  const withFuture = state.films.filter((film) => film.futureTimes > 0).length;
  const withoutFuture = total - withFuture;
  const withAnyTicketLinks = state.films.filter((film) => film.links.some((entry) => entry.ticketLink)).length;
  const staffFavorites = state.films.filter((film) => film.staffFavorite).length;
  const featuredOnPlayweek = state.films.filter((film) => film.featuredOnPlayweek).length;

  elements.summary.innerHTML = `
    <strong>${total}</strong> films total
    <br />
    <strong>${withFuture}</strong> with upcoming showtimes, <strong>${withoutFuture}</strong> without upcoming showtimes
    <br />
    <strong>${withAnyTicketLinks}</strong> with at least one ticket link
    <br />
    <strong>${staffFavorites}</strong> marked as staff favorites
    <br />
    <strong>${featuredOnPlayweek}</strong> featured on Playweek
  `;
}

function renderCatalog() {
  const filtered = state.films.filter((film) => normalize(film.title).includes(state.query));
  elements.catalogList.innerHTML = "";

  if (!filtered.length) {
    elements.catalogList.innerHTML = '<section class="panel">No films match your search.</section>';
    return;
  }

  const table = document.createElement("table");
  table.className = "catalog-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Title</th>
        <th>Year</th>
        <th>TMDb</th>
        <th>Status</th>
        <th>Upcoming</th>
        <th>Total</th>
        <th>Ticket Links</th>
        <th>Director</th>
        <th>Starring</th>
        <th>Genre</th>
        <th>Staff Favorite</th>
        <th>Featured On Playweek</th>
        <th>DB Rows</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");
  filtered.forEach((film) => {
    const tmdb = film.tmdb || {};
    const director = String(tmdb.director || "").trim();
    const stars = Array.isArray(tmdb.stars) ? tmdb.stars.filter(Boolean) : [];
    const genres = Array.isArray(tmdb.genres) ? tmdb.genres.filter(Boolean) : [];
    const statusClass = film.futureTimes > 0 ? "badge badge-on" : "badge badge-off";
    const statusText = film.futureTimes > 0 ? "Showing" : "No upcoming";
    const isFavoriteBusy = state.favoriteSaveBusy.has(String(film.id));
    const isFeaturedBusy = state.featuredSaveBusy.has(String(film.id));
    const favoriteBadge = film.staffFavorite
      ? film.staffFavoriteBy
        ? `Yes (${escapeHtml(film.staffFavoriteBy)})`
        : "Yes (General)"
      : "No";
    const featuredBadge = film.featuredOnPlayweek
      ? film.featuredOnPlayweekUrl
        ? `Yes (${escapeHtml(film.featuredOnPlayweekUrl)})`
        : "Yes"
      : "No";

    const row = document.createElement("tr");
    row.dataset.filmId = String(film.id);
    row.innerHTML = `
      <td><strong>${escapeHtml(film.title || "")}</strong></td>
      <td>${Number.isInteger(Number(film.year)) ? Number(film.year) : ""}</td>
      <td>${Number.isInteger(Number(film.tmdbId)) ? Number(film.tmdbId) : ""}</td>
      <td><span class="${statusClass}">${statusText}</span></td>
      <td>${film.futureTimes}</td>
      <td>${film.totalTimes}</td>
      <td>${film.links.filter((entry) => entry.ticketLink).length}/${film.links.length}</td>
      <td>${escapeHtml(director)}</td>
      <td>${escapeHtml(stars.join(", "))}</td>
      <td>${escapeHtml(genres.join(", "))}</td>
      <td>
        ${
          !state.staffFavoriteSupported
            ? '<span class="muted-inline">Schema update required</span>'
            : state.isAuthed
              ? `
          <div class="staff-favorite-controls">
            <label class="staff-favorite-toggle-wrap">
              <input data-role="favorite-toggle" type="checkbox" ${film.staffFavorite ? "checked" : ""} ${isFavoriteBusy ? "disabled" : ""} />
              Favorite
            </label>
            <input
              data-role="favorite-by"
              class="staff-favorite-by"
              type="text"
              value="${escapeHtml(film.staffFavoriteBy)}"
              placeholder="Staff name (optional)"
              ${film.staffFavorite && !isFavoriteBusy ? "" : "disabled"}
            />
            <button type="button" data-action="save-favorite" class="staff-favorite-save" ${isFavoriteBusy ? "disabled" : ""}>Save</button>
          </div>
        `
              : `<span class="badge ${film.staffFavorite ? "badge-on" : "badge-off"}">${favoriteBadge}</span>`
        }
      </td>
      <td>
        ${
          !state.featuredOnPlayweekSupported
            ? '<span class="muted-inline">Schema update required</span>'
            : state.isAuthed
              ? `
          <div class="featured-controls">
            <label class="featured-toggle-wrap">
              <input data-role="featured-toggle" type="checkbox" ${film.featuredOnPlayweek ? "checked" : ""} ${isFeaturedBusy ? "disabled" : ""} />
              Featured
            </label>
            <input
              data-role="featured-url"
              class="featured-url"
              type="url"
              value="${escapeHtml(film.featuredOnPlayweekUrl)}"
              placeholder="https://themaineplayweek.com/..."
              ${film.featuredOnPlayweek && !isFeaturedBusy ? "" : "disabled"}
            />
            <button type="button" data-action="save-featured" class="featured-save" ${isFeaturedBusy ? "disabled" : ""}>Save</button>
          </div>
        `
              : `<span class="badge ${film.featuredOnPlayweek ? "badge-on" : "badge-off"}">${featuredBadge}</span>`
        }
      </td>
      <td>
        <details>
          <summary>View</summary>
          <pre>${escapeHtml(JSON.stringify(film.raw, null, 2))}</pre>
        </details>
      </td>
    `;
    tbody.appendChild(row);
  });

  const wrap = document.createElement("div");
  wrap.className = "table-wrap panel";
  wrap.appendChild(table);
  elements.catalogList.appendChild(wrap);
}

async function saveStaffFavorite(row) {
  if (!state.isAuthed) {
    setStatus("Sign in first to edit staff favorites.");
    return;
  }
  if (!state.staffFavoriteSupported) {
    setStatus("Staff favorite columns are missing. Run latest supabase/schema.sql first.");
    return;
  }

  const filmId = Number(row.dataset.filmId);
  if (!Number.isInteger(filmId) || filmId <= 0) return;

  const favoriteToggle = row.querySelector('input[data-role="favorite-toggle"]');
  const favoriteByInput = row.querySelector('input[data-role="favorite-by"]');
  if (!favoriteToggle || !favoriteByInput) return;

  const staffFavorite = Boolean(favoriteToggle.checked);
  const staffFavoriteBy = staffFavorite ? String(favoriteByInput.value || "").trim() : "";
  const busyKey = String(filmId);
  state.favoriteSaveBusy.add(busyKey);
  renderCatalog();

  try {
    const { error } = await supabase
      .from("films")
      .update({
        staff_favorite: staffFavorite,
        staff_favorite_by: staffFavoriteBy,
      })
      .eq("id", filmId);
    if (error) throw error;

    const film = state.films.find((entry) => Number(entry.id) === filmId);
    if (film) {
      film.staffFavorite = staffFavorite;
      film.staffFavoriteBy = staffFavoriteBy;
    }
    setStatus(
      staffFavorite
        ? `Saved staff favorite for film ${filmId}${staffFavoriteBy ? ` (${staffFavoriteBy})` : " (General)"}.`
        : `Cleared staff favorite for film ${filmId}.`
    );
  } catch (error) {
    setStatus(`Save failed: ${error.message}`);
  } finally {
    state.favoriteSaveBusy.delete(busyKey);
    renderSummary();
    renderCatalog();
  }
}

async function saveFeaturedOnPlayweek(row) {
  if (!state.isAuthed) {
    setStatus("Sign in first to edit featured-on-playweek settings.");
    return;
  }
  if (!state.featuredOnPlayweekSupported) {
    setStatus("Featured-on-playweek columns are missing. Run latest supabase/schema.sql first.");
    return;
  }

  const filmId = Number(row.dataset.filmId);
  if (!Number.isInteger(filmId) || filmId <= 0) return;

  const featuredToggle = row.querySelector('input[data-role="featured-toggle"]');
  const featuredUrlInput = row.querySelector('input[data-role="featured-url"]');
  if (!featuredToggle || !featuredUrlInput) return;

  const featuredOnPlayweek = Boolean(featuredToggle.checked);
  const rawUrl = String(featuredUrlInput.value || "").trim();
  if (featuredOnPlayweek && !rawUrl) {
    setStatus("Featured on Playweek requires a URL.");
    return;
  }
  const featuredOnPlayweekUrl = featuredOnPlayweek ? normalizeOutboundUrl(rawUrl) : "";
  const busyKey = String(filmId);
  state.featuredSaveBusy.add(busyKey);
  renderCatalog();

  try {
    const { error } = await supabase
      .from("films")
      .update({
        featured_on_playweek: featuredOnPlayweek,
        featured_on_playweek_url: featuredOnPlayweekUrl,
      })
      .eq("id", filmId);
    if (error) throw error;

    const film = state.films.find((entry) => Number(entry.id) === filmId);
    if (film) {
      film.featuredOnPlayweek = featuredOnPlayweek;
      film.featuredOnPlayweekUrl = featuredOnPlayweekUrl;
    }
    setStatus(
      featuredOnPlayweek
        ? `Saved featured-on-playweek for film ${filmId}.`
        : `Cleared featured-on-playweek for film ${filmId}.`
    );
  } catch (error) {
    setStatus(`Save failed: ${error.message}`);
  } finally {
    state.featuredSaveBusy.delete(busyKey);
    renderSummary();
    renderCatalog();
  }
}

function normalize(value) {
  return stripDiacritics(value)
    .trim()
    .toLowerCase();
}

function stripDiacritics(value) {
  const text = String(value || "");
  if (typeof text.normalize !== "function") return text;
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function setStatus(message) {
  elements.status.textContent = message;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeOutboundUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  return `https://${raw}`;
}

function getShowDateTime(dateIso, time12Hour) {
  const hhmm = to24HourTime(time12Hour);
  if (!hhmm) return null;
  const date = parseIsoDate(dateIso);
  if (!date) return null;
  const [hours, minutes] = hhmm.split(":").map(Number);
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function to24HourTime(time12Hour) {
  const value = String(time12Hour || "").trim().toUpperCase();
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (!match) {
    const match24 = value.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
      const hours = Number(match24[1]);
      const minutes = Number(match24[2]);
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      }
    }
    const matchNoMinutes = value.match(/^(\d{1,2})\s*(AM|PM)$/);
    if (matchNoMinutes) {
      let hours = Number(matchNoMinutes[1]);
      const period = matchNoMinutes[2];
      if (hours === 12) hours = 0;
      if (period === "PM") hours += 12;
      return `${String(hours).padStart(2, "0")}:00`;
    }
    return "";
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3];
  if (hours === 12) hours = 0;
  if (period === "PM") hours += 12;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseIsoDate(dateIso) {
  const match = String(dateIso || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}
