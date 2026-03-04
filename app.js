import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DATA_URL = "./data/showtimes.json";
const STORAGE_KEY = "showtimes-local-edit";
const TMDB_KEY_STORAGE_KEY = "tmdb-api-key-local";

const SUPABASE_URL = "https://rjfsjoratsfqcyyjseqm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqZnNqb3JhdHNmcWN5eWpzZXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mzc5MDgsImV4cCI6MjA4ODIxMzkwOH0.dmcQ_ffwmm4JIKTjSUNNYLGQ9w_v1mR6VRMZimVnLNg";

const state = {
  data: { theatreGroups: [] },
  view: "films",
  source: "json",
  supabase: null,
  admin: {
    theatreIndex: 0,
    filmIndex: 0,
    tmdbApiKey: "",
    auth: {
      authenticated: false,
      email: "",
    },
  },
};

const elements = {
  results: document.getElementById("results"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  groupTemplate: document.getElementById("groupTemplate"),
  showItemTemplate: document.getElementById("showItemTemplate"),
  adminToggle: document.getElementById("adminToggle"),
  adminPanel: document.getElementById("adminPanel"),
  adminAuthGate: document.getElementById("adminAuthGate"),
  adminControls: document.getElementById("adminControls"),
  adminEmailInput: document.getElementById("adminEmailInput"),
  adminLoginButton: document.getElementById("adminLoginButton"),
  adminLogoutButton: document.getElementById("adminLogoutButton"),
  adminTheatreSelect: document.getElementById("adminTheatreSelect"),
  addTheatre: document.getElementById("addTheatre"),
  addTheatreModal: document.getElementById("addTheatreModal"),
  addTheatreForm: document.getElementById("addTheatreForm"),
  modalTheatreNameInput: document.getElementById("modalTheatreNameInput"),
  modalTheatreCityInput: document.getElementById("modalTheatreCityInput"),
  modalTheatreAddressInput: document.getElementById("modalTheatreAddressInput"),
  modalTheatreWebsiteInput: document.getElementById("modalTheatreWebsiteInput"),
  tmdbApiKeyInput: document.getElementById("tmdbApiKeyInput"),
  adminFilmSelect: document.getElementById("adminFilmSelect"),
  addFilm: document.getElementById("addFilm"),
  addFilmModal: document.getElementById("addFilmModal"),
  addFilmForm: document.getElementById("addFilmForm"),
  modalFilmTitleInput: document.getElementById("modalFilmTitleInput"),
  modalFilmYearInput: document.getElementById("modalFilmYearInput"),
  modalFilmTmdbIdInput: document.getElementById("modalFilmTmdbIdInput"),
  modalFilmTicketLinkInput: document.getElementById("modalFilmTicketLinkInput"),
  deleteFilm: document.getElementById("deleteFilm"),
  refreshTmdb: document.getElementById("refreshTmdb"),
  showingDateInput: document.getElementById("showingDateInput"),
  showingTimesInput: document.getElementById("showingTimesInput"),
  addShowing: document.getElementById("addShowing"),
  showingsList: document.getElementById("showingsList"),
  saveAllAdmin: document.getElementById("saveAllAdmin"),
  adminJson: document.getElementById("adminJson"),
  applyJson: document.getElementById("applyJson"),
  downloadJson: document.getElementById("downloadJson"),
  uploadJson: document.getElementById("uploadJson"),
  resetJson: document.getElementById("resetJson"),
  adminMessage: document.getElementById("adminMessage"),
};

await init();

async function init() {
  initializeSupabase();
  bindEvents();
  await refreshAuthState();
  await loadData();
  initializeAdminState();
  loadAdminSettings();
  syncAdminEditor();
  render();
}

function initializeSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;
  state.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  state.supabase.auth.onAuthStateChange((_event, session) => {
    state.admin.auth.authenticated = Boolean(session?.user);
    state.admin.auth.email = session?.user?.email || "";
    updateAdminAuthUI();
  });
}

function bindEvents() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.view = tab.dataset.view;
      elements.tabs.forEach((button) => {
        const selected = button === tab;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
      });
      render();
    });
  });

  elements.adminToggle.addEventListener("click", () => {
    const open = elements.adminPanel.classList.toggle("hidden") === false;
    elements.adminToggle.setAttribute("aria-expanded", String(open));
    elements.adminMessage.textContent = "";
    if (open) {
      loadAdminSettings();
      syncAdminEditor();
      updateAdminAuthUI();
    }
  });

  elements.adminLoginButton.addEventListener("click", async () => {
    if (!state.supabase) {
      elements.adminMessage.textContent = "Supabase is not configured.";
      return;
    }
    const email = elements.adminEmailInput.value.trim();
    if (!email) {
      elements.adminMessage.textContent = "Enter your email first.";
      return;
    }

    const { error } = await state.supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });

    if (error) {
      elements.adminMessage.textContent = `Magic link failed: ${error.message}`;
      return;
    }

    elements.adminMessage.textContent = "Magic link sent. Check your email.";
  });

  elements.adminLogoutButton.addEventListener("click", async () => {
    if (!state.supabase) return;
    await state.supabase.auth.signOut();
    state.admin.auth.authenticated = false;
    state.admin.auth.email = "";
    updateAdminAuthUI();
    elements.adminMessage.textContent = "Logged out.";
  });

  elements.tmdbApiKeyInput.addEventListener("input", () => {
    state.admin.tmdbApiKey = elements.tmdbApiKeyInput.value.trim();
    localStorage.setItem(TMDB_KEY_STORAGE_KEY, state.admin.tmdbApiKey);
  });

  elements.adminTheatreSelect.addEventListener("change", () => {
    state.admin.theatreIndex = Number(elements.adminTheatreSelect.value) || 0;
    state.admin.filmIndex = 0;
    syncAdminEditor();
  });

  elements.adminFilmSelect.addEventListener("change", () => {
    state.admin.filmIndex = Number(elements.adminFilmSelect.value) || 0;
    syncAdminEditor();
  });

  elements.addTheatre.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    elements.addTheatreForm.reset();
    elements.addTheatreModal.showModal();
  });

  elements.addFilm.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    const theatre = getSelectedTheatre();
    if (!theatre) return;
    elements.addFilmForm.reset();
    elements.modalFilmYearInput.value = String(new Date().getFullYear());
    elements.addFilmModal.showModal();
  });

  elements.addTheatreForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requireAdminAuth()) return;

    const name = elements.modalTheatreNameInput.value.trim();
    const city = elements.modalTheatreCityInput.value.trim();
    const address = elements.modalTheatreAddressInput.value.trim();
    const website = elements.modalTheatreWebsiteInput.value.trim();
    if (!name || !city || !address || !website) {
      elements.adminMessage.textContent = "Fill out all theatre fields.";
      return;
    }

    state.data.theatreGroups.push({
      name,
      city,
      address,
      website,
      films: [],
    });
    state.admin.theatreIndex = state.data.theatreGroups.length - 1;
    state.admin.filmIndex = 0;
    elements.addTheatreModal.close();
    syncAdminEditor();
    elements.adminMessage.textContent = "Added theatre.";
  });

  elements.addFilmForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requireAdminAuth()) return;

    const theatre = getSelectedTheatre();
    if (!theatre) return;

    const title = elements.modalFilmTitleInput.value.trim();
    const yearValue = elements.modalFilmYearInput.value.trim();
    const tmdbIdValue = elements.modalFilmTmdbIdInput.value.trim();
    const ticketLink = elements.modalFilmTicketLinkInput.value.trim();

    if (!title || !ticketLink) {
      elements.adminMessage.textContent = "Film title and ticket link are required.";
      return;
    }
    if (!yearValue && !tmdbIdValue) {
      elements.adminMessage.textContent = "Provide a year or TMDb ID.";
      return;
    }

    const film = {
      title,
      ticketLink,
      showings: [],
    };
    if (yearValue) film.year = Number(yearValue);
    if (tmdbIdValue) film.tmdbId = Number(tmdbIdValue);

    theatre.films.push(film);
    state.admin.filmIndex = theatre.films.length - 1;
    elements.addFilmModal.close();
    syncAdminEditor();
    elements.adminMessage.textContent = "Added film.";
  });

  elements.deleteFilm.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    const theatre = getSelectedTheatre();
    if (!theatre || !theatre.films.length) return;
    theatre.films.splice(state.admin.filmIndex, 1);
    state.admin.filmIndex = Math.max(0, state.admin.filmIndex - 1);
    syncAdminEditor();
    elements.adminMessage.textContent = "Deleted film.";
  });

  elements.refreshTmdb.addEventListener("click", async () => {
    if (!requireAdminAuth()) return;
    const film = getSelectedFilm();
    if (!film) return;
    if (!state.admin.tmdbApiKey) {
      elements.adminMessage.textContent = "Add TMDb API key above, then click Refresh TMDb.";
      return;
    }
    if (!film.tmdbId) {
      elements.adminMessage.textContent = "Set a TMDb ID for this film first.";
      return;
    }

    try {
      const details = await fetchTmdbMovieById(state.admin.tmdbApiKey, Number(film.tmdbId));
      film.tmdb = buildTmdbRecord(details);
      syncAdminEditor();
      elements.adminMessage.textContent = "TMDb details refreshed.";
    } catch (error) {
      elements.adminMessage.textContent = `TMDb refresh failed: ${error.message}`;
    }
  });

  elements.addShowing.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    const film = getSelectedFilm();
    if (!film) return;
    const date = elements.showingDateInput.value;
    const times = parseTimesInput(elements.showingTimesInput.value);
    if (!date || !times.length) {
      elements.adminMessage.textContent = "Add a date and at least one time.";
      return;
    }
    film.showings.push({ date, times });
    film.showings.sort((a, b) => a.date.localeCompare(b.date));
    elements.showingDateInput.value = "";
    elements.showingTimesInput.value = "";
    syncAdminEditor();
    elements.adminMessage.textContent = "Added showing.";
  });

  elements.showingsList.addEventListener("click", (event) => {
    if (!requireAdminAuth()) return;
    const button = event.target.closest("button[data-showing-index]");
    if (!button) return;
    const film = getSelectedFilm();
    if (!film) return;
    const idx = Number(button.dataset.showingIndex);
    if (Number.isNaN(idx)) return;
    film.showings.splice(idx, 1);
    syncAdminEditor();
    elements.adminMessage.textContent = "Deleted showing.";
  });

  elements.saveAllAdmin.addEventListener("click", async () => {
    if (!requireAdminAuth()) return;
    try {
      validateData(state.data);
      await persistData();
      elements.adminMessage.textContent = "All changes saved to Supabase.";
    } catch (error) {
      elements.adminMessage.textContent = `Save failed: ${error.message}`;
    }
  });

  elements.applyJson.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    try {
      const parsed = JSON.parse(elements.adminJson.value);
      validateData(parsed);
      state.data = parsed;
      initializeAdminState();
      syncAdminEditor();
      render();
      elements.adminMessage.textContent = "JSON applied. Click Save All Changes to sync Supabase.";
    } catch (error) {
      elements.adminMessage.textContent = `Invalid JSON: ${error.message}`;
    }
  });

  elements.downloadJson.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "showtimes.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  elements.uploadJson.addEventListener("change", async (event) => {
    if (!requireAdminAuth()) return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      const parsed = JSON.parse(content);
      validateData(parsed);
      state.data = parsed;
      initializeAdminState();
      syncAdminEditor();
      render();
      elements.adminMessage.textContent = "Imported JSON. Click Save All Changes to sync Supabase.";
      elements.uploadJson.value = "";
    } catch (error) {
      elements.adminMessage.textContent = `Import failed: ${error.message}`;
    }
  });

  elements.resetJson.addEventListener("click", async () => {
    localStorage.removeItem(STORAGE_KEY);
    await loadData();
    initializeAdminState();
    syncAdminEditor();
    render();
    elements.adminMessage.textContent = "Reset from source data.";
  });
}

async function refreshAuthState() {
  if (!state.supabase) {
    state.admin.auth.authenticated = false;
    state.admin.auth.email = "";
    return;
  }
  const { data } = await state.supabase.auth.getSession();
  state.admin.auth.authenticated = Boolean(data.session?.user);
  state.admin.auth.email = data.session?.user?.email || "";
}

async function loadData() {
  if (state.supabase) {
    try {
      const fromDb = await loadDataFromSupabase();
      if (fromDb.theatreGroups.length) {
        validateData(fromDb);
        state.data = fromDb;
        state.source = "supabase";
        return;
      }
    } catch {
      // fall through to local fallback
    }
  }

  const localData = localStorage.getItem(STORAGE_KEY);
  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      validateData(parsed);
      state.data = parsed;
      state.source = "local";
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load ${DATA_URL}`);
  }

  const json = await response.json();
  validateData(json);
  state.data = json;
  state.source = "json";
}

async function loadDataFromSupabase() {
  const theatresResult = await state.supabase
    .from("theatres")
    .select("id,name,city,address,website")
    .order("name");
  if (theatresResult.error) throw theatresResult.error;

  const filmsResult = await state.supabase
    .from("films")
    .select("id,title,year,tmdb_id,ticket_link,tmdb_json")
    .order("title");
  if (filmsResult.error) throw filmsResult.error;

  const showingsResult = await state.supabase
    .from("showings")
    .select("id,theatre_id,film_id,show_date,times")
    .order("show_date");
  if (showingsResult.error) throw showingsResult.error;

  const theatres = theatresResult.data || [];
  const films = filmsResult.data || [];
  const showings = showingsResult.data || [];

  const theatreById = new Map();
  const filmById = new Map();
  const theatreGroups = theatres.map((theatreRow) => {
    const entry = {
      name: theatreRow.name,
      city: theatreRow.city,
      address: theatreRow.address,
      website: theatreRow.website,
      films: [],
      _dbId: theatreRow.id,
      _filmMap: new Map(),
    };
    theatreById.set(theatreRow.id, entry);
    return entry;
  });

  films.forEach((filmRow) => {
    filmById.set(filmRow.id, {
      title: filmRow.title,
      year: filmRow.year,
      tmdbId: filmRow.tmdb_id,
      ticketLink: filmRow.ticket_link,
      tmdb: filmRow.tmdb_json || undefined,
      _dbId: filmRow.id,
    });
  });

  showings.forEach((showingRow) => {
    const theatre = theatreById.get(showingRow.theatre_id);
    const filmTemplate = filmById.get(showingRow.film_id);
    if (!theatre || !filmTemplate) return;

    const filmKey = String(filmTemplate._dbId);
    if (!theatre._filmMap.has(filmKey)) {
      theatre._filmMap.set(filmKey, {
        title: filmTemplate.title,
        year: filmTemplate.year,
        tmdbId: filmTemplate.tmdbId,
        ticketLink: filmTemplate.ticketLink,
        tmdb: filmTemplate.tmdb,
        showings: [],
        _dbId: filmTemplate._dbId,
      });
      theatre.films.push(theatre._filmMap.get(filmKey));
    }

    theatre._filmMap.get(filmKey).showings.push({
      date: showingRow.show_date,
      times: Array.isArray(showingRow.times) ? showingRow.times : [],
    });
  });

  theatreGroups.forEach((theatre) => {
    theatre.films.forEach((film) => {
      film.showings.sort((a, b) => a.date.localeCompare(b.date));
    });
    delete theatre._filmMap;
  });

  return { theatreGroups };
}

function validateData(data) {
  if (!data || !Array.isArray(data.theatreGroups)) {
    throw new Error("Expected object with theatreGroups array.");
  }

  for (const theatre of data.theatreGroups) {
    if (typeof theatre?.name !== "string" || !theatre.name.trim()) {
      throw new Error("Each theatre must include a non-empty name.");
    }
    if (typeof theatre?.city !== "string" || !theatre.city.trim()) {
      throw new Error(`Theatre "${theatre.name}" is missing city.`);
    }
    if (typeof theatre?.address !== "string" || !theatre.address.trim()) {
      throw new Error(`Theatre "${theatre.name}" is missing address.`);
    }
    if (typeof theatre?.website !== "string" || !theatre.website.trim()) {
      throw new Error(`Theatre "${theatre.name}" is missing website.`);
    }
    if (!Array.isArray(theatre?.films)) {
      throw new Error(`Theatre "${theatre.name}" must include a films array.`);
    }
    for (const film of theatre.films) {
      if (typeof film?.title !== "string" || !film.title.trim()) {
        throw new Error(`A film at "${theatre.name}" is missing title.`);
      }
      const hasValidYear = Number.isInteger(Number(film?.year));
      const hasValidTmdbId = Number.isInteger(Number(film?.tmdbId)) && Number(film.tmdbId) > 0;
      if (!hasValidYear && !hasValidTmdbId) {
        throw new Error(`Film "${film.title}" at "${theatre.name}" needs a valid year or tmdbId.`);
      }
      if (typeof film?.ticketLink !== "string" || !film.ticketLink.trim()) {
        throw new Error(`Film "${film.title}" at "${theatre.name}" is missing ticketLink.`);
      }
      if (!Array.isArray(film?.showings)) {
        throw new Error(`Film "${film.title}" at "${theatre.name}" must include a showings array.`);
      }
      for (const showing of film.showings) {
        if (typeof showing?.date !== "string" || !showing.date.trim()) {
          throw new Error(`A showing for "${film.title}" is missing date.`);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(showing.date)) {
          throw new Error(`A showing for "${film.title}" has invalid date format. Use YYYY-MM-DD.`);
        }
        if (!getShowDateTime(showing.date, "12:00 PM")) {
          throw new Error(`A showing for "${film.title}" has invalid date value.`);
        }
        if (!Array.isArray(showing?.times) || showing.times.length === 0) {
          throw new Error(`A showing for "${film.title}" must include a non-empty times array.`);
        }
        for (const time of showing.times) {
          if (typeof time !== "string" || !time.trim()) {
            throw new Error(`A showing for "${film.title}" contains an empty time.`);
          }
          if (!to24HourTime(time)) {
            throw new Error(`A showing for "${film.title}" has invalid time format. Use h:mm AM/PM.`);
          }
        }
      }
    }
  }
}

function syncAdminEditor() {
  updateAdminAuthUI();

  const theatres = state.data.theatreGroups;
  if (!theatres.length) {
    state.admin.theatreIndex = 0;
    state.admin.filmIndex = 0;
  } else {
    state.admin.theatreIndex = clampIndex(state.admin.theatreIndex, theatres.length);
  }

  renderTheatreOptions();
  renderFilmOptions();
  renderShowingsList();
  elements.adminJson.value = JSON.stringify(stripInternalFields(state.data), null, 2);
}

function initializeAdminState() {
  state.admin.theatreIndex = 0;
  state.admin.filmIndex = 0;
}

function loadAdminSettings() {
  state.admin.tmdbApiKey = localStorage.getItem(TMDB_KEY_STORAGE_KEY) || "";
  elements.tmdbApiKeyInput.value = state.admin.tmdbApiKey;
}

function updateAdminAuthUI() {
  const locked = !state.admin.auth.authenticated;
  elements.adminAuthGate.classList.toggle("hidden", !locked);
  elements.adminControls.classList.toggle("hidden", locked);
}

function renderTheatreOptions() {
  const theatres = state.data.theatreGroups;
  elements.adminTheatreSelect.innerHTML = "";
  theatres.forEach((theatre, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = theatre.name || `Theatre ${index + 1}`;
    elements.adminTheatreSelect.appendChild(option);
  });
  if (!theatres.length) {
    const option = document.createElement("option");
    option.value = "0";
    option.textContent = "No theatres yet";
    elements.adminTheatreSelect.appendChild(option);
  }
  elements.adminTheatreSelect.value = String(state.admin.theatreIndex);
}

function renderFilmOptions() {
  const theatre = getSelectedTheatre();
  const films = theatre?.films || [];
  state.admin.filmIndex = clampIndex(state.admin.filmIndex, films.length);

  elements.adminFilmSelect.innerHTML = "";
  films.forEach((film, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = film.year ? `${film.title} (${film.year})` : film.title;
    elements.adminFilmSelect.appendChild(option);
  });
  if (!films.length) {
    const option = document.createElement("option");
    option.value = "0";
    option.textContent = "No films yet";
    elements.adminFilmSelect.appendChild(option);
  }

  const hasFilm = films.length > 0;
  elements.adminFilmSelect.value = String(state.admin.filmIndex);
  elements.adminFilmSelect.disabled = !theatre || !hasFilm;
  elements.addFilm.disabled = !theatre;
  elements.deleteFilm.disabled = !hasFilm;
  elements.refreshTmdb.disabled = !hasFilm;
  elements.showingDateInput.disabled = !hasFilm;
  elements.showingTimesInput.disabled = !hasFilm;
  elements.addShowing.disabled = !hasFilm;
}

function renderShowingsList() {
  const film = getSelectedFilm();
  elements.showingsList.innerHTML = "";
  if (!film || !Array.isArray(film.showings) || !film.showings.length) {
    const li = document.createElement("li");
    li.textContent = "No showings yet.";
    elements.showingsList.appendChild(li);
    return;
  }

  film.showings
    .map((showing, index) => ({ showing, index }))
    .sort((a, b) => a.showing.date.localeCompare(b.showing.date))
    .forEach(({ showing, index }) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${showing.date}: ${showing.times.join(", ")}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost-btn";
      button.dataset.showingIndex = String(index);
      button.textContent = "Delete";
      li.appendChild(label);
      li.appendChild(button);
      elements.showingsList.appendChild(li);
    });
}

function getSelectedTheatre() {
  return state.data.theatreGroups[state.admin.theatreIndex] || null;
}

function getSelectedFilm() {
  const theatre = getSelectedTheatre();
  if (!theatre || !Array.isArray(theatre.films)) return null;
  return theatre.films[state.admin.filmIndex] || null;
}

function clampIndex(value, length) {
  if (!length) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, length - 1);
}

function parseTimesInput(input) {
  return String(input)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function persistData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stripInternalFields(state.data)));
  if (!state.supabase || !state.admin.auth.authenticated) {
    syncAdminEditor();
    render();
    return;
  }
  await saveDataToSupabase();
  state.source = "supabase";
  syncAdminEditor();
  render();
}

async function saveDataToSupabase() {
  const supabase = state.supabase;

  const deleteShowings = await supabase.from("showings").delete().not("id", "is", null);
  if (deleteShowings.error) throw deleteShowings.error;

  const deleteTheatres = await supabase.from("theatres").delete().not("id", "is", null);
  if (deleteTheatres.error) throw deleteTheatres.error;

  const deleteFilms = await supabase.from("films").delete().not("id", "is", null);
  if (deleteFilms.error) throw deleteFilms.error;

  const theatreIdMap = new Map();
  for (const theatre of state.data.theatreGroups) {
    const result = await supabase
      .from("theatres")
      .insert({
        name: theatre.name,
        city: theatre.city,
        address: theatre.address,
        website: theatre.website,
      })
      .select("id")
      .single();
    if (result.error) throw result.error;
    theatreIdMap.set(theatre, result.data.id);
  }

  const uniqueFilms = new Map();
  for (const theatre of state.data.theatreGroups) {
    for (const film of theatre.films) {
      const key = buildFilmUniqKey(film);
      if (!uniqueFilms.has(key)) uniqueFilms.set(key, film);
    }
  }

  const filmIdByKey = new Map();
  for (const [key, film] of uniqueFilms.entries()) {
    const result = await supabase
      .from("films")
      .insert({
        title: film.title,
        year: Number.isInteger(Number(film.year)) ? Number(film.year) : null,
        tmdb_id: Number.isInteger(Number(film.tmdbId)) ? Number(film.tmdbId) : null,
        ticket_link: film.ticketLink,
        tmdb_json: film.tmdb || null,
      })
      .select("id")
      .single();
    if (result.error) throw result.error;
    filmIdByKey.set(key, result.data.id);
  }

  const showingRows = [];
  for (const theatre of state.data.theatreGroups) {
    const theatreId = theatreIdMap.get(theatre);
    for (const film of theatre.films) {
      const filmKey = buildFilmUniqKey(film);
      const filmId = filmIdByKey.get(filmKey);
      for (const showing of film.showings) {
        showingRows.push({
          theatre_id: theatreId,
          film_id: filmId,
          show_date: showing.date,
          times: Array.from(new Set(showing.times)).sort(compareTimes),
        });
      }
    }
  }

  if (showingRows.length) {
    const insertShowings = await supabase.from("showings").insert(showingRows);
    if (insertShowings.error) throw insertShowings.error;
  }
}

function buildFilmUniqKey(film) {
  return [
    film.title || "",
    Number.isInteger(Number(film.year)) ? Number(film.year) : "",
    Number.isInteger(Number(film.tmdbId)) ? Number(film.tmdbId) : "",
    film.ticketLink || "",
  ].join("::");
}

function stripInternalFields(data) {
  return JSON.parse(
    JSON.stringify(data, (key, value) => {
      if (key.startsWith("_")) return undefined;
      return value;
    })
  );
}

function requireAdminAuth() {
  if (state.admin.auth.authenticated) return true;
  elements.adminMessage.textContent = "Sign in first to edit admin data.";
  return false;
}

function render() {
  const grouped = buildGroups(state.data.theatreGroups, state.view);
  elements.results.innerHTML = "";

  const entries = Object.entries(grouped);
  if (!entries.length) {
    elements.results.innerHTML = '<div class="empty-state">No showtimes found.</div>';
    return;
  }

  entries.sort(([a], [b]) => a.localeCompare(b));

  for (const [groupName, group] of entries) {
    const card = elements.groupTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector(".group-title").textContent =
      state.view === "days" ? formatDisplayDate(groupName) : groupName;
    const subtitle = card.querySelector(".group-subtitle");
    const groupLink = card.querySelector(".group-link");
    const groupFilmSummary = card.querySelector(".group-film-summary");
    const groupFilmPoster = card.querySelector(".group-film-poster");
    const groupFilmFacts = card.querySelector(".group-film-facts");
    const list = card.querySelector(".show-list");
    const shows = group.shows;

    if (group.theatreInfo) {
      subtitle.textContent = `${group.theatreInfo.city} · ${group.theatreInfo.address}`;
      subtitle.classList.remove("hidden");
      groupLink.href = group.theatreInfo.website;
      groupLink.classList.remove("hidden");
    }
    if (state.view === "films" && group.filmInfo) {
      const factsText = buildFilmFacts(group.filmInfo);
      if (group.filmInfo.posterUrl) {
        groupFilmPoster.src = group.filmInfo.posterUrl;
        groupFilmPoster.alt = `Poster for ${group.filmInfo.film}`;
        groupFilmPoster.classList.remove("hidden");
      }
      if (factsText) {
        groupFilmFacts.textContent = factsText;
        groupFilmFacts.classList.remove("hidden");
      }
      groupFilmSummary.classList.remove("hidden");
    }

    shows.sort((a, b) => {
      if (state.view === "theatres") {
        return buildFilmGroupKey(a.film, a.year).localeCompare(buildFilmGroupKey(b.film, b.year));
      }
      if (state.view === "days") {
        return buildFilmGroupKey(a.film, a.year).localeCompare(buildFilmGroupKey(b.film, b.year));
      }
      return `${a.theatre} ${a.city}`.localeCompare(`${b.theatre} ${b.city}`);
    });

    for (const show of shows) {
      const item = elements.showItemTemplate.content.firstElementChild.cloneNode(true);
      const main = item.querySelector(".show-main");
      const meta = item.querySelector(".show-meta");
      const schedule = item.querySelector(".show-schedule");
      const row = item.querySelector(".show-row");
      const poster = item.querySelector(".show-poster");
      const link = item.querySelector(".show-link");
      const filmLabel = show.year ? `${show.film} (${show.year})` : show.film;

      if (state.view === "theatres") {
        main.textContent = filmLabel;
        meta.textContent = `${show.city}`;
        renderSchedule(schedule, show.dates);
      } else if (state.view === "days") {
        main.textContent = filmLabel;
        meta.textContent = "";
        renderTheatreSchedule(schedule, show.theatres);
      } else {
        main.textContent = `${show.theatre}`;
        meta.textContent = `${show.city}`;
        renderSchedule(schedule, show.dates);
      }

      if (state.view !== "days" && show.ticketLink) {
        link.href = show.ticketLink;
        link.classList.remove("hidden");
      }
      if (state.view !== "films" && show.posterUrl) {
        row.classList.add("has-poster");
        poster.src = show.posterUrl;
        poster.alt = `Poster for ${show.film}`;
        poster.classList.remove("hidden");
      }
      list.appendChild(item);
    }

    elements.results.appendChild(card);
  }
}

function buildGroups(theatres, view) {
  const grouped = {};
  const now = new Date();

  theatres.forEach((theatre) => {
    const theatreInfo = {
      name: theatre.name,
      city: theatre.city,
      address: theatre.address,
      website: theatre.website,
    };

    const rowsByFilm = {};
    theatre.films.forEach((film) => {
      const metadata = extractFilmMetadata(film);
      const row = {
        theatre: theatre.name,
        city: theatre.city,
        film: film.title,
        year: Number.isInteger(Number(film.year)) ? Number(film.year) : null,
        ticketLink: film.ticketLink,
        posterUrl: metadata.posterUrl,
        director: metadata.director,
        stars: metadata.stars,
        genres: metadata.genres,
        dates: {},
      };

      film.showings.forEach((showing) => {
        showing.times.forEach((time) => {
          const showDateTime = getShowDateTime(showing.date, time);
          if (!showDateTime || showDateTime < now) return;
          if (!row.dates[showing.date]) row.dates[showing.date] = [];
          row.dates[showing.date].push(time);
        });
      });

      if (Object.keys(row.dates).length) {
        rowsByFilm[film.title] = row;
      }
    });

    Object.values(rowsByFilm).forEach((row) => {
      Object.keys(row.dates).forEach((date) => {
        row.dates[date].sort(compareTimes);
      });
      if (!Object.keys(row.dates).length) return;

      if (view === "days") {
        Object.entries(row.dates).forEach(([date, times]) => {
          if (!grouped[date]) {
            grouped[date] = {
              theatreInfo: null,
              filmInfo: null,
              shows: [],
              byFilm: {},
            };
          }
          const filmKey = buildFilmGroupKey(row.film, row.year);
          if (!grouped[date].byFilm[filmKey]) {
            const dayRow = {
              film: row.film,
              year: row.year,
              posterUrl: row.posterUrl,
              director: row.director,
              stars: row.stars,
              genres: row.genres,
              theatres: {},
            };
            grouped[date].byFilm[filmKey] = dayRow;
            grouped[date].shows.push(dayRow);
          }
          const dayRow = grouped[date].byFilm[filmKey];
          const theatreKey = `${row.theatre} · ${row.city}`;
          if (!dayRow.theatres[theatreKey]) dayRow.theatres[theatreKey] = [];
          dayRow.theatres[theatreKey].push(...times);
        });
        return;
      }

      const key = view === "theatres" ? theatre.name : buildFilmGroupKey(row.film, row.year);
      if (!grouped[key]) {
        grouped[key] = {
          theatreInfo: view === "theatres" ? theatreInfo : null,
          filmInfo: view === "films" ? row : null,
          shows: [],
        };
      }
      grouped[key].shows.push(row);
    });
  });

  if (view === "days") {
    Object.values(grouped).forEach((group) => {
      group.shows.forEach((show) => {
        Object.keys(show.theatres).forEach((theatreKey) => {
          show.theatres[theatreKey].sort(compareTimes);
        });
      });
      delete group.byFilm;
    });
  }

  return grouped;
}

function renderSchedule(container, dates) {
  container.innerHTML = "";
  const dateEntries = Object.entries(dates);
  dateEntries.sort(([a], [b]) => a.localeCompare(b));

  dateEntries.forEach(([date, times]) => {
    const row = document.createElement("div");
    row.className = "show-schedule-row";
    const label = document.createElement("span");
    label.className = "show-schedule-day";
    label.textContent = `${formatDisplayDate(date)}: `;
    row.appendChild(label);
    row.appendChild(document.createTextNode(times.join(", ")));
    container.appendChild(row);
  });
}

function renderTheatreSchedule(container, theatres) {
  container.innerHTML = "";
  const entries = Object.entries(theatres);
  entries.sort(([a], [b]) => a.localeCompare(b));
  entries.forEach(([theatreLabel, times]) => {
    const row = document.createElement("div");
    row.className = "show-schedule-row";
    const label = document.createElement("span");
    label.className = "show-schedule-day";
    label.textContent = `${theatreLabel}: `;
    row.appendChild(label);
    row.appendChild(document.createTextNode(times.join(", ")));
    container.appendChild(row);
  });
}

function buildFilmFacts(show) {
  const lines = [];
  if (show.director) lines.push(`Director: ${show.director}`);
  if (Array.isArray(show.stars) && show.stars.length) lines.push(`Starring: ${show.stars.join(", ")}`);
  if (Array.isArray(show.genres) && show.genres.length) lines.push(`Genre: ${show.genres.join(", ")}`);
  return lines.join("\n");
}

function extractFilmMetadata(film) {
  const tmdb = film.tmdb || {};
  const genres = normalizeStringArray(tmdb.genres || film.genres);
  const stars = normalizeStringArray(tmdb.stars || film.stars);
  const director = typeof (tmdb.director || film.director) === "string" ? (tmdb.director || film.director).trim() : "";
  const posterUrl = normalizePosterUrl(tmdb.posterUrl || tmdb.posterPath || film.posterUrl || film.posterPath);
  return { genres, stars, director, posterUrl };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function normalizePosterUrl(value) {
  if (!value || typeof value !== "string") return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) return `https://image.tmdb.org/t/p/w185${value}`;
  return "";
}

function buildFilmGroupKey(title, year) {
  if (Number.isInteger(year)) return `${title} (${year})`;
  return title;
}

function compareTimes(a, b) {
  const left = to24HourTime(a);
  const right = to24HourTime(b);
  return left.localeCompare(right);
}

function formatDisplayDate(dateIso) {
  const date = parseIsoDate(dateIso);
  if (!date) return dateIso;
  const dayDiff = getDayDifferenceFromToday(date);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff > 1 && dayDiff <= 7) {
    return new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  }
  const showYear = date.getFullYear() !== new Date().getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
  }).format(date);
}

function getShowDateTime(dateIso, time12Hour) {
  const hhmm = to24HourTime(time12Hour);
  if (!hhmm) return null;
  const baseDate = parseIsoDate(dateIso);
  if (!baseDate) return null;
  const [hours, minutes] = hhmm.split(":").map(Number);
  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function to24HourTime(time12Hour) {
  const match = /^(\d{1,2}):([0-5]\d)\s(AM|PM)$/.exec(String(time12Hour).trim());
  if (!match) return "";
  let hour = Number(match[1]);
  const minutes = match[2];
  const period = match[3];
  if (hour < 1 || hour > 12) return "";
  if (period === "AM") {
    if (hour === 12) hour = 0;
  } else if (hour !== 12) {
    hour += 12;
  }
  return `${String(hour).padStart(2, "0")}:${minutes}`;
}

function parseIsoDate(dateIso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateIso).trim());
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

function getDayDifferenceFromToday(targetDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDay = Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((targetDay - todayDay) / 86400000);
}

async function fetchTmdbMovieById(apiKey, tmdbId) {
  const url =
    `https://api.themoviedb.org/3/movie/${encodeURIComponent(tmdbId)}` +
    `?api_key=${encodeURIComponent(apiKey)}&append_to_response=credits`;

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TMDb ${response.status}: ${text || "request failed"}`);
  }
  return response.json();
}

function buildTmdbRecord(details) {
  const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
  const cast = Array.isArray(details.credits?.cast) ? details.credits.cast : [];
  const director = crew.find((member) => member.job === "Director")?.name || "";
  const stars = cast.slice(0, 3).map((member) => member.name).filter(Boolean);
  const genres = Array.isArray(details.genres) ? details.genres.map((genre) => genre.name).filter(Boolean) : [];

  return {
    id: details.id,
    title: details.title || "",
    releaseDate: details.release_date || "",
    posterPath: details.poster_path || "",
    posterUrl: details.poster_path ? `https://image.tmdb.org/t/p/w342${details.poster_path}` : "",
    director,
    stars,
    genres,
    matchedAt: new Date().toISOString(),
  };
}
