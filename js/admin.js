// The admin editor. app.js imports this the first time someone opens the Admin panel,
// so visitors never download it. It edits the same `state` the site renders from and
// calls the site's `render` after changes that show on the page.
import {
  getShowDateTime,
  mergeShowtimeNotes,
  normalizeOutboundUrl,
  parseIsoDate,
  slugifyTextSegment,
  to24HourTime,
  toFiniteNumber,
} from "./shared.js";
import {
  PROMO_STORAGE_BUCKET,
  addDaysIso,
  buildFilmGroupKey,
  dedupeSortTimes,
  loadDataFromSupabase,
  normalizeFilmTitle,
  normalizeMetadataSource,
  normalizePosterUrl,
  normalizeSearchText,
  normalizeStringArray,
  sortFilms,
  validateData,
} from "./data.js";

const MAX_ADMIN_SEARCH_RESULTS = 120;
// Where earlier versions kept a TMDb key in the browser; removed on open now that the server holds it.
const OLD_TMDB_KEY_STORAGE_KEY = "tmdb-api-key-local";
// Saves used to keep a copy of all the data here; it outgrew the browser's storage.
const OLD_DRAFT_STORAGE_KEY = "showtimes-local-edit";
const ADMIN_MARKUP_URL = new URL("../admin-panel.html", import.meta.url);
const ADMIN_STYLESHEET_URL = new URL("../css/admin.css", import.meta.url);

let state;
let render;
let elements;
// What the database holds, as buildReplacePayload gives it, as of the last load or save.
// A save sends only what differs from it.
let savedPayload = null;

// Downloads the markup, styles and full data before changing anything else, so if any
// of them fails app.js can simply call this again. Visitors only have the films with
// upcoming showtimes, and a save works out what changed against the full data, so the
// admin never opens without it.
export async function initAdmin(app) {
  if (!app.state.supabase) throw new Error("Supabase is not configured");
  const [markup, , fullData] = await Promise.all([
    fetchAdminMarkup(),
    loadAdminStylesheet(),
    loadDataFromSupabase(app.state.supabase),
  ]);
  ({ state, render } = app);
  applyFullData(fullData);
  document.getElementById("adminPanel").insertAdjacentHTML("beforeend", markup);
  render();
  elements = findAdminElements();
  state.admin = {
    section: "movies",
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
    promoImagesToDelete: [],
    // Edits since the page loaded and how many of them the last save covered.
    changeCount: 0,
    savedChangeCount: 0,
    auth: {
      authenticated: false,
      email: "",
    },
  };
  bindAdminEvents();
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  initializeAdminState();
  await refreshAuthState();
  state.supabase?.auth.onAuthStateChange((_event, session) => {
    state.admin.auth.authenticated = Boolean(session?.user);
    state.admin.auth.email = session?.user?.email || "";
    updateAdminAuthUI();
  });
}

// Called each time the panel opens.
export function showAdminPanel() {
  elements.adminMessage.textContent = state.dataLoadError || "";
  if (elements.adminAuthMessage) {
    elements.adminAuthMessage.classList.remove("admin-message-success");
    elements.adminAuthMessage.textContent = "";
  }
  loadAdminSettings();
  syncAdminEditor();
  syncAdminSectionUI();
  updateAdminAuthUI();
}

// The only place state.source becomes "supabase", which saving and CSV import require.
function applyFullData(fullData) {
  validateData({ theatreGroups: fullData.theatreGroups, festivals: fullData.festivals || [] });
  state.data = { theatreGroups: fullData.theatreGroups, festivals: fullData.festivals || [] };
  state.promotedCards = fullData.promotedCards;
  state.source = "supabase";
  state.loadedFromSupabaseThisSession = true;
  state.dataVersion = fullData.dataVersion;
  state.dataLoadError = "";
  savedPayload = buildSavedPayload();
}

// A copy, since buildReplacePayload shares objects (tmdb_json) that edits change in place.
function buildSavedPayload() {
  return structuredClone(buildReplacePayload(state.data, state.promotedCards));
}

async function fetchAdminMarkup() {
  const response = await fetch(ADMIN_MARKUP_URL);
  if (!response.ok) throw new Error(`admin-panel.html returned ${response.status}`);
  return response.text();
}

// Added after css/styles.css; a link left from an earlier, failed attempt is reused.
function loadAdminStylesheet() {
  const existing = document.getElementById("adminStylesheet");
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.id = "adminStylesheet";
    link.rel = "stylesheet";
    link.href = ADMIN_STYLESHEET_URL.href;
    link.onload = () => resolve();
    link.onerror = () => {
      link.remove();
      reject(new Error("css/admin.css could not load"));
    };
    document.head.appendChild(link);
  });
}

function findAdminElements() {
  return {
    adminIntroText: document.getElementById("adminIntroText"),
    adminAuthGate: document.getElementById("adminAuthGate"),
    adminAuthMessage: document.getElementById("adminAuthMessage"),
    adminControls: document.getElementById("adminControls"),
    adminSectionTabs: Array.from(document.querySelectorAll(".admin-section-tab")),
    adminMoviesPanel: document.getElementById("adminMoviesPanel"),
    adminPromosPanel: document.getElementById("adminPromosPanel"),
    adminFestivalsPanel: document.getElementById("adminFestivalsPanel"),
    adminEmailInput: document.getElementById("adminEmailInput"),
    adminLoginButton: document.getElementById("adminLoginButton"),
    openFilmCatalogButton: document.getElementById("openFilmCatalogButton"),
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
    modalTheatreLatitudeInput: document.getElementById("modalTheatreLatitudeInput"),
    modalTheatreLongitudeInput: document.getElementById("modalTheatreLongitudeInput"),
    adminFilmSearch: document.getElementById("adminFilmSearch"),
    adminFilmResults: document.getElementById("adminFilmResults"),
    adminSearchStatus: document.getElementById("adminSearchStatus"),
    selectedTicketLinkInput: document.getElementById("selectedTicketLinkInput"),
    saveSelectedTicketLink: document.getElementById("saveSelectedTicketLink"),
    openAddPromoModalButton: document.getElementById("openAddPromoModalButton"),
    addPromoModal: document.getElementById("addPromoModal"),
    addPromoForm: document.getElementById("addPromoForm"),
    modalPromoImageInput: document.getElementById("modalPromoImageInput"),
    modalPromoTitleInput: document.getElementById("modalPromoTitleInput"),
    modalPromoButtonUrlInput: document.getElementById("modalPromoButtonUrlInput"),
    cancelAddPromo: document.getElementById("cancelAddPromo"),
    openAddFestivalModalButton: document.getElementById("openAddFestivalModalButton"),
    festivalSettingsList: document.getElementById("festivalSettingsList"),
    addFestivalModal: document.getElementById("addFestivalModal"),
    addFestivalForm: document.getElementById("addFestivalForm"),
    modalFestivalNameInput: document.getElementById("modalFestivalNameInput"),
    modalFestivalSlugInput: document.getElementById("modalFestivalSlugInput"),
    modalFestivalWebsiteInput: document.getElementById("modalFestivalWebsiteInput"),
    modalFestivalPrimaryColorInput: document.getElementById("modalFestivalPrimaryColorInput"),
    modalFestivalStartDateInput: document.getElementById("modalFestivalStartDateInput"),
    modalFestivalEndDateInput: document.getElementById("modalFestivalEndDateInput"),
    modalFestivalDescriptionInput: document.getElementById("modalFestivalDescriptionInput"),
    cancelAddFestival: document.getElementById("cancelAddFestival"),
    addFilm: document.getElementById("addFilm"),
    editFilmMetadata: document.getElementById("editFilmMetadata"),
    addFilmModal: document.getElementById("addFilmModal"),
    addFilmForm: document.getElementById("addFilmForm"),
    modalFilmTitleInput: document.getElementById("modalFilmTitleInput"),
    modalFilmYearInput: document.getElementById("modalFilmYearInput"),
    modalFilmTmdbIdInput: document.getElementById("modalFilmTmdbIdInput"),
    editFilmMetadataModal: document.getElementById("editFilmMetadataModal"),
    editFilmMetadataForm: document.getElementById("editFilmMetadataForm"),
    metadataSourceInput: document.getElementById("metadataSourceInput"),
    metadataPosterUrlInput: document.getElementById("metadataPosterUrlInput"),
    metadataDirectorInput: document.getElementById("metadataDirectorInput"),
    metadataStarsInput: document.getElementById("metadataStarsInput"),
    metadataGenresInput: document.getElementById("metadataGenresInput"),
    metadataReleaseDateInput: document.getElementById("metadataReleaseDateInput"),
    cancelEditFilmMetadata: document.getElementById("cancelEditFilmMetadata"),
    cancelAddFilm: document.getElementById("cancelAddFilm"),
    cancelAddTheatre: document.getElementById("cancelAddTheatre"),
    deleteFilm: document.getElementById("deleteFilm"),
    refreshTmdb: document.getElementById("refreshTmdb"),
    showingDateInput: document.getElementById("showingDateInput"),
    showingSpanDaysInput: document.getElementById("showingSpanDaysInput"),
    showingTimesInput: document.getElementById("showingTimesInput"),
    showingPremiumTimesInput: document.getElementById("showingPremiumTimesInput"),
    showingRoomInput: document.getElementById("showingRoomInput"),
    showingFestivalSelect: document.getElementById("showingFestivalSelect"),
    addShowing: document.getElementById("addShowing"),
    showingsList: document.getElementById("showingsList"),
    promoSettingsList: document.getElementById("promoSettingsList"),
    saveAllAdmin: document.getElementById("saveAllAdmin"),
    adminSaveStatus: document.getElementById("adminSaveStatus"),
    downloadCsvTemplate: document.getElementById("downloadCsvTemplate"),
    uploadCsv: document.getElementById("uploadCsv"),
    adminMessage: document.getElementById("adminMessage"),
  };
}

function bindAdminEvents() {
  elements.adminSectionTabs.forEach((button) => {
    button.addEventListener("click", () => {
      setAdminSection(button.dataset.adminSection);
    });
  });

  elements.adminLoginButton.addEventListener("click", async () => {
    const authMessage = elements.adminAuthMessage || elements.adminMessage;
    if (!state.supabase) {
      authMessage.classList.remove("admin-message-success");
      authMessage.textContent = "Supabase is not configured.";
      return;
    }
    const email = elements.adminEmailInput.value.trim();
    if (!email) {
      authMessage.classList.remove("admin-message-success");
      authMessage.textContent = "Enter your email first.";
      return;
    }

    const { error } = await state.supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });

    if (error) {
      authMessage.classList.remove("admin-message-success");
      authMessage.textContent = `Magic link failed: ${error.message}`;
      return;
    }

    authMessage.classList.add("admin-message-success");
    authMessage.textContent = `Magic link sent to ${email}. Check your inbox for the sign-in link.`;
  });

  elements.adminLogoutButton.addEventListener("click", async () => {
    if (!state.supabase) return;
    await state.supabase.auth.signOut();
    state.admin.auth.authenticated = false;
    state.admin.auth.email = "";
    updateAdminAuthUI();
    elements.adminMessage.textContent = "Logged out.";
  });

  elements.openFilmCatalogButton?.addEventListener("click", () => {
    window.location.href = "admin-films.html";
  });

  elements.promoSettingsList?.addEventListener("change", (event) => {
    if (!requireAdminAuth()) return;
    const control = event.target.closest("[data-promo-index]");
    if (!control) return;
    const promoIndex = Number(control.dataset.promoIndex);
    if (Number.isNaN(promoIndex) || promoIndex < 0 || promoIndex >= state.promotedCards.length) return;
    const promo = state.promotedCards[promoIndex];
    if (!promo) return;

    if (control.dataset.field === "enabled") {
      promo.enabled = control.checked;
    } else if (control.dataset.field === "title") {
      promo.title = String(control.value || "");
    } else if (control.dataset.field === "buttonUrl") {
      promo.buttonUrl = String(control.value || "").trim();
    }

    markUnsaved();
    renderPromoSettingsEditor();
    render();
    elements.adminMessage.textContent = "Promo settings updated.";
  });

  elements.promoSettingsList?.addEventListener("click", (event) => {
    if (!requireAdminAuth()) return;
    const removeButton = event.target.closest("button[data-remove-promo-index]");
    if (!removeButton) return;
    const promoIndex = Number(removeButton.dataset.removePromoIndex);
    if (Number.isNaN(promoIndex) || promoIndex < 0 || promoIndex >= state.promotedCards.length) return;
    const promo = state.promotedCards[promoIndex];
    const label = String(promo?.title || promo?.imageName || "this promo").trim();
    const confirmed = window.confirm(`Delete ${label}?`);
    if (!confirmed) return;
    // The live promo keeps showing this image until the next save, so the file is
    // removed only after that save succeeds.
    if (promo?.imagePath) state.admin.promoImagesToDelete.push(promo.imagePath);
    state.promotedCards.splice(promoIndex, 1);
    markUnsaved();
    renderPromoSettingsEditor();
    render();
    elements.adminMessage.textContent = "Promo removed.";
  });

  elements.openAddPromoModalButton?.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    elements.addPromoForm?.reset();
    elements.addPromoModal?.showModal();
  });

  elements.cancelAddPromo?.addEventListener("click", () => {
    elements.addPromoModal?.close();
  });

  elements.addPromoForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!requireAdminAuth()) return;
    const file = elements.modalPromoImageInput?.files?.[0];
    if (!file) {
      elements.adminMessage.textContent = "Choose an image for the promo first.";
      return;
    }
    if (!state.supabase) {
      elements.adminMessage.textContent = "Supabase is required for promo image uploads.";
      return;
    }
    try {
      const imagePath = await uploadPromoImageToStorage(file);
      const title = String(elements.modalPromoTitleInput?.value || "").trim();
      const buttonUrl = String(elements.modalPromoButtonUrlInput?.value || "").trim();

      state.promotedCards.push({
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        enabled: true,
        title,
        imagePath,
        imageAlt: title || file.name,
        imageName: file.name,
        buttonLabel: "Shop Now",
        buttonUrl,
      });

      markUnsaved();
      renderPromoSettingsEditor();
      render();
      elements.addPromoModal?.close();
      elements.adminMessage.textContent = "Promo added.";
    } catch (error) {
      elements.adminMessage.textContent = `Promo upload failed: ${error.message}`;
    }
  });

  elements.adminTheatreSearch.addEventListener("input", () => {
    state.admin.theatreQuery = elements.adminTheatreSearch.value;
    state.admin.theatreHighlight = 0;
    state.admin.theatreSearching = true;
    renderTheatreOptions();
  });

  elements.adminFilmSearch.addEventListener("input", () => {
    state.admin.filmQuery = elements.adminFilmSearch.value;
    state.admin.filmHighlight = 0;
    state.admin.filmSearching = true;
    renderFilmOptions();
  });

  ["theatre", "film"].forEach((kind) => {
    const { input, results } = getSearchParts(kind);
    input.addEventListener("focus", () => setSearchOpen(kind, true));
    input.addEventListener("click", () => setSearchOpen(kind, true));
    input.addEventListener("blur", () => setSearchOpen(kind, false));
    input.addEventListener("keydown", (event) => handleSearchKeydown(kind, event));
    // Keeps focus in the input when a result is clicked.
    results.addEventListener("mousedown", (event) => event.preventDefault());
  });

  elements.adminTheatreResults.addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");
    if (!option) return;
    const previouslySelectedFilm = getSelectedFilm();
    state.admin.theatreIndex = Number(option.dataset.index) || 0;
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
    state.admin.theatreQuery = getAdminTheatreLabelByIndex(state.admin.theatreIndex);
    state.admin.theatreSearching = false;
    syncAdminEditor();
  });

  elements.adminFilmResults.addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");
    if (!option) return;
    state.admin.filmIndex = Number(option.dataset.index) || 0;
    state.admin.filmHighlight = 0;
    const film = getSelectedFilm();
    state.admin.filmQuery = film ? buildFilmGroupKey(film.title, film.year) : "";
    state.admin.filmSearching = false;
    syncAdminEditor();
  });

  elements.saveSelectedTicketLink.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    if (applyTicketLinkInput()) {
      elements.adminMessage.textContent = "Ticket link updated for the selected theatre + film.";
    }
  });

  elements.selectedTicketLinkInput.addEventListener("input", updateSaveBar);

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

  elements.editFilmMetadata.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    const film = getSelectedFilm();
    if (!film) return;
    const metadata = readEditableFilmMetadata(film);
    const metadataSource = normalizeMetadataSource(film.metadataSource, film);
    elements.metadataSourceInput.value = metadataSource === "tmdb" ? "tmdb" : "manual";
    elements.metadataPosterUrlInput.value = metadata.posterUrl;
    elements.metadataDirectorInput.value = metadata.director;
    elements.metadataStarsInput.value = metadata.stars.join(", ");
    elements.metadataGenresInput.value = metadata.genres.join(", ");
    elements.metadataReleaseDateInput.value = metadata.releaseDate;
    elements.editFilmMetadataModal.showModal();
  });

  elements.cancelEditFilmMetadata?.addEventListener("click", () => {
    elements.editFilmMetadataModal?.close();
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
    const latitudeRaw = elements.modalTheatreLatitudeInput.value.trim();
    const longitudeRaw = elements.modalTheatreLongitudeInput.value.trim();
    if (!name || !city || !address || !website) {
      elements.adminMessage.textContent = "Fill out all theatre fields.";
      return;
    }
    let latitude = null;
    let longitude = null;
    try {
      latitude = parseOptionalCoordinate(latitudeRaw, "latitude", -90, 90);
      longitude = parseOptionalCoordinate(longitudeRaw, "longitude", -180, 180);
    } catch (error) {
      elements.adminMessage.textContent = error.message;
      return;
    }
    if ((latitude === null) !== (longitude === null)) {
      elements.adminMessage.textContent = "Provide both latitude and longitude, or leave both blank.";
      return;
    }

    const theatre = {
      name,
      city,
      address,
      website: normalizeOutboundUrl(website),
      films: [],
    };
    if (latitude !== null && longitude !== null) {
      theatre.latitude = latitude;
      theatre.longitude = longitude;
    }
    state.data.theatreGroups.push(theatre);
    markUnsaved();
    state.admin.theatreIndex = state.data.theatreGroups.length - 1;
    state.admin.filmIndex = 0;
    state.admin.theatreQuery = getAdminTheatreLabelByIndex(state.admin.theatreIndex);
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
      staffFavorite: false,
      staffFavoriteBy: "",
      featuredOnPlayweek: false,
      featuredOnPlayweekUrl: "",
      rankingOverride: false,
      metadataSource: "manual",
      showings: [],
    };
    if (yearValue) film.year = Number(yearValue);
    if (tmdbIdValue) film.tmdbId = Number(tmdbIdValue);

    addFilmToAllTheatres(film);
    markUnsaved();
    const updatedTheatre = getSelectedTheatre();
    state.admin.filmIndex = findFilmIndex(updatedTheatre?.films || [], film);
    state.admin.filmQuery = buildFilmGroupKey(film.title, film.year);
    elements.addFilmModal.close();
    syncAdminEditor();
    elements.adminMessage.textContent = "Added film to all theatres.";
  });

  elements.editFilmMetadataForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requireAdminAuth()) return;

    const film = getSelectedFilm();
    if (!film) return;

    const posterUrlRaw = String(elements.metadataPosterUrlInput.value || "").trim();
    let posterUrl = "";
    if (posterUrlRaw) {
      if (/^https?:\/\//i.test(posterUrlRaw)) {
        posterUrl = posterUrlRaw;
      } else if (posterUrlRaw.startsWith("//")) {
        posterUrl = `https:${posterUrlRaw}`;
      } else {
        elements.adminMessage.textContent = "Poster URL must start with http:// or https://.";
        return;
      }
    }
    const director = String(elements.metadataDirectorInput.value || "").trim();
    const stars = parseCommaSeparatedList(elements.metadataStarsInput.value);
    const genres = parseCommaSeparatedList(elements.metadataGenresInput.value);
    const releaseDate = String(elements.metadataReleaseDateInput.value || "").trim();

    if (releaseDate && !parseIsoDate(releaseDate)) {
      elements.adminMessage.textContent = "Release date must be YYYY-MM-DD.";
      return;
    }

    const nextMetadata = {
      ...(film.tmdb && typeof film.tmdb === "object" ? film.tmdb : {}),
      posterUrl,
      posterPath: "",
      director,
      stars,
      genres,
      releaseDate,
      manualUpdatedAt: new Date().toISOString(),
    };

    film.tmdb = nextMetadata;
    film.metadataSource = "manual";
    syncFilmMetadataAcrossTheatres(film);
    markUnsaved();
    elements.editFilmMetadataModal.close();
    syncAdminEditor();
    elements.adminMessage.textContent = "Film metadata updated.";
  });

  elements.deleteFilm.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    const theatre = getSelectedTheatre();
    if (!theatre || !theatre.films.length) return;
    const film = theatre.films[state.admin.filmIndex];
    const theatresWithLink = countTheatresWithTicketLink(film);
    if (theatresWithLink) {
      elements.adminMessage.textContent =
        `This film can't be deleted here: it has a ticket link at ${theatresWithLink} theatre(s), and saves that clear ticket links are blocked.`;
      return;
    }
    const confirmed = window.confirm(
      `Delete ${buildFilmGroupKey(film.title, film.year)} from all theatres? Its showtimes everywhere are removed when you save.`
    );
    if (!confirmed) return;
    removeFilmFromAllTheatres(film);
    markUnsaved();
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
    if (!film.tmdbId) {
      elements.adminMessage.textContent = "Set a TMDb ID for this film first.";
      return;
    }
    if (normalizeMetadataSource(film.metadataSource, film) === "manual" && hasEditableMetadata(film)) {
      const confirmed = window.confirm(
        "This film currently uses manual metadata. Refreshing TMDb will replace it. Continue?"
      );
      if (!confirmed) {
        elements.adminMessage.textContent = "TMDb refresh cancelled.";
        return;
      }
    }

    try {
      state.admin.isRefreshingTmdb = true;
      syncAdminEditor();
      const details = await fetchTmdbMovieById(Number(film.tmdbId));
      film.tmdb = buildTmdbRecord(details);
      film.metadataSource = "tmdb";
      syncFilmMetadataAcrossTheatres(film);
      markUnsaved();
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
    const premiumTimes = parseTimesInput(elements.showingPremiumTimesInput?.value || "");
    const room = String(elements.showingRoomInput?.value || "").trim();
    const selectedFestivalIdRaw = String(elements.showingFestivalSelect?.value || "").trim();
    const selectedFestivalId = Number(selectedFestivalIdRaw);
    const showingFestivalId =
      selectedFestivalIdRaw && Number.isInteger(selectedFestivalId) && selectedFestivalId > 0
        ? selectedFestivalId
        : null;
    if (!date || (!times.length && !premiumTimes.length)) {
      elements.adminMessage.textContent = "Add a date and at least one standard or premium time.";
      return;
    }
    // The database skips times it can't read, so they would vanish on save.
    const invalidTime = [...times, ...premiumTimes].find((time) => !to24HourTime(time));
    if (invalidTime) {
      elements.adminMessage.textContent = `"${invalidTime}" isn't a valid time. Use h:mm AM/PM, like 7:30 PM.`;
      return;
    }

    for (let offset = 0; offset < spanDays; offset += 1) {
      const targetDate = addDaysIso(date, offset);
      const existing = film.showings.find((showing) => showing.date === targetDate);
      if (existing) {
        existing.times = dedupeSortTimes([...(existing.times || []), ...times]);
        existing.premiumTimes = dedupeSortTimes([...(existing.premiumTimes || []), ...premiumTimes]);
        // Like the CSV import, a blank festival or room keeps the date's existing one.
        if (showingFestivalId) existing.festivalId = showingFestivalId;
        if (room) existing.room = room;
      } else {
        film.showings.push({
          date: targetDate,
          room,
          notes: "",
          festivalId: showingFestivalId,
          times: dedupeSortTimes(times),
          premiumTimes: dedupeSortTimes(premiumTimes),
        });
      }
    }

    film.showings.sort((a, b) => a.date.localeCompare(b.date));
    markUnsaved();
    elements.showingDateInput.value = "";
    elements.showingTimesInput.value = "";
    if (elements.showingPremiumTimesInput) {
      elements.showingPremiumTimesInput.value = "";
    }
    if (elements.showingRoomInput) {
      elements.showingRoomInput.value = "";
    }
    if (elements.showingFestivalSelect) {
      elements.showingFestivalSelect.value = "";
    }
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
    markUnsaved();
    syncAdminEditor();
    elements.adminMessage.textContent = "Deleted showing.";
  });

  const handleSaveAllChanges = async () => {
    if (!requireAdminAuth()) return;
    if (state.admin.isRefreshingTmdb) {
      elements.adminMessage.textContent = "TMDb refresh in progress. Wait for it to finish before saving.";
      return;
    }
    // A ticket link typed but not applied is part of the save.
    if (hasPendingTicketLink() && !applyTicketLinkInput()) return;
    try {
      state.admin.isSaving = true;
      syncAdminEditor();
      validateData(state.data);
      const saveResult = await persistData();
      state.admin.savedChangeCount = state.admin.changeCount;
      elements.adminMessage.textContent = saveResult.saved ? "All changes saved to Supabase." : "No changes to save.";
    } catch (error) {
      elements.adminMessage.textContent = `Save failed: ${error.message}`;
    } finally {
      state.admin.isSaving = false;
      syncAdminEditor();
    }
  };

  elements.saveAllAdmin.addEventListener("click", handleSaveAllChanges);

  elements.festivalSettingsList?.addEventListener("change", (event) => {
    if (!requireAdminAuth()) return;
    const control = event.target.closest("[data-festival-index]");
    if (!control) return;
    const festivalIndex = Number(control.dataset.festivalIndex);
    if (Number.isNaN(festivalIndex) || festivalIndex < 0 || festivalIndex >= (state.data.festivals || []).length) return;
    const festival = state.data.festivals[festivalIndex];
    if (!festival) return;

    if (control.dataset.field === "name") {
      festival.name = String(control.value || "").trim();
      if (!String(festival.slug || "").trim()) {
        festival.slug = slugifyTextSegment(festival.name);
      }
    } else if (control.dataset.field === "slug") {
      festival.slug = slugifyTextSegment(control.value);
    } else if (control.dataset.field === "website") {
      festival.website = String(control.value || "").trim();
    } else if (control.dataset.field === "primaryColor") {
      festival.primaryColor = String(control.value || "").trim();
    } else if (control.dataset.field === "startDate") {
      festival.startDate = String(control.value || "").trim();
    } else if (control.dataset.field === "endDate") {
      festival.endDate = String(control.value || "").trim();
    } else if (control.dataset.field === "description") {
      festival.description = String(control.value || "");
    } else if (control.dataset.field === "enabled") {
      festival.enabled = Boolean(control.checked);
    } else if (control.dataset.field === "sortOrder") {
      const parsed = Number(control.value);
      festival.sortOrder = Number.isInteger(parsed) ? parsed : 0;
    }

    markUnsaved();
    renderFestivalSettingsEditor();
    renderShowingFestivalOptions();
    render();
    elements.adminMessage.textContent = "Festival updated.";
  });

  elements.festivalSettingsList?.addEventListener("click", (event) => {
    if (!requireAdminAuth()) return;
    const removeButton = event.target.closest("button[data-remove-festival-index]");
    if (!removeButton) return;
    const festivalIndex = Number(removeButton.dataset.removeFestivalIndex);
    if (Number.isNaN(festivalIndex) || festivalIndex < 0 || festivalIndex >= (state.data.festivals || []).length) return;
    const festival = state.data.festivals[festivalIndex];
    const label = String(festival?.name || "this festival").trim();
    const confirmed = window.confirm(`Delete ${label}?`);
    if (!confirmed) return;
    const removeFestivalId = Number(festival?.id);
    state.data.festivals.splice(festivalIndex, 1);
    if (Number.isInteger(removeFestivalId) && removeFestivalId > 0) {
      state.data.theatreGroups.forEach((theatre) => {
        (theatre?.films || []).forEach((film) => {
          (film?.showings || []).forEach((showing) => {
            if (Number(showing?.festivalId) === removeFestivalId) {
              showing.festivalId = null;
            }
          });
        });
      });
    }
    markUnsaved();
    syncAdminEditor();
    render();
    elements.adminMessage.textContent = "Festival removed.";
  });

  elements.openAddFestivalModalButton?.addEventListener("click", () => {
    if (!requireAdminAuth()) return;
    elements.addFestivalForm?.reset();
    elements.addFestivalModal?.showModal();
  });

  elements.cancelAddFestival?.addEventListener("click", () => {
    elements.addFestivalModal?.close();
  });

  elements.addFestivalForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requireAdminAuth()) return;
    const name = String(elements.modalFestivalNameInput?.value || "").trim();
    const slugInput = String(elements.modalFestivalSlugInput?.value || "").trim();
    const slug = slugifyTextSegment(slugInput || name);
    if (!name) {
      elements.adminMessage.textContent = "Festival name is required.";
      return;
    }
    if (!slug) {
      elements.adminMessage.textContent = "Festival slug is required.";
      return;
    }
    const duplicateSlug = (state.data.festivals || []).some(
      (festival) => String(festival?.slug || "").trim().toLowerCase() === slug.toLowerCase()
    );
    if (duplicateSlug) {
      elements.adminMessage.textContent = `Festival slug "${slug}" already exists.`;
      return;
    }
    const primaryColor = String(elements.modalFestivalPrimaryColorInput?.value || "").trim();
    if (primaryColor && !isValidCssColor(primaryColor)) {
      elements.adminMessage.textContent = "Primary color is invalid. Use hex like #C54828.";
      return;
    }
    const startDate = String(elements.modalFestivalStartDateInput?.value || "").trim();
    const endDate = String(elements.modalFestivalEndDateInput?.value || "").trim();
    if (startDate && !parseIsoDate(startDate)) {
      elements.adminMessage.textContent = "Start date must be YYYY-MM-DD.";
      return;
    }
    if (endDate && !parseIsoDate(endDate)) {
      elements.adminMessage.textContent = "End date must be YYYY-MM-DD.";
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      elements.adminMessage.textContent = "End date must be on or after start date.";
      return;
    }

    const nextSortOrder = (state.data.festivals || []).length
      ? Math.max(
          ...state.data.festivals.map((festival) => (
            Number.isInteger(Number(festival?.sortOrder)) ? Number(festival.sortOrder) : 0
          ))
        ) + 1
      : 0;
    state.data.festivals.push({
      name,
      slug,
      description: String(elements.modalFestivalDescriptionInput?.value || "").trim(),
      website: String(elements.modalFestivalWebsiteInput?.value || "").trim(),
      primaryColor,
      startDate,
      endDate,
      enabled: true,
      sortOrder: nextSortOrder,
    });
    markUnsaved();
    elements.addFestivalModal?.close();
    syncAdminEditor();
    render();
    elements.adminMessage.textContent = "Festival added.";
  });

  elements.downloadCsvTemplate?.addEventListener("click", () => {
    const header = [
      "theatre_name",
      "theatre_city",
      "film_title",
      "show_date",
      "show_times",
      "premium_show_times",
      "room",
      "notes",
      "festival_name",
      "ticket_link",
      "film_year",
      "film_tmdb_id",
    ];
    const rows = [
      header,
      [
        "Nickelodeon Cinema",
        "Portland",
        "Anora",
        "2026-03-12",
        "6:30 PM|9:15 PM",
        "",
        "",
        "",
        "",
        "https://tickets.example.com/anora",
        "",
        "",
      ],
      ["Nickelodeon Cinema", "Portland", "Anora", "2026-03-13", "4:00 PM|7:45 PM", "9:55 PM", "", "", "", "", "", ""],
    ];
    const csv = rows.map((row) => row.map((value) => toCsvCell(value)).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "showtimes-template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  elements.uploadCsv?.addEventListener("change", async (event) => {
    if (!requireAdminAuth()) return;
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (state.source !== "supabase" || !state.loadedFromSupabaseThisSession) {
        throw new Error(
          "CSV import is disabled because the app is currently using fallback data. Reload until Supabase data loads, then import again."
        );
      }
      const content = await file.text();
      // Preserve _dbId fields so CSV edits map to existing Supabase rows.
      const nextData = JSON.parse(JSON.stringify(state.data));
      const result = importShowtimesCsv(nextData, content);
      validateData(nextData);
      state.data = nextData;
      markUnsaved();
      initializeAdminState();
      syncAdminEditor();
      render();
      let message =
        `Imported CSV: ${result.rowsProcessed} rows, ${result.showingDatesUpdated} showing date entries updated, ${result.filmsCreated || 0} films created.`;
      if (result.createdFilms && result.createdFilms.length > 0) {
        const filmList = result.createdFilms
          .map((f) => `"${f.title}" (${f.theatreName}, ${f.theatreCity})`)
          .join("; ");
        message += ` Added films: ${filmList}.`;
      }
      message += " Click Save to sync Supabase.";
      elements.adminMessage.textContent = message;
      elements.uploadCsv.value = "";
    } catch (error) {
      elements.adminMessage.textContent = `CSV import failed: ${error.message}`;
    }
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
  renderShowingFestivalOptions();
  fillSelectedTicketLink();
  renderShowingsList();
  renderPromoSettingsEditor();
  renderFestivalSettingsEditor();
}

function initializeAdminState() {
  state.admin.section = "movies";
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
  try {
    localStorage.removeItem(OLD_TMDB_KEY_STORAGE_KEY);
    localStorage.removeItem(OLD_DRAFT_STORAGE_KEY);
  } catch {
    // Storage can be blocked; nothing to clean up then.
  }
  renderPromoSettingsEditor();
}

function updateAdminAuthUI() {
  const locked = !state.admin.auth.authenticated;
  elements.adminAuthGate.classList.toggle("hidden", !locked);
  elements.adminControls.classList.toggle("hidden", locked);
  elements.adminIntroText?.classList.toggle("hidden", !locked);
}

function setAdminSection(section) {
  const normalized = section === "promos" || section === "festivals" ? section : "movies";
  state.admin.section = normalized;
  syncAdminSectionUI();
}

function syncAdminSectionUI() {
  const section = state.admin.section === "promos" || state.admin.section === "festivals"
    ? state.admin.section
    : "movies";
  elements.adminSectionTabs.forEach((button) => {
    const selected = button.dataset.adminSection === section;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  elements.adminMoviesPanel?.classList.toggle("hidden", section !== "movies");
  elements.adminPromosPanel?.classList.toggle("hidden", section !== "promos");
  elements.adminFestivalsPanel?.classList.toggle("hidden", section !== "festivals");
}

function renderTheatreOptions() {
  const theatres = state.data.theatreGroups;
  elements.adminTheatreSearch.value = state.admin.theatreQuery;
  elements.adminTheatreSearch.disabled = !theatres.length;
  elements.adminTheatreResults.innerHTML = "";
  if (!theatres.length || !state.admin.theatreSearching) {
    syncSearchCombobox("theatre", 0);
    return;
  }

  const query = normalizeSearchText(state.admin.theatreQuery);
  const duplicateCountByNameCity = buildAdminDuplicateCountByNameCity(theatres);
  let visibleCount = 0;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < theatres.length; index += 1) {
    if (visibleCount >= MAX_ADMIN_SEARCH_RESULTS) break;
    const theatre = theatres[index];
    const label = buildAdminTheatreLabel(theatre, index, duplicateCountByNameCity);
    const searchable = buildAdminTheatreSearchText(theatre, label);
    if (query && !searchable.includes(query)) continue;
    fragment.appendChild(buildSearchOption("theatre", index, label, index === state.admin.theatreIndex));
    visibleCount += 1;
  }
  elements.adminTheatreResults.appendChild(fragment);
  syncSearchCombobox("theatre", visibleCount);
}

function renderFilmOptions() {
  const theatre = getSelectedTheatre();
  const films = theatre?.films || [];
  state.admin.filmIndex = clampIndex(state.admin.filmIndex, films.length);
  elements.adminFilmSearch.value = state.admin.filmQuery;
  elements.adminFilmSearch.disabled = !theatre || !films.length;
  elements.adminFilmResults.innerHTML = "";
  const hasFilm = films.length > 0;
  let visibleCount = 0;
  if (hasFilm && state.admin.filmSearching) {
    const query = normalizeSearchText(state.admin.filmQuery);
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < films.length; index += 1) {
      if (visibleCount >= MAX_ADMIN_SEARCH_RESULTS) break;
      const film = films[index];
      const label = buildFilmGroupKey(film.title, film.year);
      if (query && !normalizeSearchText(label).includes(query)) continue;
      fragment.appendChild(buildSearchOption("film", index, label, index === state.admin.filmIndex));
      visibleCount += 1;
    }
    elements.adminFilmResults.appendChild(fragment);
  }
  syncSearchCombobox("film", visibleCount);

  elements.addFilm.disabled = !theatre;
  elements.editFilmMetadata.disabled = !hasFilm || state.admin.isSaving || state.admin.isRefreshingTmdb;
  elements.deleteFilm.disabled = !hasFilm;
  elements.refreshTmdb.disabled = !hasFilm || state.admin.isSaving || state.admin.isRefreshingTmdb;
  elements.showingDateInput.disabled = !hasFilm;
  elements.showingTimesInput.disabled = !hasFilm;
  if (elements.showingPremiumTimesInput) {
    elements.showingPremiumTimesInput.disabled = !hasFilm;
  }
  if (elements.showingRoomInput) {
    elements.showingRoomInput.disabled = !hasFilm;
  }
  if (elements.showingFestivalSelect) {
    elements.showingFestivalSelect.disabled = !hasFilm;
  }
  elements.addShowing.disabled = !hasFilm;
  elements.saveSelectedTicketLink.disabled = !hasFilm || state.admin.isSaving || state.admin.isRefreshingTmdb;
}

function fillSelectedTicketLink() {
  const film = getSelectedFilm();
  const disabled = !film;
  elements.selectedTicketLinkInput.disabled = disabled;
  elements.saveSelectedTicketLink.disabled =
    disabled || state.admin.isSaving || state.admin.isRefreshingTmdb;
  elements.selectedTicketLinkInput.value = film?.ticketLink || "";
  updateSaveBar();
}

// Copies the ticket link field into the selected film. Returns false if it was refused.
function applyTicketLinkInput() {
  const film = getSelectedFilm();
  if (!film) return false;
  const rawValue = elements.selectedTicketLinkInput.value.trim();
  const normalizedValue = normalizeOutboundUrl(rawValue);
  const existingValue = normalizeOutboundUrl(film.ticketLink || "");
  // Saves that would clear a ticket link are blocked (here and in the database).
  if (!rawValue && existingValue) {
    elements.selectedTicketLinkInput.value = film.ticketLink || "";
    elements.adminMessage.textContent =
      "Ticket links can't be cleared here, because saves that clear one are blocked. Replace it with a new link instead.";
    updateSaveBar();
    return false;
  }
  if (normalizedValue !== existingValue) {
    film.ticketLink = normalizedValue;
    markUnsaved();
  }
  syncAdminEditor();
  return true;
}

function hasPendingTicketLink() {
  const film = getSelectedFilm();
  if (!film || !elements.selectedTicketLinkInput) return false;
  return (
    normalizeOutboundUrl(elements.selectedTicketLinkInput.value.trim()) !==
    normalizeOutboundUrl(film.ticketLink || "")
  );
}

function hasUnsavedChanges() {
  return state.admin.changeCount !== state.admin.savedChangeCount || hasPendingTicketLink();
}

function markUnsaved() {
  state.admin.changeCount += 1;
  updateSaveBar();
}

function updateSaveBar() {
  const unsaved = hasUnsavedChanges();
  elements.saveAllAdmin.disabled = !unsaved || state.admin.isSaving || state.admin.isRefreshingTmdb;
  elements.adminSaveStatus.textContent = state.admin.isSaving
    ? "Saving..."
    : unsaved
      ? "Unsaved changes"
      : "No unsaved changes";
  elements.adminSaveStatus.classList.toggle("unsaved", unsaved && !state.admin.isSaving);
}

function renderShowingFestivalOptions() {
  const select = elements.showingFestivalSelect;
  if (!select) return;
  const previousValue = String(select.value || "");
  select.innerHTML = "";

  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "None";
  select.appendChild(noneOption);

  const festivals = (state.data.festivals || [])
    .filter((festival) => Boolean(festival?.enabled ?? true))
    .sort((a, b) => {
      const orderA = Number.isInteger(Number(a?.sortOrder)) ? Number(a.sortOrder) : 0;
      const orderB = Number.isInteger(Number(b?.sortOrder)) ? Number(b.sortOrder) : 0;
      if (orderA !== orderB) return orderA - orderB;
      return String(a?.name || "").localeCompare(String(b?.name || ""));
    });

  festivals.forEach((festival) => {
    const id = Number(festival?.id);
    if (!Number.isInteger(id) || id <= 0) return;
    const option = document.createElement("option");
    option.value = String(id);
    option.textContent = String(festival?.name || `Festival ${id}`);
    select.appendChild(option);
  });

  if (previousValue && Array.from(select.options).some((option) => option.value === previousValue)) {
    select.value = previousValue;
  } else {
    select.value = "";
  }
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
      const standardTimes = dedupeSortTimes(showing.times || []);
      const premiumTimes = dedupeSortTimes(showing.premiumTimes || []);
      const timeLabelParts = [];
      if (standardTimes.length) {
        timeLabelParts.push(standardTimes.join(", "));
      }
      if (premiumTimes.length) {
        timeLabelParts.push(`Premium: ${premiumTimes.join(", ")}`);
      }
      const festivalId = Number(showing?.festivalId);
      const festival = Number.isInteger(festivalId)
        ? (state.data.festivals || []).find((entry) => Number(entry?.id) === festivalId)
        : null;
      const festivalLabel = festival?.name ? ` [Festival: ${festival.name}]` : "";
      const roomLabel = String(showing?.room || "").trim();
      const notesLabel = String(showing?.notes || "").trim();
      label.textContent = `${showing.date}${festivalLabel}${roomLabel ? ` [Room: ${roomLabel}]` : ""}${notesLabel ? ` [Note: ${notesLabel}]` : ""}: ${timeLabelParts.join(" | ")}`;
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

function renderPromoSettingsEditor() {
  if (!elements.promoSettingsList) return;
  elements.promoSettingsList.innerHTML = "";

  const promos = state.promotedCards || [];
  promos.forEach((promo, index) => {
    const item = document.createElement("article");
    item.className = "promo-settings-item";

    const heading = document.createElement("p");
    heading.className = "promo-settings-heading";
    heading.textContent = promo.imageName || promo.imagePath || "promo-image";

    const enabledWrap = document.createElement("label");
    enabledWrap.className = "promo-settings-toggle";
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.dataset.promoIndex = String(index);
    enabledInput.dataset.field = "enabled";
    enabledInput.checked = Boolean(promo.enabled);
    enabledWrap.appendChild(enabledInput);
    enabledWrap.append(document.createTextNode(" Enabled"));

    const fieldsWrap = document.createElement("div");
    fieldsWrap.className = "promo-settings-fields-wrap";

    const titleLabel = document.createElement("label");
    titleLabel.className = "promo-settings-fields";
    titleLabel.textContent = "Title (optional)";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = String(promo.title || "");
    titleInput.placeholder = "Optional";
    titleInput.dataset.promoIndex = String(index);
    titleInput.dataset.field = "title";
    titleLabel.appendChild(titleInput);

    const buttonLabel = document.createElement("label");
    buttonLabel.className = "promo-settings-fields";
    buttonLabel.textContent = "Button URL";
    const buttonInput = document.createElement("input");
    buttonInput.type = "url";
    buttonInput.value = String(promo.buttonUrl || "");
    buttonInput.placeholder = "https://example.com";
    buttonInput.dataset.promoIndex = String(index);
    buttonInput.dataset.field = "buttonUrl";
    buttonLabel.appendChild(buttonInput);

    fieldsWrap.appendChild(titleLabel);
    fieldsWrap.appendChild(buttonLabel);

    const isEnabled = Boolean(promo.enabled);
    fieldsWrap.classList.toggle("hidden", !isEnabled);

    item.appendChild(heading);
    item.appendChild(enabledWrap);
    item.appendChild(fieldsWrap);
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost-btn promo-remove-btn";
    removeButton.dataset.removePromoIndex = String(index);
    removeButton.textContent = "Delete Promo";
    item.appendChild(removeButton);
    elements.promoSettingsList.appendChild(item);
  });
}

function renderFestivalSettingsEditor() {
  if (!elements.festivalSettingsList) return;
  elements.festivalSettingsList.innerHTML = "";

  const festivals = state.data.festivals || [];
  festivals.forEach((festival, index) => {
    const item = document.createElement("article");
    item.className = "promo-settings-item";

    const heading = document.createElement("p");
    heading.className = "promo-settings-heading";
    heading.textContent = String(festival?.name || "festival").trim() || "festival";

    const enabledWrap = document.createElement("label");
    enabledWrap.className = "promo-settings-toggle";
    const enabledInput = document.createElement("input");
    enabledInput.type = "checkbox";
    enabledInput.dataset.festivalIndex = String(index);
    enabledInput.dataset.field = "enabled";
    enabledInput.checked = Boolean(festival?.enabled ?? true);
    enabledWrap.appendChild(enabledInput);
    enabledWrap.append(document.createTextNode(" Enabled"));

    const fieldsWrap = document.createElement("div");
    fieldsWrap.className = "promo-settings-fields-wrap";

    const nameLabel = document.createElement("label");
    nameLabel.className = "promo-settings-fields";
    nameLabel.textContent = "Name";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = String(festival?.name || "");
    nameInput.dataset.festivalIndex = String(index);
    nameInput.dataset.field = "name";
    nameLabel.appendChild(nameInput);

    const slugLabel = document.createElement("label");
    slugLabel.className = "promo-settings-fields";
    slugLabel.textContent = "Slug";
    const slugInput = document.createElement("input");
    slugInput.type = "text";
    slugInput.value = String(festival?.slug || "");
    slugInput.dataset.festivalIndex = String(index);
    slugInput.dataset.field = "slug";
    slugLabel.appendChild(slugInput);

    const websiteLabel = document.createElement("label");
    websiteLabel.className = "promo-settings-fields";
    websiteLabel.textContent = "Website";
    const websiteInput = document.createElement("input");
    websiteInput.type = "url";
    websiteInput.value = String(festival?.website || "");
    websiteInput.placeholder = "https://...";
    websiteInput.dataset.festivalIndex = String(index);
    websiteInput.dataset.field = "website";
    websiteLabel.appendChild(websiteInput);

    const colorLabel = document.createElement("label");
    colorLabel.className = "promo-settings-fields";
    colorLabel.textContent = "Primary Color";
    const colorInput = document.createElement("input");
    colorInput.type = "text";
    colorInput.value = String(festival?.primaryColor || "");
    colorInput.placeholder = "#C54828";
    colorInput.dataset.festivalIndex = String(index);
    colorInput.dataset.field = "primaryColor";
    colorLabel.appendChild(colorInput);

    const startDateLabel = document.createElement("label");
    startDateLabel.className = "promo-settings-fields";
    startDateLabel.textContent = "Start Date";
    const startDateInput = document.createElement("input");
    startDateInput.type = "date";
    startDateInput.value = String(festival?.startDate || "");
    startDateInput.dataset.festivalIndex = String(index);
    startDateInput.dataset.field = "startDate";
    startDateLabel.appendChild(startDateInput);

    const endDateLabel = document.createElement("label");
    endDateLabel.className = "promo-settings-fields";
    endDateLabel.textContent = "End Date";
    const endDateInput = document.createElement("input");
    endDateInput.type = "date";
    endDateInput.value = String(festival?.endDate || "");
    endDateInput.dataset.festivalIndex = String(index);
    endDateInput.dataset.field = "endDate";
    endDateLabel.appendChild(endDateInput);

    const sortOrderLabel = document.createElement("label");
    sortOrderLabel.className = "promo-settings-fields";
    sortOrderLabel.textContent = "Sort Order";
    const sortOrderInput = document.createElement("input");
    sortOrderInput.type = "number";
    sortOrderInput.step = "1";
    sortOrderInput.value = String(Number.isInteger(Number(festival?.sortOrder)) ? Number(festival.sortOrder) : 0);
    sortOrderInput.dataset.festivalIndex = String(index);
    sortOrderInput.dataset.field = "sortOrder";
    sortOrderLabel.appendChild(sortOrderInput);

    const descriptionLabel = document.createElement("label");
    descriptionLabel.className = "promo-settings-fields";
    descriptionLabel.textContent = "Description";
    const descriptionInput = document.createElement("textarea");
    descriptionInput.rows = 3;
    descriptionInput.value = String(festival?.description || "");
    descriptionInput.dataset.festivalIndex = String(index);
    descriptionInput.dataset.field = "description";
    descriptionLabel.appendChild(descriptionInput);

    fieldsWrap.appendChild(nameLabel);
    fieldsWrap.appendChild(slugLabel);
    fieldsWrap.appendChild(websiteLabel);
    fieldsWrap.appendChild(colorLabel);
    fieldsWrap.appendChild(startDateLabel);
    fieldsWrap.appendChild(endDateLabel);
    fieldsWrap.appendChild(sortOrderLabel);
    fieldsWrap.appendChild(descriptionLabel);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "ghost-btn promo-remove-btn";
    removeButton.dataset.removeFestivalIndex = String(index);
    removeButton.textContent = "Delete Festival";

    item.appendChild(heading);
    item.appendChild(enabledWrap);
    item.appendChild(fieldsWrap);
    item.appendChild(removeButton);
    elements.festivalSettingsList.appendChild(item);
  });
}

function getSelectedTheatre() {
  return state.data.theatreGroups[state.admin.theatreIndex] || null;
}

function buildAdminDuplicateCountByNameCity(theatres) {
  const counts = new Map();
  (theatres || []).forEach((theatre) => {
    const key = buildAdminTheatreNameCityKey(theatre);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
}

function getAdminTheatreLabelByIndex(index) {
  const theatres = state.data.theatreGroups || [];
  const theatre = theatres[index];
  if (!theatre) return "";
  const duplicateCountByNameCity = buildAdminDuplicateCountByNameCity(theatres);
  return buildAdminTheatreLabel(theatre, index, duplicateCountByNameCity);
}

function buildAdminTheatreNameCityKey(theatre) {
  return [
    normalizeSearchText(theatre?.name || ""),
    normalizeSearchText(theatre?.city || ""),
  ].join("::");
}

function buildAdminTheatreLabel(theatre, index, duplicateCountByNameCity) {
  const name = String(theatre?.name || "").trim() || `Theatre ${index + 1}`;
  const city = String(theatre?.city || "").trim();
  const address = String(theatre?.address || "").trim();
  const key = buildAdminTheatreNameCityKey(theatre);
  const hasDuplicateNameCity = (duplicateCountByNameCity?.get(key) || 0) > 1;
  const suffix = city ? ` · ${city}` : "";
  if (!hasDuplicateNameCity || !address) return `${name}${suffix}`;
  return `${name}${suffix} - ${address}`;
}

function buildAdminTheatreSearchText(theatre, label) {
  return normalizeSearchText(
    [
      label || "",
      theatre?.name || "",
      theatre?.city || "",
      theatre?.address || "",
      theatre?.website || "",
    ].join(" ")
  );
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

function importShowtimesCsv(data, csvContent) {
  if (!data || !Array.isArray(data.theatreGroups)) {
    throw new Error("Current data is invalid. Reload before importing CSV.");
  }
  const rows = parseCsvRows(csvContent);
  if (rows.length < 2) {
    throw new Error("CSV must include a header row and at least one data row.");
  }

  const normalizedHeaders = rows[0].map(normalizeCsvHeader);
  const headerIndexByKey = new Map(normalizedHeaders.map((key, index) => [key, index]));
  const requiredHeaders = ["theatre_name", "theatre_city", "film_title", "show_date"];
  const missingHeaders = requiredHeaders.filter((key) => !headerIndexByKey.has(key));
  if (missingHeaders.length) {
    throw new Error(`Missing required CSV header(s): ${missingHeaders.join(", ")}`);
  }
  if (!headerIndexByKey.has("show_times") && !headerIndexByKey.has("premium_show_times")) {
    throw new Error("Missing required CSV header: include show_times, premium_show_times, or both.");
  }

  const stats = {
    rowsProcessed: 0,
    showingDatesUpdated: 0,
    filmsCreated: 0,
    createdFilms: [],
  };

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (isCsvRowBlank(row)) continue;
    const rowNumber = rowIndex + 1;

    const theatreName = readCsvValue(row, headerIndexByKey, "theatre_name");
    const theatreCity = readCsvValue(row, headerIndexByKey, "theatre_city");
    const filmTitle = readCsvValue(row, headerIndexByKey, "film_title");
    const filmYearRaw = readCsvValue(row, headerIndexByKey, "film_year");
    const filmTmdbIdRaw = readCsvValue(row, headerIndexByKey, "film_tmdb_id");
    const ticketLinkRaw = readCsvValue(row, headerIndexByKey, "ticket_link");
    const roomRaw = readCsvValue(row, headerIndexByKey, "room");
    // Like notes, a blank room keeps the stored one and a lone "-" clears it.
    const clearRoom = roomRaw === "-";
    const csvRoom = clearRoom ? "" : roomRaw;
    const notesRaw = readCsvValue(row, headerIndexByKey, "notes");
    // Blank keeps the stored note, a lone "-" clears it, and anything else is merged into it.
    const clearNotes = notesRaw === "-";
    const csvNotes = clearNotes ? "" : notesRaw;
    const festivalNameRaw = readCsvValue(row, headerIndexByKey, "festival_name");
    const showDate = readCsvValue(row, headerIndexByKey, "show_date");
    const showTimesRaw = readCsvValue(row, headerIndexByKey, "show_times");
    const premiumShowTimesRaw = readCsvValue(row, headerIndexByKey, "premium_show_times");

    if (!theatreName) throw new Error(`Row ${rowNumber}: theatre_name is required.`);
    if (!theatreCity) throw new Error(`Row ${rowNumber}: theatre_city is required.`);
    if (!filmTitle) throw new Error(`Row ${rowNumber}: film_title is required.`);
    if (!showDate) throw new Error(`Row ${rowNumber}: show_date is required.`);
    if (!parseIsoDate(showDate)) {
      throw new Error(`Row ${rowNumber}: show_date must be YYYY-MM-DD.`);
    }

    const filmYear = parseOptionalCsvInteger(filmYearRaw, "film_year", rowNumber);
    const filmTmdbId = parseOptionalCsvInteger(filmTmdbIdRaw, "film_tmdb_id", rowNumber);
    if (filmTmdbId !== null && filmTmdbId <= 0) {
      throw new Error(`Row ${rowNumber}: film_tmdb_id must be greater than 0.`);
    }

    const parsedTimes = parseCsvTimesField(showTimesRaw);
    const parsedPremiumTimes = parseCsvTimesField(premiumShowTimesRaw);
    if (!parsedTimes.length && !parsedPremiumTimes.length) {
      throw new Error(`Row ${rowNumber}: include at least one value in show_times or premium_show_times.`);
    }
    const invalidTime = parsedTimes.find((time) => !to24HourTime(time));
    if (invalidTime) {
      throw new Error(`Row ${rowNumber}: invalid time "${invalidTime}". Use h:mm AM/PM.`);
    }
    const invalidPremiumTime = parsedPremiumTimes.find((time) => !to24HourTime(time));
    if (invalidPremiumTime) {
      throw new Error(`Row ${rowNumber}: invalid premium time "${invalidPremiumTime}". Use h:mm AM/PM.`);
    }

    const theatreMatches = data.theatreGroups.filter(
      (entry) => normalizeSearchText(entry?.name) === normalizeSearchText(theatreName)
    );
    if (!theatreMatches.length) {
      throw new Error(`Row ${rowNumber}: theatre "${theatreName}" was not found. Add it in admin first.`);
    }
    const inputCityExact = normalizeSearchText(theatreCity);
    const inputCityLoose = normalizeCityMatchText(theatreCity);
    let theatre = theatreMatches.find((entry) => normalizeSearchText(entry?.city) === inputCityExact);
    if (!theatre) {
      theatre = theatreMatches.find((entry) => normalizeCityMatchText(entry?.city) === inputCityLoose);
    }
    if (!theatre && theatreMatches.length === 1) {
      theatre = theatreMatches[0];
    }
    if (!theatre) {
      const availableCities = theatreMatches.map((entry) => String(entry?.city || "").trim()).filter(Boolean).join(", ");
      throw new Error(
        `Row ${rowNumber}: theatre "${theatreName}" with city "${theatreCity}" was not found.${availableCities ? ` Available cities: ${availableCities}.` : ""}`
      );
    }

    if (!Array.isArray(theatre.films)) theatre.films = [];
    const filmMatches = theatre.films.filter((entry) => {
      if (normalizeFilmTitle(entry?.title) !== normalizeFilmTitle(filmTitle)) return false;
      if (filmTmdbId !== null) return Number(entry?.tmdbId) === filmTmdbId;
      if (filmYear !== null) return Number(entry?.year) === filmYear;
      return true;
    });
    let film = filmMatches[0];
    if (!filmMatches.length) {
      film = {
        title: filmTitle,
        ticketLink: "",
        staffFavorite: false,
        staffFavoriteBy: "",
        featuredOnPlayweek: false,
        featuredOnPlayweekUrl: "",
        rankingOverride: false,
        metadataSource: filmTmdbId !== null ? "tmdb" : "manual",
        showings: [],
      };
      if (filmYear !== null) film.year = filmYear;
      if (filmTmdbId !== null) film.tmdbId = filmTmdbId;
      theatre.films.push(film);
      sortFilms(theatre.films);
      stats.filmsCreated += 1;
      stats.createdFilms.push({ title: filmTitle, theatreName: theatre.name, theatreCity: theatre.city });
    } else if (filmMatches.length > 1 && filmTmdbId === null && filmYear === null) {
      throw new Error(
        `Row ${rowNumber}: multiple "${filmTitle}" entries at "${theatre.name}". Include film_year or film_tmdb_id.`
      );
    }
    let resolvedFestivalId = null;
    if (festivalNameRaw) {
      const matchedFestival = (data.festivals || []).find(
        (festival) => normalizeSearchText(festival?.name) === normalizeSearchText(festivalNameRaw)
      );
      if (!matchedFestival) {
        throw new Error(
          `Row ${rowNumber}: festival "${festivalNameRaw}" was not found. Add it first in festivals admin.`
        );
      }
      const festivalId = Number(matchedFestival?.id);
      if (!Number.isInteger(festivalId) || festivalId <= 0) {
        throw new Error(`Row ${rowNumber}: festival "${festivalNameRaw}" is missing a valid id.`);
      }
      resolvedFestivalId = festivalId;
    }
    if (ticketLinkRaw) {
      film.ticketLink = normalizeOutboundUrl(ticketLinkRaw);
    }

    if (!Array.isArray(film.showings)) film.showings = [];
    const showing = film.showings.find((entry) => entry.date === showDate);
    if (showing) {
      const beforeCount = (Array.isArray(showing.times) ? showing.times.length : 0) +
        (Array.isArray(showing.premiumTimes) ? showing.premiumTimes.length : 0);
      showing.times = dedupeSortTimes([...(showing.times || []), ...parsedTimes]);
      showing.premiumTimes = dedupeSortTimes([...(showing.premiumTimes || []), ...parsedPremiumTimes]);
      if (clearRoom || csvRoom) showing.room = csvRoom;
      if (clearNotes) showing.notes = "";
      else if (csvNotes) showing.notes = mergeShowtimeNotes(showing.notes, csvNotes);
      if (resolvedFestivalId) {
        showing.festivalId = resolvedFestivalId;
      }
      const afterCount = showing.times.length + showing.premiumTimes.length;
      if (afterCount !== beforeCount) {
        stats.showingDatesUpdated += 1;
      }
    } else {
      film.showings.push({
        date: showDate,
        room: csvRoom,
        notes: csvNotes,
        festivalId: resolvedFestivalId,
        times: dedupeSortTimes(parsedTimes),
        premiumTimes: dedupeSortTimes(parsedPremiumTimes),
      });
      film.showings.sort((a, b) => a.date.localeCompare(b.date));
      stats.showingDatesUpdated += 1;
    }

    stats.rowsProcessed += 1;
  }

  return stats;
}

function parseCsvRows(input) {
  const text = String(input || "").replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }

  if (inQuotes) {
    throw new Error("CSV has an unclosed quoted field.");
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length && rows[0].length) {
    rows[0][0] = String(rows[0][0] || "").replace(/^\uFEFF/, "");
  }

  return rows;
}

function toCsvCell(value) {
  const text = String(value || "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function normalizeCsvHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readCsvValue(row, headerIndexByKey, header) {
  const idx = headerIndexByKey.get(header);
  if (typeof idx !== "number") return "";
  return String(row[idx] || "").trim();
}

function parseOptionalCsvInteger(value, fieldLabel, rowNumber) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`Row ${rowNumber}: ${fieldLabel} must be an integer when provided.`);
  }
  return Number(raw);
}

function parseCsvTimesField(value) {
  return String(value || "")
    .split(/[|;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isCsvRowBlank(row) {
  return !row.some((value) => String(value || "").trim());
}

function clampSpanDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(30, Math.max(1, Math.floor(parsed)));
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
          const remainingPremiumTimes = (showing.premiumTimes || []).filter((time) => {
            const dt = getShowDateTime(showing.date, time);
            return dt && dt >= now;
          });
          return {
            ...showing,
            times: dedupeSortTimes(remainingTimes),
            premiumTimes: dedupeSortTimes(remainingPremiumTimes),
          };
        })
        .filter((showing) => showing.times.length > 0 || showing.premiumTimes.length > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
    });
  });
}

function parseCommaSeparatedList(value) {
  return String(value || "")
    .split(/[;,|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readEditableFilmMetadata(film) {
  const tmdb = film?.tmdb && typeof film.tmdb === "object" ? film.tmdb : {};
  const posterUrl = normalizePosterUrl(tmdb.posterUrl || tmdb.posterPath || "");
  const director = typeof tmdb.director === "string" ? tmdb.director.trim() : "";
  const stars = normalizeStringArray(tmdb.stars);
  const genres = normalizeStringArray(tmdb.genres);
  const releaseDate = String(tmdb.releaseDate || tmdb.release_date || "").trim();
  return { posterUrl, director, stars, genres, releaseDate };
}

function hasEditableMetadata(film) {
  const metadata = readEditableFilmMetadata(film);
  return Boolean(
    metadata.posterUrl ||
      metadata.director ||
      metadata.releaseDate ||
      metadata.stars.length ||
      metadata.genres.length
  );
}

function mergeMetadataSource(existing, incoming) {
  if (existing === "manual" || incoming === "manual") return "manual";
  return "tmdb";
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
        staffFavorite: Boolean(baseFilm.staffFavorite),
        staffFavoriteBy: String(baseFilm.staffFavoriteBy || ""),
        featuredOnPlayweek: Boolean(baseFilm.featuredOnPlayweek),
        featuredOnPlayweekUrl: String(baseFilm.featuredOnPlayweekUrl || ""),
        metadataSource: normalizeMetadataSource(baseFilm.metadataSource, baseFilm),
        tmdb: baseFilm.tmdb,
        showings: [],
      });
    }
    sortFilms(theatre.films);
  });
}

function countTheatresWithTicketLink(targetFilm) {
  return state.data.theatreGroups.filter((theatre) =>
    (theatre.films || []).some(
      (film) => filmsMatch(film, targetFilm) && String(film.ticketLink || "").trim()
    )
  ).length;
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
      film.metadataSource = normalizeMetadataSource(sourceFilm.metadataSource, sourceFilm);
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

function findFilmIndex(films, targetFilm) {
  const idx = films.findIndex((film) => filmsMatch(film, targetFilm));
  return idx >= 0 ? idx : 0;
}

async function persistData() {
  if (!state.supabase || !state.admin.auth.authenticated) {
    syncAdminEditor();
    render();
    return { saved: false };
  }
  const changes = buildChangesPayload(savedPayload, buildReplacePayload(state.data, state.promotedCards));
  if (changes) {
    const version = await saveChangesToSupabase(changes);
    if (changesAddRows(changes)) {
      // New rows need their ids, and a new film or theatre joins every theatre's catalog.
      applyFullData(await loadDataFromSupabase(state.supabase));
    } else {
      // The admin already has what was saved, less the showtimes the save found started.
      state.dataVersion = version;
      prunePastShowtimes(state.data);
      savedPayload = buildSavedPayload();
    }
  }
  await deleteRemovedPromoImages();
  syncAdminEditor();
  render();
  return { saved: Boolean(changes) };
}

async function saveChangesToSupabase(changes) {
  if (state.source !== "supabase" || !state.loadedFromSupabaseThisSession) {
    throw new Error(
      "Blocked save: current admin data was not loaded from Supabase. Reload the page and try again."
    );
  }
  // apply_showtimes_changes makes the safety checks itself: it refuses saves that would
  // clear a ticket link, delete many rows, or overwrite data that changed since loading.
  const { data: version, error } = await state.supabase.rpc("apply_showtimes_changes", {
    changes,
    expected_version: state.dataVersion,
  });
  if (error) throw error;
  return version;
}

// The rows added, changed or removed between two payloads from buildReplacePayload, or
// null if there are none. Rows are matched on their database id, and ones without an id
// are new. Showtimes are compared a day (theatre, film and date) at a time, and a changed
// day is sent whole. Ticket links and days name their theatre and film by id, or by the
// payload key of a new one.
function buildChangesPayload(before, after) {
  const rowRefs = (rows) => {
    const seen = new Set();
    return new Map(
      rows.map((row) => {
        // A second row with the same id is saved as a new row, as the full save did.
        if (row.db_id != null && seen.has(row.db_id)) row.db_id = null;
        if (row.db_id != null) seen.add(row.db_id);
        const ref = row.db_id != null ? `id:${row.db_id}` : `new:${row.key}`;
        return [row.key, { ref, db_id: row.db_id, key: row.key }];
      })
    );
  };
  const locator = (payload) => {
    const theatres = rowRefs(payload.theatres);
    const films = rowRefs(payload.films);
    return (item) => {
      const theatre = theatres.get(item.theatre_key);
      const film = films.get(item.film_key);
      return {
        ref: `${theatre.ref}|${film.ref}`,
        names: { theatre_db_id: theatre.db_id, theatre_key: theatre.key, film_db_id: film.db_id, film_key: film.key },
      };
    };
  };
  const locateBefore = locator(before);
  const locateAfter = locator(after);

  // Keys are positions in the payload, so they don't count as a change.
  const sameRow = (a, b) => JSON.stringify({ ...a, key: undefined }) === JSON.stringify({ ...b, key: undefined });
  const diffRows = (beforeRows, afterRows, idField) => {
    const beforeById = new Map(beforeRows.filter((row) => row[idField] != null).map((row) => [row[idField], row]));
    const kept = new Set();
    const upsert = afterRows.filter((row) => {
      if (row[idField] == null) return true;
      kept.add(row[idField]);
      const previous = beforeById.get(row[idField]);
      return !previous || !sameRow(previous, row);
    });
    return { upsert, delete: [...beforeById.keys()].filter((id) => !kept.has(id)) };
  };

  const linksBy = (payload, locate) =>
    new Map(
      payload.theatre_films.map((link) => {
        const at = locate(link);
        return [at.ref, { ...at.names, ticket_link: link.ticket_link }];
      })
    );
  const linksBefore = linksBy(before, locateBefore);
  const linksAfter = linksBy(after, locateAfter);

  const daysBy = (payload, locate) => {
    const days = new Map();
    payload.showings.forEach(({ theatre_key, film_key, ...showing }) => {
      const at = locate({ theatre_key, film_key });
      const ref = `${at.ref}|${showing.show_date}`;
      if (!days.has(ref)) days.set(ref, { day: { ...at.names, show_date: showing.show_date }, showings: [] });
      days.get(ref).showings.push(showing);
    });
    return days;
  };
  const daysBefore = daysBy(before, locateBefore);
  const daysAfter = daysBy(after, locateAfter);
  const days = [];
  const entries = [];
  daysAfter.forEach(({ day, showings }, ref) => {
    const previous = daysBefore.get(ref);
    if (previous && JSON.stringify(previous.showings) === JSON.stringify(showings)) return;
    days.push(day);
    showings.forEach((showing) => entries.push({ ...showing, ...day }));
  });
  // A day that's gone is sent with no entries, which clears it.
  daysBefore.forEach(({ day }, ref) => {
    if (!daysAfter.has(ref)) days.push(day);
  });

  const changes = {
    festivals: diffRows(before.festivals, after.festivals, "id"),
    theatres: diffRows(before.theatres, after.theatres, "db_id"),
    films: diffRows(before.films, after.films, "db_id"),
    promos: diffRows(before.promos, after.promos, "db_id"),
    theatre_films: {
      upsert: [...linksAfter].filter(([ref, link]) => linksBefore.get(ref)?.ticket_link !== link.ticket_link).map(([, link]) => link),
      delete: [...linksBefore]
        .filter(([ref]) => !linksAfter.has(ref))
        .map(([, link]) => ({ theatre_db_id: link.theatre_db_id, film_db_id: link.film_db_id })),
    },
    showings: { days, entries },
  };
  const hasChanges = Object.values(changes).some((table) => Object.values(table).some((rows) => rows.length));
  return hasChanges ? changes : null;
}

function changesAddRows(changes) {
  return (
    changes.festivals.upsert.some((row) => row.id == null) ||
    ["theatres", "films", "promos"].some((table) => changes[table].upsert.some((row) => row.db_id == null))
  );
}

function buildFilmUniqKey(film) {
  return [
    film.title || "",
    Number.isInteger(Number(film.year)) ? Number(film.year) : "",
    Number.isInteger(Number(film.tmdbId)) ? Number(film.tmdbId) : "",
  ].join("::");
}

function buildReplacePayload(data, promotedCards) {
  const theatres = [];
  const films = [];
  const theatreFilms = [];
  const showings = [];
  const festivals = [];
  const festivalSlugByDbId = new Map();

  const filmKeyByUniq = new Map();
  const filmPayloadIndexByKey = new Map();
  let theatreCounter = 0;
  let filmCounter = 0;
  const festivalDbIdByName = new Map();

  (data.festivals || []).forEach((festival, index) => {
    const name = String(festival?.name || "").trim();
    const slug = String(festival?.slug || "").trim();
    if (!name || !slug) return;
    const dbId = Number.isInteger(Number(festival?.id)) ? Number(festival.id) : null;
    festivals.push({
      id: dbId,
      slug,
      name,
      description: String(festival?.description || "").trim(),
      website: String(festival?.website || "").trim(),
      primary_color: String(festival?.primaryColor || "").trim(),
      start_date: String(festival?.startDate || "").trim() || null,
      end_date: String(festival?.endDate || "").trim() || null,
      enabled: Boolean(festival?.enabled ?? true),
      sort_order: Number.isInteger(Number(festival?.sortOrder)) ? Number(festival.sortOrder) : index,
    });
    festivalDbIdByName.set(normalizeSearchText(name), dbId);
    if (dbId) {
      festivalSlugByDbId.set(dbId, slug);
    }
  });

  data.theatreGroups.forEach((theatre) => {
    const theatreKey = `t_${theatreCounter++}`;
    theatres.push({
      key: theatreKey,
      db_id: Number.isInteger(Number(theatre._dbId)) ? Number(theatre._dbId) : null,
      name: theatre.name,
      city: theatre.city,
      address: theatre.address,
      website: theatre.website,
      latitude: Number.isFinite(Number(theatre.latitude)) ? Number(theatre.latitude) : null,
      longitude: Number.isFinite(Number(theatre.longitude)) ? Number(theatre.longitude) : null,
    });

    (theatre.films || []).forEach((film) => {
      const uniq = buildFilmUniqKey(film);
      let filmKey = filmKeyByUniq.get(uniq);
      if (!filmKey) {
        filmKey = `f_${filmCounter++}`;
        filmKeyByUniq.set(uniq, filmKey);
        films.push({
          key: filmKey,
          db_id: Number.isInteger(Number(film._dbId)) ? Number(film._dbId) : null,
          title: film.title,
          year: Number.isInteger(Number(film.year)) ? Number(film.year) : null,
          tmdb_id: Number.isInteger(Number(film.tmdbId)) ? Number(film.tmdbId) : null,
          synopsis: extractFilmSynopsis(film),
          metadata_source: normalizeMetadataSource(film.metadataSource, film),
          staff_favorite: Boolean(film.staffFavorite),
          staff_favorite_by: String(film.staffFavoriteBy || "").trim(),
          featured_on_playweek: Boolean(film.featuredOnPlayweek),
          featured_on_playweek_url: String(film.featuredOnPlayweekUrl || "").trim(),
          ranking_override: Boolean(film.rankingOverride),
          tmdb_json: film.tmdb || null,
        });
        filmPayloadIndexByKey.set(filmKey, films.length - 1);
      } else {
        const filmTicketLink = String(film.ticketLink || "").trim();
        const existingFilmIndex = filmPayloadIndexByKey.get(filmKey);
        if (typeof existingFilmIndex === "number") {
          const incomingMetadataSource = normalizeMetadataSource(film.metadataSource, film);
          films[existingFilmIndex].metadata_source = mergeMetadataSource(
            films[existingFilmIndex].metadata_source,
            incomingMetadataSource
          );
          if (!films[existingFilmIndex].synopsis) {
            films[existingFilmIndex].synopsis = extractFilmSynopsis(film);
          }
          if (
            film.tmdb &&
            (films[existingFilmIndex].tmdb_json == null || incomingMetadataSource === "manual")
          ) {
            films[existingFilmIndex].tmdb_json = film.tmdb;
          }
        }
        if (typeof existingFilmIndex === "number" && Boolean(film.staffFavorite)) {
          films[existingFilmIndex].staff_favorite = true;
          if (!films[existingFilmIndex].staff_favorite_by) {
            films[existingFilmIndex].staff_favorite_by = String(film.staffFavoriteBy || "").trim();
          }
        }
        if (typeof existingFilmIndex === "number" && Boolean(film.featuredOnPlayweek)) {
          films[existingFilmIndex].featured_on_playweek = true;
          if (!films[existingFilmIndex].featured_on_playweek_url) {
            films[existingFilmIndex].featured_on_playweek_url = String(film.featuredOnPlayweekUrl || "").trim();
          }
        }
        if (typeof existingFilmIndex === "number" && Boolean(film.rankingOverride)) {
          films[existingFilmIndex].ranking_override = true;
        }
        if (filmTicketLink) {
          if (typeof existingFilmIndex === "number" && !films[existingFilmIndex].db_id) {
            const filmDbId = Number.isInteger(Number(film._dbId)) ? Number(film._dbId) : null;
            if (filmDbId) films[existingFilmIndex].db_id = filmDbId;
          }
        }
      }

      const theatreFilmTicketLink = String(film.ticketLink || "").trim();
      if (theatreFilmTicketLink) {
        theatreFilms.push({
          theatre_key: theatreKey,
          film_key: filmKey,
          theatre_db_id: Number.isInteger(Number(theatre._dbId)) ? Number(theatre._dbId) : null,
          film_db_id: Number.isInteger(Number(film._dbId)) ? Number(film._dbId) : null,
          ticket_link: theatreFilmTicketLink,
        });
      }

      (film.showings || []).forEach((showing) => {
        const showingFestivalId = Number.isInteger(Number(showing?.festivalId))
          ? Number(showing.festivalId)
          : (festivalDbIdByName.get(normalizeSearchText(showing?.festivalName || "")) ?? null);
        showings.push({
          theatre_key: theatreKey,
          film_key: filmKey,
          festival_id: showingFestivalId,
          festival_slug: showingFestivalId ? (festivalSlugByDbId.get(showingFestivalId) || "") : "",
          show_date: showing.date,
          room: String(showing?.room || "").trim(),
          notes: String(showing?.notes || "").trim(),
          times: dedupeSortTimes(showing.times || []),
          premium_times: dedupeSortTimes(showing.premiumTimes || []),
        });
      });
    });
  });

  return {
    theatres,
    films,
    festivals,
    theatre_films: theatreFilms,
    showings,
    promos: buildPromosReplacePayload(promotedCards),
  };
}

function extractFilmSynopsis(film) {
  const directSynopsis = String(film?.synopsis || "").trim();
  if (directSynopsis) return directSynopsis;
  const tmdbSynopsis = String(film?.tmdb?.overview || "").trim();
  return tmdbSynopsis;
}

function requireAdminAuth() {
  if (state.admin.auth.authenticated) return true;
  elements.adminMessage.textContent = "Sign in first to edit admin data.";
  return false;
}

// The theatre and film searches are ARIA comboboxes: focus stays in the input, and
// aria-activedescendant tells screen readers which result the arrow keys are on.
function getSearchParts(kind) {
  return kind === "theatre"
    ? {
        input: elements.adminTheatreSearch,
        results: elements.adminTheatreResults,
        searchingKey: "theatreSearching",
        highlightKey: "theatreHighlight",
        queryKey: "theatreQuery",
        render: renderTheatreOptions,
      }
    : {
        input: elements.adminFilmSearch,
        results: elements.adminFilmResults,
        searchingKey: "filmSearching",
        highlightKey: "filmHighlight",
        queryKey: "filmQuery",
        render: renderFilmOptions,
      };
}

function buildSearchOption(kind, index, label, isCurrent) {
  const li = document.createElement("li");
  li.id = `admin-${kind}-option-${index}`;
  li.setAttribute("role", "option");
  li.setAttribute("aria-selected", "false");
  li.dataset.index = String(index);
  li.textContent = label;
  if (isCurrent) li.classList.add("selected");
  return li;
}

function syncSearchCombobox(kind, visibleCount) {
  const { input, results, searchingKey, highlightKey } = getSearchParts(kind);
  state.admin[highlightKey] = visibleCount > 0 ? Math.min(state.admin[highlightKey], visibleCount - 1) : 0;
  const active = visibleCount > 0 ? results.children[state.admin[highlightKey]] : null;
  if (active) {
    active.classList.add("active");
    active.setAttribute("aria-selected", "true");
    // Scrolls only the results list, not the drawer.
    if (active.offsetTop < results.scrollTop) {
      results.scrollTop = active.offsetTop;
    } else if (active.offsetTop + active.offsetHeight > results.scrollTop + results.clientHeight) {
      results.scrollTop = active.offsetTop + active.offsetHeight - results.clientHeight;
    }
    input.setAttribute("aria-activedescendant", active.id);
  } else {
    input.removeAttribute("aria-activedescendant");
  }
  input.setAttribute("aria-expanded", String(visibleCount > 0));

  // One status line serves both searches, so a closed search leaves it to the open one.
  const otherSearching = kind === "theatre" ? state.admin.filmSearching : state.admin.theatreSearching;
  if (!state.admin[searchingKey] && otherSearching) return;
  let status = "";
  if (state.admin[searchingKey]) {
    if (!visibleCount) status = "No results";
    else if (visibleCount >= MAX_ADMIN_SEARCH_RESULTS) status = `First ${visibleCount} results`;
    else status = visibleCount === 1 ? "1 result" : `${visibleCount} results`;
  }
  if (elements.adminSearchStatus.textContent !== status) elements.adminSearchStatus.textContent = status;
}

function setSearchOpen(kind, open) {
  const parts = getSearchParts(kind);
  if (state.admin[parts.searchingKey] === open) return;
  state.admin[parts.searchingKey] = open;
  parts.render();
}

function handleSearchKeydown(kind, event) {
  const parts = getSearchParts(kind);
  const optionCount = parts.results.children.length;

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!state.admin[parts.searchingKey]) {
      setSearchOpen(kind, true);
      return;
    }
    if (!optionCount) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    state.admin[parts.highlightKey] = Math.max(0, Math.min(state.admin[parts.highlightKey] + step, optionCount - 1));
    parts.render();
    return;
  }

  if (event.key === "Enter") {
    if (!state.admin[parts.searchingKey] || !optionCount) return;
    event.preventDefault();
    parts.results.children[state.admin[parts.highlightKey]]?.click();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    // The first Escape closes the results; a second one clears the search.
    if (state.admin[parts.searchingKey] && optionCount) {
      setSearchOpen(kind, false);
      return;
    }
    state.admin[parts.queryKey] = "";
    state.admin[parts.highlightKey] = 0;
    parts.input.value = "";
    parts.render();
  }
}

function buildPromosReplacePayload(promotedCards) {
  return (promotedCards || [])
    .filter((promo) => promo && String(promo.imagePath || "").trim())
    .map((promo, index) => ({
      db_id: parsePromoDbId(promo),
      title: String(promo.title || ""),
      button_url: String(promo.buttonUrl || ""),
      image_path: String(promo.imagePath || ""),
      image_alt: String(promo.imageAlt || ""),
      image_name: String(promo.imageName || ""),
      button_label: String(promo.buttonLabel || "Shop Now"),
      enabled: Boolean(promo.enabled),
      sort_order: index,
    }));
}

function parsePromoDbId(promo) {
  const raw = String(promo?.id || "");
  if (!raw.startsWith("db-")) return null;
  const parsed = Number(raw.slice(3));
  return Number.isInteger(parsed) ? parsed : null;
}

async function uploadPromoImageToStorage(file) {
  if (!state.supabase) {
    throw new Error("Supabase is not configured.");
  }
  const extension = getFileExtension(file.name) || "webp";
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const path = `uploads/${fileName}`;
  const result = await state.supabase.storage
    .from(PROMO_STORAGE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (result.error) throw result.error;
  return path;
}

// Runs after a successful save. An image still used by a saved promo is kept.
async function deleteRemovedPromoImages() {
  const inUse = new Set((state.promotedCards || []).map((promo) => promo.imagePath));
  const paths = state.admin.promoImagesToDelete.filter((path) => !inUse.has(path));
  state.admin.promoImagesToDelete = [];
  for (const path of paths) {
    try {
      await deletePromoImageFromStorage(path);
    } catch {
      // Non-blocking: the save already succeeded; the file is only left unused.
    }
  }
}

async function deletePromoImageFromStorage(path) {
  if (!state.supabase) return;
  const normalized = String(path || "").trim();
  if (!normalized || normalized.startsWith("assets/") || normalized.startsWith("defaults/") || /^https?:\/\//i.test(normalized)) return;
  const result = await state.supabase.storage.from(PROMO_STORAGE_BUCKET).remove([normalized]);
  if (result.error) throw result.error;
}

function getFileExtension(fileName) {
  const value = String(fileName || "").trim();
  const idx = value.lastIndexOf(".");
  if (idx < 0) return "";
  return value.slice(idx + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeCityMatchText(value) {
  return normalizeSearchText(value).replace(/\b(maine|me)\b/g, "").replace(/,\s*$/g, "").trim();
}

function parseOptionalCoordinate(value, fieldLabel, min, max) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${fieldLabel} must be a number between ${min} and ${max}.`);
  }
  return parsed;
}

function isValidCssColor(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw);
}

// api/tmdb-movie.js holds the TMDb key and checks the caller is signed in.
async function fetchTmdbMovieById(tmdbId) {
  const { data } = await state.supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again, then retry.");

  const response = await fetch(`/api/tmdb-movie?id=${encodeURIComponent(tmdbId)}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || `request failed (${response.status})`);
  }
  return body;
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
    popularity: toFiniteNumber(details.popularity),
    voteAverage: toFiniteNumber(details.vote_average),
    voteCount: toFiniteNumber(details.vote_count),
    posterPath: details.poster_path || "",
    posterUrl: details.poster_path ? `https://image.tmdb.org/t/p/w342${details.poster_path}` : "",
    director,
    stars,
    genres,
    matchedAt: new Date().toISOString(),
  };
}
