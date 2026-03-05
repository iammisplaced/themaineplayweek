import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DATA_URL = "./data/showtimes.json";
const STORAGE_KEY = "showtimes-local-edit";
const TMDB_KEY_STORAGE_KEY = "tmdb-api-key-local";
const MASONRY_MIN_COLUMN_WIDTH = 280;
const MASONRY_GAP_PX = 16;

const SUPABASE_URL = "https://rjfsjoratsfqcyyjseqm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqZnNqb3JhdHNmcWN5eWpzZXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mzc5MDgsImV4cCI6MjA4ODIxMzkwOH0.dmcQ_ffwmm4JIKTjSUNNYLGQ9w_v1mR6VRMZimVnLNg";

const state = {
  data: { theatreGroups: [] },
  view: "films",
  source: "json",
  publicSearch: {
    films: "",
    theatres: "",
  },
  supabase: null,
  admin: {
    theatreIndex: 0,
    filmIndex: 0,
    theatreQuery: "",
    filmQuery: "",
    theatreHighlight: 0,
    filmHighlight: 0,
    theatreSearching: false,
    filmSearching: false,
    isSaving: false,
    isRefreshingTmdb: false,
    tmdbApiKey: "",
    auth: {
      authenticated: false,
      email: "",
    },
  },
};

const elements = {
  brandLogo: document.querySelector(".brand-logo"),
  controls: document.querySelector(".controls"),
  publicSearchWrap: document.getElementById("publicSearchWrap"),
  publicSearchInput: document.getElementById("publicSearchInput"),
  results: document.getElementById("results"),
  posterLightbox: document.getElementById("posterLightbox"),
  posterLightboxImage: document.getElementById("posterLightboxImage"),
  posterLightboxClose: document.getElementById("posterLightboxClose"),
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
  adminTheatreSearch: document.getElementById("adminTheatreSearch"),
  adminTheatreResults: document.getElementById("adminTheatreResults"),
  addTheatre: document.getElementById("addTheatre"),
  addTheatreModal: document.getElementById("addTheatreModal"),
  addTheatreForm: document.getElementById("addTheatreForm"),
  modalTheatreNameInput: document.getElementById("modalTheatreNameInput"),
  modalTheatreCityInput: document.getElementById("modalTheatreCityInput"),
  modalTheatreAddressInput: document.getElementById("modalTheatreAddressInput"),
  modalTheatreWebsiteInput: document.getElementById("modalTheatreWebsiteInput"),
  tmdbApiKeyInput: document.getElementById("tmdbApiKeyInput"),
  adminFilmSearch: document.getElementById("adminFilmSearch"),
  adminFilmResults: document.getElementById("adminFilmResults"),
  selectedTicketLinkInput: document.getElementById("selectedTicketLinkInput"),
  saveSelectedTicketLink: document.getElementById("saveSelectedTicketLink"),
  addFilm: document.getElementById("addFilm"),
  addFilmModal: document.getElementById("addFilmModal"),
  addFilmForm: document.getElementById("addFilmForm"),
  modalFilmTitleInput: document.getElementById("modalFilmTitleInput"),
  modalFilmYearInput: document.getElementById("modalFilmYearInput"),
  modalFilmTmdbIdInput: document.getElementById("modalFilmTmdbIdInput"),
  cancelAddFilm: document.getElementById("cancelAddFilm"),
  cancelAddTheatre: document.getElementById("cancelAddTheatre"),
  deleteFilm: document.getElementById("deleteFilm"),
  refreshTmdb: document.getElementById("refreshTmdb"),
  showingDateInput: document.getElementById("showingDateInput"),
  showingSpanDaysInput: document.getElementById("showingSpanDaysInput"),
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

let resizeRenderTimeout = null;
let lastViewportWidth = window.innerWidth;
let mobileLogoTapArmed = false;
let mobileLogoArmTimeout = null;

await init();

async function init() {
  initializeSupabase();
  bindEvents();
  updateStickyControlsState();
  await refreshAuthState();
  await loadData();
  initializeAdminState();
  loadAdminSettings();
  syncAdminEditor();
  syncPublicSearchUI();
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
  window.addEventListener("resize", () => {
    const currentWidth = window.innerWidth;
    if (currentWidth === lastViewportWidth) return;
    lastViewportWidth = currentWidth;

    clearTimeout(resizeRenderTimeout);
    resizeRenderTimeout = setTimeout(() => {
      render();
    }, 120);
  });
  window.addEventListener("scroll", updateStickyControlsState, { passive: true });
  window.addEventListener("scroll", disarmMobileLogoTapTarget, { passive: true });

  elements.brandLogo?.addEventListener("click", (event) => {
    const isCoarsePointer = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (!isCoarsePointer) return;

    if (!mobileLogoTapArmed) {
      event.preventDefault();
      armMobileLogoTapTarget();
      return;
    }

    disarmMobileLogoTapTarget();
  });

  elements.results.addEventListener("click", (event) => {
    const poster = event.target.closest(".group-film-poster, .show-poster");
    if (!poster || poster.classList.contains("hidden")) return;
    const src = poster.getAttribute("src");
    if (!src) return;
    openPosterLightbox(src, poster.getAttribute("alt") || "Poster preview");
  });

  elements.posterLightboxClose?.addEventListener("click", () => {
    closePosterLightbox();
  });

  elements.posterLightbox?.addEventListener("click", (event) => {
    if (event.target === elements.posterLightbox) {
      closePosterLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closePosterLightbox();
  });

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.view = tab.dataset.view;
      elements.tabs.forEach((button) => {
        const selected = button === tab;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-selected", String(selected));
      });
      syncPublicSearchUI();
      render();
    });
  });

  elements.publicSearchInput?.addEventListener("input", () => {
    const value = elements.publicSearchInput.value || "";
    if (state.view === "films") {
      state.publicSearch.films = value;
    } else if (state.view === "theatres") {
      state.publicSearch.theatres = value;
    }
    render();
  });

  elements.adminToggle.addEventListener("click", () => {
    const open = elements.adminPanel.classList.toggle("open");
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

  elements.adminTheatreSearch.addEventListener("input", () => {
    state.admin.theatreQuery = elements.adminTheatreSearch.value;
    state.admin.theatreHighlight = 0;
    renderTheatreOptions();
  });

  elements.adminFilmSearch.addEventListener("input", () => {
    state.admin.filmQuery = elements.adminFilmSearch.value;
    state.admin.filmHighlight = 0;
    renderFilmOptions();
  });

  elements.adminTheatreSearch.addEventListener("focus", () => {
    state.admin.theatreSearching = true;
    renderTheatreOptions();
  });

  elements.adminFilmSearch.addEventListener("focus", () => {
    state.admin.filmSearching = true;
    renderFilmOptions();
  });

  elements.adminTheatreSearch.addEventListener("blur", () => {
    setTimeout(() => {
      state.admin.theatreSearching = false;
      renderTheatreOptions();
    }, 120);
  });

  elements.adminFilmSearch.addEventListener("blur", () => {
    setTimeout(() => {
      state.admin.filmSearching = false;
      renderFilmOptions();
    }, 120);
  });

  elements.adminTheatreSearch.addEventListener("keydown", (event) => {
    handleSearchKeydown("theatre", event);
  });

  elements.adminFilmSearch.addEventListener("keydown", (event) => {
    handleSearchKeydown("film", event);
  });

  elements.adminTheatreResults.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (!button) return;
    const previouslySelectedFilm = getSelectedFilm();
    state.admin.theatreIndex = Number(button.dataset.index) || 0;
    state.admin.theatreHighlight = 0;
    state.admin.filmHighlight = 0;
    const theatre = getSelectedTheatre();
    if (previouslySelectedFilm && theatre) {
      state.admin.filmIndex = findFilmIndex(theatre.films || [], previouslySelectedFilm);
      const currentFilm = getSelectedFilm();
      state.admin.filmQuery = currentFilm
        ? buildFilmGroupKey(currentFilm.title, currentFilm.year)
        : "";
    } else {
      state.admin.filmIndex = 0;
      state.admin.filmQuery = "";
    }
    state.admin.theatreQuery = theatre?.name || "";
    syncAdminEditor();
  });

  elements.adminFilmResults.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (!button) return;
    state.admin.filmIndex = Number(button.dataset.index) || 0;
    state.admin.filmHighlight = 0;
    const film = getSelectedFilm();
    state.admin.filmQuery = film ? buildFilmGroupKey(film.title, film.year) : "";
    syncAdminEditor();
  });

  elements.saveSelectedTicketLink.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    const film = getSelectedFilm();
    if (!film) return;
    const rawValue = elements.selectedTicketLinkInput.value.trim();
    const normalizedValue = normalizeOutboundUrl(rawValue);
    const existingValue = normalizeOutboundUrl(film.ticketLink || "");
    if (!rawValue && existingValue) {
      const confirmed = window.confirm(
        "This will clear the existing ticket link for this theatre + film. Continue?"
      );
      if (!confirmed) {
        elements.selectedTicketLinkInput.value = film.ticketLink || "";
        elements.adminMessage.textContent = "Ticket link clear cancelled.";
        return;
      }
    }
    film.ticketLink = normalizedValue;
    syncAdminEditor();
    elements.adminMessage.textContent = "Saved ticket link for selected theatre + film.";
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

  elements.cancelAddFilm.addEventListener("click", () => {
    elements.addFilmModal.close();
  });

  elements.cancelAddTheatre.addEventListener("click", () => {
    elements.addTheatreModal.close();
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
      website: normalizeOutboundUrl(website),
      films: [],
    });
    state.admin.theatreIndex = state.data.theatreGroups.length - 1;
    state.admin.filmIndex = 0;
    state.admin.theatreQuery = name;
    state.admin.filmQuery = "";
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

    if (!title) {
      elements.adminMessage.textContent = "Film title is required.";
      return;
    }
    if (!yearValue && !tmdbIdValue) {
      elements.adminMessage.textContent = "Provide a year or TMDb ID.";
      return;
    }

    const film = {
      title,
      ticketLink: "",
      showings: [],
    };
    if (yearValue) film.year = Number(yearValue);
    if (tmdbIdValue) film.tmdbId = Number(tmdbIdValue);

    addFilmToAllTheatres(film);
    const updatedTheatre = getSelectedTheatre();
    state.admin.filmIndex = findFilmIndex(updatedTheatre?.films || [], film);
    state.admin.filmQuery = buildFilmGroupKey(film.title, film.year);
    elements.addFilmModal.close();
    syncAdminEditor();
    elements.adminMessage.textContent = "Added film to all theatres.";
  });

  elements.deleteFilm.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    const theatre = getSelectedTheatre();
    if (!theatre || !theatre.films.length) return;
    const film = theatre.films[state.admin.filmIndex];
    removeFilmFromAllTheatres(film);
    state.admin.filmIndex = Math.max(0, state.admin.filmIndex - 1);
    state.admin.filmQuery = "";
    syncAdminEditor();
    elements.adminMessage.textContent = "Deleted film from all theatres.";
  });

  elements.refreshTmdb.addEventListener("click", async () => {
    if (!requireAdminAuth()) return;
    if (state.admin.isSaving) {
      elements.adminMessage.textContent = "Save in progress. Try TMDb refresh in a moment.";
      return;
    }
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
      state.admin.isRefreshingTmdb = true;
      syncAdminEditor();
      const details = await fetchTmdbMovieById(state.admin.tmdbApiKey, Number(film.tmdbId));
      film.tmdb = buildTmdbRecord(details);
      syncFilmMetadataAcrossTheatres(film);
      syncAdminEditor();
      elements.adminMessage.textContent = "TMDb details refreshed.";
    } catch (error) {
      elements.adminMessage.textContent = `TMDb refresh failed: ${error.message}`;
    } finally {
      state.admin.isRefreshingTmdb = false;
      syncAdminEditor();
    }
  });

  elements.addShowing.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    const film = getSelectedFilm();
    if (!film) return;
    const date = elements.showingDateInput.value;
    const spanDays = clampSpanDays(elements.showingSpanDaysInput.value);
    const times = parseTimesInput(elements.showingTimesInput.value);
    if (!date || !times.length) {
      elements.adminMessage.textContent = "Add a date and at least one time.";
      return;
    }

    for (let offset = 0; offset < spanDays; offset += 1) {
      const targetDate = addDaysIso(date, offset);
      const existing = film.showings.find((showing) => showing.date === targetDate);
      if (existing) {
        existing.times = Array.from(new Set([...existing.times, ...times])).sort(compareTimes);
      } else {
        film.showings.push({ date: targetDate, times: [...times].sort(compareTimes) });
      }
    }

    film.showings.sort((a, b) => a.date.localeCompare(b.date));
    elements.showingDateInput.value = "";
    elements.showingTimesInput.value = "";
    elements.showingSpanDaysInput.value = "1";
    syncAdminEditor();
    elements.adminMessage.textContent =
      spanDays > 1 ? `Added showings across ${spanDays} days.` : "Added showing.";
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
    if (state.admin.isRefreshingTmdb) {
      elements.adminMessage.textContent = "TMDb refresh in progress. Wait for it to finish before saving.";
      return;
    }
    try {
      state.admin.isSaving = true;
      syncAdminEditor();
      validateData(state.data);
      prunePastShowtimes(state.data);
      await persistData();
      elements.adminMessage.textContent = "All changes saved to Supabase.";
    } catch (error) {
      elements.adminMessage.textContent = `Save failed: ${error.message}. Run latest supabase/schema.sql and try again.`;
    } finally {
      state.admin.isSaving = false;
      syncAdminEditor();
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

function armMobileLogoTapTarget() {
  if (!elements.brandLogo) return;
  mobileLogoTapArmed = true;
  elements.brandLogo.classList.add("is-armed");
  clearTimeout(mobileLogoArmTimeout);
  mobileLogoArmTimeout = setTimeout(() => {
    disarmMobileLogoTapTarget();
  }, 3200);
}

function disarmMobileLogoTapTarget() {
  if (!elements.brandLogo) return;
  mobileLogoTapArmed = false;
  elements.brandLogo.classList.remove("is-armed");
  clearTimeout(mobileLogoArmTimeout);
}

function openPosterLightbox(src, altText) {
  if (!elements.posterLightbox || !elements.posterLightboxImage) return;
  elements.posterLightboxImage.src = src;
  elements.posterLightboxImage.alt = altText;
  elements.posterLightbox.classList.remove("hidden");
  document.body.classList.add("no-scroll");
}

function closePosterLightbox() {
  if (!elements.posterLightbox || !elements.posterLightboxImage) return;
  if (elements.posterLightbox.classList.contains("hidden")) return;
  elements.posterLightbox.classList.add("hidden");
  elements.posterLightboxImage.removeAttribute("src");
  document.body.classList.remove("no-scroll");
}

function updateStickyControlsState() {
  const stickyTop = (elements.controls?.getBoundingClientRect().top || 0) + window.scrollY;
  let progress = 1;
  if (stickyTop > 0) {
    const startFadeAt = stickyTop * 0.75;
    const fadeDistance = Math.max(1, stickyTop - startFadeAt);
    progress = Math.min(1, Math.max(0, (window.scrollY - startFadeAt) / fadeDistance));
  }
  document.documentElement.style.setProperty("--controls-stick-progress", progress.toFixed(3));
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

  const theatreFilmsResult = await state.supabase
    .from("theatre_films")
    .select("theatre_id,film_id,ticket_link");
  if (theatreFilmsResult.error) throw theatreFilmsResult.error;

  const showingsResult = await state.supabase
    .from("showings")
    .select("id,theatre_id,film_id,show_date,times")
    .order("show_date");
  if (showingsResult.error) throw showingsResult.error;

  const theatres = theatresResult.data || [];
  const films = filmsResult.data || [];
  const theatreFilms = theatreFilmsResult.data || [];
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
      ticketLink: filmRow.ticket_link || "",
      tmdb: filmRow.tmdb_json || undefined,
      _dbId: filmRow.id,
    });
  });

  // Global film catalog: every theatre sees every film.
  theatreGroups.forEach((theatre) => {
    filmById.forEach((filmTemplate) => {
      const filmCopy = {
        title: filmTemplate.title,
        year: filmTemplate.year,
        tmdbId: filmTemplate.tmdbId,
        ticketLink: filmTemplate.ticketLink || "",
        tmdb: filmTemplate.tmdb,
        showings: [],
        _dbId: filmTemplate._dbId,
      };
      theatre._filmMap.set(String(filmTemplate._dbId), filmCopy);
      theatre.films.push(filmCopy);
    });
  });

  // Theatre-specific ticket link overrides.
  const effectiveTheatreFilms = theatreFilms.length
    ? theatreFilms
    : buildFallbackTheatreFilmLinks(showings, filmById);

  effectiveTheatreFilms.forEach((linkRow) => {
    const theatre = theatreById.get(linkRow.theatre_id);
    const film = theatre?._filmMap.get(String(linkRow.film_id));
    if (!theatre || !film) return;
    film.ticketLink = linkRow.ticket_link || film.ticketLink || "";
  });

  showings.forEach((showingRow) => {
    const theatre = theatreById.get(showingRow.theatre_id);
    if (!theatre) return;

    const filmKey = String(showingRow.film_id);
    const film = theatre._filmMap.get(filmKey);
    if (!film) return;
    film.showings.push({
      date: showingRow.show_date,
      times: Array.isArray(showingRow.times) ? showingRow.times : [],
    });
  });

  theatreGroups.forEach((theatre) => {
    sortFilms(theatre.films);
    theatre.films.forEach((film) => {
      film.showings.sort((a, b) => a.date.localeCompare(b.date));
    });
    delete theatre._filmMap;
  });

  return { theatreGroups };
}

function buildFallbackTheatreFilmLinks(showings, filmById) {
  const seen = new Set();
  const rows = [];
  showings.forEach((showing) => {
    const key = `${showing.theatre_id}::${showing.film_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const film = filmById.get(showing.film_id);
    rows.push({
      theatre_id: showing.theatre_id,
      film_id: showing.film_id,
      ticket_link: film?.ticketLink || "",
    });
  });
  return rows;
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
      if (typeof film?.ticketLink !== "string") {
        throw new Error(`Film "${film.title}" at "${theatre.name}" has invalid ticketLink.`);
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
  fillSelectedTicketLink();
  renderShowingsList();
  elements.adminJson.value = JSON.stringify(stripInternalFields(state.data), null, 2);
}

function initializeAdminState() {
  state.admin.theatreIndex = 0;
  state.admin.filmIndex = 0;
  state.admin.theatreQuery = "";
  state.admin.filmQuery = "";
  state.admin.theatreHighlight = 0;
  state.admin.filmHighlight = 0;
  state.admin.theatreSearching = false;
  state.admin.filmSearching = false;
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
  elements.adminTheatreSearch.value = state.admin.theatreQuery;
  elements.adminTheatreSearch.disabled = !theatres.length;
  elements.adminTheatreResults.innerHTML = "";
  if (!theatres.length) return;
  if (!state.admin.theatreSearching) return;

  const query = state.admin.theatreQuery.trim().toLowerCase();
  let visibleCount = 0;
  theatres.forEach((theatre, index) => {
    const label = theatre.name || `Theatre ${index + 1}`;
    if (query && !label.toLowerCase().includes(query)) return;
    const highlightIndex = state.admin.theatreHighlight;
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = String(index);
    button.textContent = label;
    if (index === state.admin.theatreIndex) button.classList.add("selected");
    if (visibleCount === highlightIndex) button.classList.add("active");
    li.appendChild(button);
    elements.adminTheatreResults.appendChild(li);
    visibleCount += 1;
  });
  if (visibleCount > 0) {
    state.admin.theatreHighlight = Math.min(state.admin.theatreHighlight, visibleCount - 1);
  } else {
    state.admin.theatreHighlight = 0;
  }
}

function renderFilmOptions() {
  const theatre = getSelectedTheatre();
  const films = theatre?.films || [];
  state.admin.filmIndex = clampIndex(state.admin.filmIndex, films.length);
  elements.adminFilmSearch.value = state.admin.filmQuery;
  elements.adminFilmSearch.disabled = !theatre || !films.length;
  elements.adminFilmResults.innerHTML = "";
  const hasFilm = films.length > 0;
  if (hasFilm && state.admin.filmSearching) {
    const query = state.admin.filmQuery.trim().toLowerCase();
    let visibleCount = 0;
    films.forEach((film, index) => {
      const label = buildFilmGroupKey(film.title, film.year);
      if (query && !label.toLowerCase().includes(query)) return;
      const highlightIndex = state.admin.filmHighlight;
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.index = String(index);
      button.textContent = label;
      if (index === state.admin.filmIndex) button.classList.add("selected");
      if (visibleCount === highlightIndex) button.classList.add("active");
      li.appendChild(button);
      elements.adminFilmResults.appendChild(li);
      visibleCount += 1;
    });
    if (visibleCount > 0) {
      state.admin.filmHighlight = Math.min(state.admin.filmHighlight, visibleCount - 1);
    } else {
      state.admin.filmHighlight = 0;
    }
  }

  elements.addFilm.disabled = !theatre;
  elements.deleteFilm.disabled = !hasFilm;
  elements.refreshTmdb.disabled = !hasFilm || state.admin.isSaving || state.admin.isRefreshingTmdb;
  elements.showingDateInput.disabled = !hasFilm;
  elements.showingTimesInput.disabled = !hasFilm;
  elements.addShowing.disabled = !hasFilm;
  elements.saveAllAdmin.disabled = state.admin.isSaving || state.admin.isRefreshingTmdb;
  elements.saveSelectedTicketLink.disabled = !hasFilm || state.admin.isSaving || state.admin.isRefreshingTmdb;
}

function fillSelectedTicketLink() {
  const film = getSelectedFilm();
  const disabled = !film;
  elements.selectedTicketLinkInput.disabled = disabled;
  elements.saveSelectedTicketLink.disabled =
    disabled || state.admin.isSaving || state.admin.isRefreshingTmdb;
  elements.selectedTicketLinkInput.value = film?.ticketLink || "";
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

function clampSpanDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(30, Math.max(1, Math.floor(parsed)));
}

function addDaysIso(dateIso, daysToAdd) {
  const base = parseIsoDate(dateIso);
  if (!base) return dateIso;
  const next = new Date(base);
  next.setDate(next.getDate() + daysToAdd);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, "0");
  const d = String(next.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function prunePastShowtimes(data) {
  const now = new Date();
  data.theatreGroups.forEach((theatre) => {
    (theatre.films || []).forEach((film) => {
      film.showings = (film.showings || [])
        .map((showing) => {
          const remainingTimes = (showing.times || []).filter((time) => {
            const dt = getShowDateTime(showing.date, time);
            return dt && dt >= now;
          });
          return { ...showing, times: remainingTimes };
        })
        .filter((showing) => showing.times.length > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    });
  });
}

function normalizeOutboundUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  return `https://${raw}`;
}

function addFilmToAllTheatres(baseFilm) {
  state.data.theatreGroups.forEach((theatre) => {
    if (!Array.isArray(theatre.films)) theatre.films = [];
    const exists = theatre.films.some((film) => filmsMatch(film, baseFilm));
    if (!exists) {
      theatre.films.push({
        title: baseFilm.title,
        year: baseFilm.year,
        tmdbId: baseFilm.tmdbId,
        ticketLink: baseFilm.ticketLink,
        tmdb: baseFilm.tmdb,
        showings: [],
      });
    }
    sortFilms(theatre.films);
  });
}

function removeFilmFromAllTheatres(targetFilm) {
  state.data.theatreGroups.forEach((theatre) => {
    theatre.films = (theatre.films || []).filter((film) => !filmsMatch(film, targetFilm));
  });
}

function syncFilmMetadataAcrossTheatres(sourceFilm) {
  state.data.theatreGroups.forEach((theatre) => {
    (theatre.films || []).forEach((film) => {
      if (!filmsMatch(film, sourceFilm)) return;
      film.tmdb = sourceFilm.tmdb;
      if (sourceFilm.tmdbId) film.tmdbId = sourceFilm.tmdbId;
      if (sourceFilm.year) film.year = sourceFilm.year;
    });
  });
}

function filmsMatch(a, b) {
  const aTmdb = Number(a?.tmdbId);
  const bTmdb = Number(b?.tmdbId);
  if (Number.isInteger(aTmdb) && aTmdb > 0 && Number.isInteger(bTmdb) && bTmdb > 0) {
    return aTmdb === bTmdb;
  }
  return normalizeFilmTitle(a?.title) === normalizeFilmTitle(b?.title) && Number(a?.year || 0) === Number(b?.year || 0);
}

function normalizeFilmTitle(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function findFilmIndex(films, targetFilm) {
  const idx = films.findIndex((film) => filmsMatch(film, targetFilm));
  return idx >= 0 ? idx : 0;
}

function sortFilms(films) {
  films.sort((a, b) => buildFilmGroupKey(a.title, a.year).localeCompare(buildFilmGroupKey(b.title, b.year)));
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
  await verifySupabaseSchema(supabase);
  const payload = buildReplacePayload(state.data);
  const rpc = await supabase.rpc("replace_showtimes_data", { payload });
  if (rpc.error) throw rpc.error;
}

async function verifySupabaseSchema(supabase) {
  const checks = await Promise.all([
    supabase.from("theatres").select("id").limit(1),
    supabase.from("films").select("id").limit(1),
    supabase.from("showings").select("id").limit(1),
    supabase.from("theatre_films").select("theatre_id").limit(1),
  ]);
  const failed = checks.find((result) => result.error);
  if (failed?.error) {
    throw new Error(`Supabase schema missing/incompatible (${failed.error.message})`);
  }
}

function buildFilmUniqKey(film) {
  return [
    film.title || "",
    Number.isInteger(Number(film.year)) ? Number(film.year) : "",
    Number.isInteger(Number(film.tmdbId)) ? Number(film.tmdbId) : "",
  ].join("::");
}

function buildReplacePayload(data) {
  const theatres = [];
  const films = [];
  const theatreFilms = [];
  const showings = [];

  const filmKeyByUniq = new Map();
  let theatreCounter = 0;
  let filmCounter = 0;

  data.theatreGroups.forEach((theatre) => {
    const theatreKey = `t_${theatreCounter++}`;
    theatres.push({
      key: theatreKey,
      name: theatre.name,
      city: theatre.city,
      address: theatre.address,
      website: theatre.website,
    });

    (theatre.films || []).forEach((film) => {
      const uniq = buildFilmUniqKey(film);
      let filmKey = filmKeyByUniq.get(uniq);
      if (!filmKey) {
        filmKey = `f_${filmCounter++}`;
        filmKeyByUniq.set(uniq, filmKey);
        films.push({
          key: filmKey,
          title: film.title,
          year: Number.isInteger(Number(film.year)) ? Number(film.year) : null,
          tmdb_id: Number.isInteger(Number(film.tmdbId)) ? Number(film.tmdbId) : null,
          tmdb_json: film.tmdb || null,
        });
      }

      theatreFilms.push({
        theatre_key: theatreKey,
        film_key: filmKey,
        ticket_link: film.ticketLink || "",
      });

      (film.showings || []).forEach((showing) => {
        showings.push({
          theatre_key: theatreKey,
          film_key: filmKey,
          show_date: showing.date,
          times: Array.from(new Set(showing.times || [])).sort(compareTimes),
        });
      });
    });
  });

  return {
    theatres,
    films,
    theatre_films: theatreFilms,
    showings,
  };
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

function handleSearchKeydown(kind, event) {
  const isTheatre = kind === "theatre";
  const resultsEl = isTheatre ? elements.adminTheatreResults : elements.adminFilmResults;
  const buttons = Array.from(resultsEl.querySelectorAll("button[data-index]"));
  if (!buttons.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (isTheatre) {
      state.admin.theatreHighlight = Math.min(state.admin.theatreHighlight + 1, buttons.length - 1);
      renderTheatreOptions();
    } else {
      state.admin.filmHighlight = Math.min(state.admin.filmHighlight + 1, buttons.length - 1);
      renderFilmOptions();
    }
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (isTheatre) {
      state.admin.theatreHighlight = Math.max(state.admin.theatreHighlight - 1, 0);
      renderTheatreOptions();
    } else {
      state.admin.filmHighlight = Math.max(state.admin.filmHighlight - 1, 0);
      renderFilmOptions();
    }
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const index = isTheatre ? state.admin.theatreHighlight : state.admin.filmHighlight;
    const button = buttons[index] || buttons[0];
    button?.click();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    if (isTheatre) {
      state.admin.theatreQuery = "";
      state.admin.theatreHighlight = 0;
      elements.adminTheatreSearch.value = "";
      renderTheatreOptions();
    } else {
      state.admin.filmQuery = "";
      state.admin.filmHighlight = 0;
      elements.adminFilmSearch.value = "";
      renderFilmOptions();
    }
  }
}

function render() {
  const grouped = buildGroups(state.data.theatreGroups, state.view);
  elements.results.classList.add("results-masonry");
  elements.results.dataset.view = state.view;
  elements.results.innerHTML = "";
  const cards = [];

  let entries = Object.entries(grouped);
  const searchQuery = getPublicSearchQueryForView(state.view);
  if (searchQuery) {
    if (state.view === "films") {
      entries = entries.filter(([, group]) => normalizeSearchText(group?.filmInfo?.film).includes(searchQuery));
    } else if (state.view === "theatres") {
      entries = entries.filter(([groupName, group]) => {
        const theatreName = group?.theatreInfo?.name || groupName;
        const theatreCity = group?.theatreInfo?.city || "";
        return (
          normalizeSearchText(theatreName).includes(searchQuery) ||
          normalizeSearchText(theatreCity).includes(searchQuery)
        );
      });
    }
  }
  if (!entries.length) {
    elements.results.innerHTML = '<div class="empty-state">No showtimes found.</div>';
    return;
  }

  if (state.view === "films") {
    entries.sort(([, groupA], [, groupB]) => {
      const titleA = groupA?.filmInfo?.film || "";
      const titleB = groupB?.filmInfo?.film || "";
      const normalizedCompare = normalizeSortTitle(titleA).localeCompare(normalizeSortTitle(titleB));
      if (normalizedCompare !== 0) return normalizedCompare;

      const yearA = Number(groupA?.filmInfo?.year || 0);
      const yearB = Number(groupB?.filmInfo?.year || 0);
      if (yearA !== yearB) return yearA - yearB;

      return titleA.localeCompare(titleB);
    });
  } else {
    entries.sort(([a], [b]) => a.localeCompare(b));
  }

  for (const [groupName, group] of entries) {
    const card = elements.groupTemplate.content.firstElementChild.cloneNode(true);
    const groupTitle = card.querySelector(".group-title");
    if (state.view === "days") {
      groupTitle.textContent = formatDisplayDate(groupName);
    } else if (state.view === "films" && group.filmInfo) {
      groupTitle.textContent = group.filmInfo.film;
      groupTitle.classList.add("group-title-film");
    } else {
      groupTitle.textContent = groupName;
    }
    const subtitle = card.querySelector(".group-subtitle");
    const groupLink = card.querySelector(".group-link");
    const groupFilmSummary = card.querySelector(".group-film-summary");
    const groupFilmPoster = card.querySelector(".group-film-poster");
    const groupFilmFacts = card.querySelector(".group-film-facts");
    const list = card.querySelector(".show-list");
    const shows = group.shows;

    if (group.theatreInfo) {
      subtitle.textContent = `${group.theatreInfo.address}`;
      subtitle.classList.remove("hidden");
      const theatreWebsite = normalizeOutboundUrl(group.theatreInfo.website);
      if (theatreWebsite) {
        groupLink.href = theatreWebsite;
        groupLink.classList.remove("hidden");
      }
    }
    if (state.view === "films" && group.filmInfo) {
      const facts = buildFilmFacts(group.filmInfo);
      if (group.filmInfo.posterUrl) {
        groupFilmPoster.src = group.filmInfo.posterUrl;
        groupFilmPoster.alt = `Poster for ${group.filmInfo.film}`;
        groupFilmPoster.classList.remove("hidden");
      }
      if (facts.length) {
        groupFilmFacts.innerHTML = "";
        facts.forEach((fact) => {
          const row = document.createElement("div");
          row.className = "film-fact";

          const label = document.createElement("span");
          label.className = "film-fact-label";
          label.textContent = fact.label;

          const value = document.createElement("span");
          value.className = "film-fact-value";
          value.textContent = fact.value;

          row.appendChild(label);
          row.appendChild(value);
          groupFilmFacts.appendChild(row);
        });
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
      const filmLabel = show.film;

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

      if (state.view !== "days") {
        const ticketUrl = normalizeOutboundUrl(show.ticketLink);
        if (ticketUrl) {
          link.href = ticketUrl;
          link.classList.remove("hidden");
        }
      }
      if (state.view !== "films" && show.posterUrl) {
        row.classList.add("has-poster");
        poster.src = show.posterUrl;
        poster.alt = `Poster for ${show.film}`;
        poster.classList.remove("hidden");
      }
      list.appendChild(item);
    }

    cards.push(card);
  }

  renderResultCards(cards);
}

function renderResultCards(cards) {
  if (!cards.length) return;

  const columnCount = getMasonryColumnCount();
  if (columnCount <= 1) {
    cards.forEach((card) => elements.results.appendChild(card));
    return;
  }

  const fragment = document.createDocumentFragment();
  const columns = Array.from({ length: columnCount }, () => {
    const column = document.createElement("div");
    column.className = "masonry-column";
    fragment.appendChild(column);
    return column;
  });

  cards.forEach((card, index) => {
    columns[index % columnCount].appendChild(card);
  });

  elements.results.appendChild(fragment);
}

function getMasonryColumnCount() {
  const width = elements.results.clientWidth;
  if (!width) return 1;
  return Math.max(1, Math.floor((width + MASONRY_GAP_PX) / (MASONRY_MIN_COLUMN_WIDTH + MASONRY_GAP_PX)));
}

function syncPublicSearchUI() {
  if (!elements.publicSearchWrap || !elements.publicSearchInput) return;
  if (state.view === "films") {
    elements.publicSearchWrap.classList.remove("hidden");
    elements.publicSearchInput.placeholder = "Search films...";
    elements.publicSearchInput.value = state.publicSearch.films;
    return;
  }
  if (state.view === "theatres") {
    elements.publicSearchWrap.classList.remove("hidden");
    elements.publicSearchInput.placeholder = "Search theatres or town...";
    elements.publicSearchInput.value = state.publicSearch.theatres;
    return;
  }
  elements.publicSearchWrap.classList.add("hidden");
  elements.publicSearchInput.value = "";
}

function getPublicSearchQueryForView(view) {
  if (view === "films") return normalizeSearchText(state.publicSearch.films);
  if (view === "theatres") return normalizeSearchText(state.publicSearch.theatres);
  return "";
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeSortTitle(value) {
  return String(value || "")
    .trim()
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/^the\s+/i, "")
    .toLowerCase();
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

  const visibleEntries = dateEntries.slice(0, 2);
  const hiddenEntries = dateEntries.slice(2);

  visibleEntries.forEach(([date, times]) => {
    container.appendChild(createScheduleRow(date, times));
  });

  if (hiddenEntries.length) {
    const details = document.createElement("details");
    details.className = "show-schedule-collapse";

    const summary = document.createElement("summary");
    summary.className = "show-schedule-summary";
    summary.textContent = `More dates (${hiddenEntries.length})`;
    details.appendChild(summary);

    const extra = document.createElement("div");
    hiddenEntries.forEach(([date, times]) => {
      extra.appendChild(createScheduleRow(date, times));
    });
    details.appendChild(extra);

    container.appendChild(details);
  }
}

function renderTheatreSchedule(container, theatres) {
  container.innerHTML = "";
  const entries = Object.entries(theatres);
  entries.sort(([a], [b]) => a.localeCompare(b));
  entries.forEach(([theatreLabel, times]) => {
    const details = document.createElement("details");
    details.className = "show-schedule-collapse";

    const summary = document.createElement("summary");
    summary.className = "show-schedule-summary";
    summary.textContent = theatreLabel;
    details.appendChild(summary);

    const content = document.createElement("div");
    content.className = "show-schedule-row";
    content.textContent = times.join(", ");
    details.appendChild(content);

    container.appendChild(details);
  });
}

function createScheduleRow(date, times) {
  const row = document.createElement("div");
  row.className = "show-schedule-row";

  const label = document.createElement("span");
  label.className = "show-schedule-day";
  label.textContent = formatDisplayDate(date);

  const value = document.createElement("span");
  value.className = "show-schedule-times";
  value.textContent = times.join(", ");

  row.appendChild(label);
  row.appendChild(value);
  return row;
}

function buildFilmFacts(show) {
  const facts = [];
  if (Number.isInteger(Number(show.year))) {
    facts.push({ label: "Year", value: String(Number(show.year)) });
  }
  if (show.director) {
    facts.push({ label: "Director", value: show.director });
  }
  if (Array.isArray(show.stars) && show.stars.length) {
    facts.push({ label: "Stars", value: show.stars.join(", ") });
  }
  if (Array.isArray(show.genres) && show.genres.length) {
    facts.push({ label: "Genre", value: show.genres.join(", ") });
  }
  return facts;
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
