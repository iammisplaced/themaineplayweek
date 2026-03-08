import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DATA_URL = "./data/showtimes.json";
const STORAGE_KEY = "showtimes-local-edit";
const TMDB_KEY_STORAGE_KEY = "tmdb-api-key-local";
const PROMO_SETTINGS_STORAGE_KEY = "tmp-promo-settings";
const THEME_STORAGE_KEY = "tmp-theme";
const VIEW_STORAGE_KEY = "tmp-view";
const NO_POSTER_IMAGE_URL = "./noposter.webp";
const MASONRY_MIN_COLUMN_WIDTH = 280;
const FILMS_MASONRY_MIN_COLUMN_WIDTH = 170;
const MASONRY_GAP_PX = 16;
const PROMOTED_CARDS = Object.freeze([
  {
    title: "The Golden Statue Collection",
    imageSrc: "./golden_statue_promo.gif",
    imageAlt: "The Golden Statue Collection",
    buttonLabel: "Shop Now",
    buttonUrl: "https://shop.themaineplayweek.com",
  },
  {
    title: "TMP Newspaper Tee",
    imageSrc: "./newspaper_promo.gif",
    imageAlt: "TMP Newspaper Tee",
    buttonLabel: "Shop Now",
    buttonUrl: "https://themaineplayweek.printful.me/product/unisex-garment-dyed-heavyweight-t-shirt",
  },
]);
const THEATRE_COLLAPSED_FILM_COUNT = 5;
const FILM_LAYOUT_ANIMATION_MS = 320;
const FILM_SORT_WEIGHTS = Object.freeze({
  tmdbPopularity: 0.25,
  tmdbRating: 0.15,
  tmdbRecency: 0.1,
  upcomingShowings: 0.35,
  theatreCoverage: 0.15,
});
const RELEASE_RECENCY_WINDOW_DAYS = 30;
const TMDB_FRESHNESS_HALF_LIFE_DAYS = 10;
const TMDB_FRESHNESS_FLOOR = 0.1;
const SUBSTACK_ARCHIVE_URL = "https://themaineplayweek.substack.com/api/v1/archive?sort=new";
const THEATRE_GEO_CACHE_KEY = "theatre-geocode-cache-v1";
const THEATRE_GEO_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 90;

const SUPABASE_URL = "https://rjfsjoratsfqcyyjseqm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqZnNqb3JhdHNmcWN5eWpzZXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mzc5MDgsImV4cCI6MjA4ODIxMzkwOH0.dmcQ_ffwmm4JIKTjSUNNYLGQ9w_v1mR6VRMZimVnLNg";
const LOGO_SPIN_ANIMATION_MS = 420;
const LIGHT_THEME = "light";
const DARK_THEME = "dark";
const THEME_COLOR_MAP = {
  [LIGHT_THEME]: "#ECE5E0",
  [DARK_THEME]: "#121816",
};
const VALID_VIEWS = new Set(["films", "theatres", "days"]);

const state = {
  data: { theatreGroups: [] },
  view: "films",
  source: "json",
  loadedFromSupabaseThisSession: false,
  expandedFilmGroups: new Set(),
  theatreDistanceByKey: new Map(),
  theatreDistanceStatus: "idle",
  theatreDistanceError: "",
  userCoords: null,
  publicSearch: {
    films: "",
    theatres: "",
  },
  selectedDay: "",
  theme: LIGHT_THEME,
  supabase: null,
  promotedCards: cloneDefaultPromotedCards(),
  admin: {
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
    tmdbApiKey: "",
    auth: {
      authenticated: false,
      email: "",
    },
  },
};

const elements = {
  appLoader: document.getElementById("appLoader"),
  themeColorMeta: document.querySelector('meta[name="theme-color"]'),
  themeToggle: document.getElementById("themeToggle"),
  brandLogo: document.getElementById("brandLogo"),
  brandWordmark: document.getElementById("brandWordmark"),
  publicSearchWrap: document.getElementById("publicSearchWrap"),
  publicSearchInput: document.getElementById("publicSearchInput"),
  dayPickerWrap: document.getElementById("dayPickerWrap"),
  dayPickerInput: document.getElementById("dayPickerInput"),
  dayPrevButton: document.getElementById("dayPrevButton"),
  dayNextButton: document.getElementById("dayNextButton"),
  theatreSortStatus: document.getElementById("theatreSortStatus"),
  latestPost: document.getElementById("latestPost"),
  latestPostLink: document.getElementById("latestPostLink"),
  latestPostImage: document.getElementById("latestPostImage"),
  latestPostTitle: document.getElementById("latestPostTitle"),
  latestPostSubtitle: document.getElementById("latestPostSubtitle"),
  latestPostByline: document.getElementById("latestPostByline"),
  results: document.getElementById("results"),
  posterLightbox: document.getElementById("posterLightbox"),
  posterLightboxImage: document.getElementById("posterLightboxImage"),
  posterLightboxClose: document.getElementById("posterLightboxClose"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  groupTemplate: document.getElementById("groupTemplate"),
  showItemTemplate: document.getElementById("showItemTemplate"),
  adminToggle: document.getElementById("adminToggle"),
  adminPanel: document.getElementById("adminPanel"),
  adminIntroText: document.getElementById("adminIntroText"),
  adminAuthGate: document.getElementById("adminAuthGate"),
  adminAuthMessage: document.getElementById("adminAuthMessage"),
  adminControls: document.getElementById("adminControls"),
  adminSectionTabs: Array.from(document.querySelectorAll(".admin-section-tab")),
  adminMoviesPanel: document.getElementById("adminMoviesPanel"),
  adminPromosPanel: document.getElementById("adminPromosPanel"),
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
  tmdbApiKeyInput: document.getElementById("tmdbApiKeyInput"),
  adminFilmSearch: document.getElementById("adminFilmSearch"),
  adminFilmResults: document.getElementById("adminFilmResults"),
  selectedTicketLinkInput: document.getElementById("selectedTicketLinkInput"),
  saveSelectedTicketLink: document.getElementById("saveSelectedTicketLink"),
  openAddPromoModalButton: document.getElementById("openAddPromoModalButton"),
  addPromoModal: document.getElementById("addPromoModal"),
  addPromoForm: document.getElementById("addPromoForm"),
  modalPromoImageInput: document.getElementById("modalPromoImageInput"),
  modalPromoTitleInput: document.getElementById("modalPromoTitleInput"),
  modalPromoButtonUrlInput: document.getElementById("modalPromoButtonUrlInput"),
  cancelAddPromo: document.getElementById("cancelAddPromo"),
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
  promoSettingsList: document.getElementById("promoSettingsList"),
  saveAllAdmin: document.getElementById("saveAllAdmin"),
  adminJson: document.getElementById("adminJson"),
  applyJson: document.getElementById("applyJson"),
  downloadJson: document.getElementById("downloadJson"),
  uploadJson: document.getElementById("uploadJson"),
  resetJson: document.getElementById("resetJson"),
  adminMessage: document.getElementById("adminMessage"),
};

let resizeRenderTimeout = null;
let logoSpinResetTimeout = null;
let lastViewportWidth = window.innerWidth;
let appBootComplete = false;
let pageLoadComplete = document.readyState === "complete";

setLoadingState(true);

if (!pageLoadComplete) {
  window.addEventListener(
    "load",
    () => {
      pageLoadComplete = true;
      syncLoadingState();
    },
    { once: true }
  );
}

try {
  await init();
} finally {
  appBootComplete = true;
  syncLoadingState();
}

function syncLoadingState() {
  const shouldShowLoader = !(appBootComplete && pageLoadComplete);
  setLoadingState(shouldShowLoader);
}

function setLoadingState(isLoading) {
  if (!elements.appLoader) return;
  document.body.classList.toggle("app-loading", isLoading);
  elements.appLoader.classList.toggle("is-hidden", !isLoading);
  elements.appLoader.setAttribute("aria-hidden", String(!isLoading));
}

async function init() {
  initializeTheme();
  initializeViewPreference();
  initializeSupabase();
  bindEvents();
  void loadLatestSubstackPost();
  await refreshAuthState();
  await loadData();
  initializeAdminState();
  loadAdminSettings();
  syncAdminEditor();
  syncPublicSearchUI();
  if (state.view === "theatres") {
    void ensureTheatreDistanceSort();
  }
  updateTheatreSortStatus();
  render();
}

async function loadLatestSubstackPost() {
  if (!elements.latestPost) return;
  setLatestPostFallback();

  try {
    const post = await fetchLatestSubstackPost();
    if (!post) throw new Error("No posts returned");

    const title = String(post.title || "Latest post on Substack");
    const link = String(post.canonical_url || "https://themaineplayweek.substack.com");
    const subtitle = buildSubtitle(post.subtitle || post.description || "");
    const byline = buildSubstackByline(post);
    const imageUrl = normalizeSubstackImageUrl(post.cover_image);

    elements.latestPostTitle.textContent = title;
    elements.latestPostSubtitle.textContent = subtitle || "Read the latest post from The Maine Playweek.";
    elements.latestPostByline.textContent = byline || "The Maine Playweek";
    elements.latestPostLink.href = link;

    if (imageUrl) {
      elements.latestPostImage.src = imageUrl;
      elements.latestPostImage.alt = `Featured image for ${title}`;
      elements.latestPostImage.classList.remove("hidden");
    } else {
      elements.latestPostImage.classList.add("hidden");
      elements.latestPostImage.removeAttribute("src");
      elements.latestPostImage.alt = "";
    }

    syncLatestPostVisibility();
  } catch {
    // Keep fallback content when feed access is blocked.
  }
}

function setLatestPostFallback() {
  elements.latestPostTitle.textContent = "Latest from Substack";
  elements.latestPostSubtitle.textContent = "Read our newest writing on The Maine Playweek Substack.";
  elements.latestPostByline.textContent = "themaineplayweek.substack.com";
  elements.latestPostLink.href = "https://themaineplayweek.substack.com";
  elements.latestPostImage.classList.add("hidden");
  elements.latestPostImage.removeAttribute("src");
  syncLatestPostVisibility();
}

async function fetchLatestSubstackPost() {
  const candidates = [
    `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(SUBSTACK_ARCHIVE_URL)}`,
    SUBSTACK_ARCHIVE_URL,
  ];

  let lastError = null;
  for (const url of candidates) {
    try {
      const response = await fetchWithTimeout(url, 4500);
      if (!response.ok) throw new Error(`Archive request failed (${response.status})`);
      const posts = await response.json();
      if (!Array.isArray(posts) || !posts.length) throw new Error("Archive returned no posts");
      return posts[0];
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to fetch latest Substack post");
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSubtitle(descriptionHtml) {
  const plain = stripHtml(descriptionHtml).replace(/\s+/g, " ").trim();
  if (!plain) return "";
  return plain.length > 180 ? `${plain.slice(0, 177).trimEnd()}...` : plain;
}

function buildSubstackByline(post) {
  const author = "The Maine Playweek";
  const dateRaw = String(post.post_date || "");
  if (!dateRaw) return author;
  const date = new Date(dateRaw);
  if (Number.isNaN(date.getTime())) return author;
  const formattedDate = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${author} · ${formattedDate}`;
}

function normalizeSubstackImageUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return "";
}

function stripHtml(value) {
  if (!value) return "";
  const doc = new DOMParser().parseFromString(value, "text/html");
  return doc.body?.textContent || "";
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
  elements.themeToggle?.addEventListener("click", () => {
    animateThemeToggle();
    const nextTheme = state.theme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
    applyTheme(nextTheme, { persist: true });
  });

  window.addEventListener("resize", () => {
    const currentWidth = window.innerWidth;
    if (currentWidth === lastViewportWidth) return;
    lastViewportWidth = currentWidth;

    clearTimeout(resizeRenderTimeout);
    resizeRenderTimeout = setTimeout(() => {
      render();
    }, 120);
  });

  elements.results.addEventListener("click", (event) => {
    const filmExpandToggle = event.target.closest(".film-expand-toggle");
    if (filmExpandToggle) {
      const key = filmExpandToggle.dataset.filmKey || filmExpandToggle.closest(".group-card")?.dataset.filmKey;
      if (!key) return;
      const scrollTopBefore = getPageScrollTop();
      const shouldAnimateFilmCards =
        (state.view === "films" || state.view === "days") && Boolean(filmExpandToggle.closest(".group-card"));
      if (!shouldAnimateFilmCards) {
        if (state.expandedFilmGroups.has(key)) {
          state.expandedFilmGroups.delete(key);
        } else {
          state.expandedFilmGroups.add(key);
        }
        render();
        requestAnimationFrame(() => {
          setPageScrollTop(scrollTopBefore);
        });
        return;
      }
      const previousRects = captureFilmCardRects();
      const cardBefore = filmExpandToggle.closest(".group-card");
      const cardTopBefore = cardBefore?.getBoundingClientRect().top ?? 0;
      if (state.expandedFilmGroups.has(key)) {
        state.expandedFilmGroups.delete(key);
      } else {
        state.expandedFilmGroups.add(key);
      }
      render();
      requestAnimationFrame(() => {
        const cardAfter = Array.from(elements.results.querySelectorAll(".group-card")).find(
          (card) => card.dataset.filmKey === key
        );
        if (!cardAfter) {
          setPageScrollTop(scrollTopBefore);
          return;
        }
        const cardTopAfter = cardAfter.getBoundingClientRect().top;
        setPageScrollTop(scrollTopBefore + (cardTopAfter - cardTopBefore));
        animateFilmCardLayout(previousRects);
      });
      return;
    }

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
      const view = tab.dataset.view;
      setView(view, { persist: true });
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

  elements.dayPrevButton?.addEventListener("click", () => {
    shiftSelectedDay(-1);
  });

  elements.dayNextButton?.addEventListener("click", () => {
    shiftSelectedDay(1);
  });

  elements.dayPickerInput?.addEventListener("change", () => {
    const requested = String(elements.dayPickerInput.value || "").trim();
    state.selectedDay = requested || toIsoDate(new Date());
    render();
  });

  elements.adminToggle.addEventListener("click", () => {
    const open = elements.adminPanel.classList.toggle("open");
    elements.adminToggle.setAttribute("aria-expanded", String(open));
    elements.adminMessage.textContent = "";
    if (elements.adminAuthMessage) {
      elements.adminAuthMessage.classList.remove("admin-message-success");
      elements.adminAuthMessage.textContent = "";
    }
    if (open) {
      loadAdminSettings();
      syncAdminEditor();
      syncAdminSectionUI();
      updateAdminAuthUI();
    }
  });

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

  elements.tmdbApiKeyInput.addEventListener("input", () => {
    state.admin.tmdbApiKey = elements.tmdbApiKeyInput.value.trim();
    localStorage.setItem(TMDB_KEY_STORAGE_KEY, state.admin.tmdbApiKey);
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

    savePromotedCardsSettings();
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
    state.promotedCards.splice(promoIndex, 1);
    savePromotedCardsSettings();
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
    try {
      const imageSrc = await readFileAsDataUrl(file);
      const title = String(elements.modalPromoTitleInput?.value || "").trim();
      const buttonUrl = String(elements.modalPromoButtonUrlInput?.value || "").trim();

      state.promotedCards.push({
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        enabled: true,
        title,
        imageSrc,
        imageAlt: title || file.name,
        imageName: file.name,
        buttonLabel: "Shop Now",
        buttonUrl,
        isDefault: false,
      });

      savePromotedCardsSettings();
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
    state.admin.theatreQuery = getAdminTheatreLabelByIndex(state.admin.theatreIndex);
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

function initializeTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  const initialTheme =
    storedTheme === LIGHT_THEME || storedTheme === DARK_THEME
      ? storedTheme
      : prefersDark
        ? DARK_THEME
        : LIGHT_THEME;
  applyTheme(initialTheme, { persist: false });
}

function initializeViewPreference() {
  const storedView = String(localStorage.getItem(VIEW_STORAGE_KEY) || "").trim();
  if (VALID_VIEWS.has(storedView)) {
    state.view = storedView;
  }
  syncViewTabSelection();
}

function syncViewTabSelection() {
  elements.tabs.forEach((button) => {
    const selected = button.dataset.view === state.view;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}

function setView(view, options = {}) {
  if (!VALID_VIEWS.has(view)) return;
  const { persist = true } = options;
  state.view = view;
  syncViewTabSelection();
  if (persist) {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  }
  syncPublicSearchUI();
  if (state.view === "theatres") {
    void ensureTheatreDistanceSort();
  }
  updateTheatreSortStatus();
  render();
}

function applyTheme(theme, options = {}) {
  const { persist = true } = options;
  const normalizedTheme = theme === DARK_THEME ? DARK_THEME : LIGHT_THEME;
  state.theme = normalizedTheme;

  document.documentElement.setAttribute("data-theme", normalizedTheme);

  if (elements.brandLogo) {
    elements.brandLogo.src = normalizedTheme === DARK_THEME ? "TMP logo light.png" : "TMP logo dark.png";
  }

  if (elements.brandWordmark) {
    elements.brandWordmark.src =
      normalizedTheme === DARK_THEME ? "TMP Wordmark Three Line Light.png" : "TMP Wordmark Three Line Dark.png";
  }

  if (elements.themeToggle) {
    const isDark = normalizedTheme === DARK_THEME;
    const nextThemeLabel = isDark ? "light" : "dark";
    elements.themeToggle.setAttribute("aria-label", `Switch to ${nextThemeLabel} mode`);
    elements.themeToggle.setAttribute("title", `Switch to ${nextThemeLabel} mode`);
  }

  if (elements.themeColorMeta) {
    elements.themeColorMeta.setAttribute("content", THEME_COLOR_MAP[normalizedTheme] || THEME_COLOR_MAP[LIGHT_THEME]);
  }

  if (persist) {
    localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
  }
}

function animateThemeToggle() {
  if (!elements.brandLogo) return;
  if (logoSpinResetTimeout) {
    clearTimeout(logoSpinResetTimeout);
    logoSpinResetTimeout = null;
  }
  elements.brandLogo.classList.remove("is-animating");
  // Force reflow so repeated clicks retrigger the animation.
  void elements.brandLogo.offsetWidth;
  elements.brandLogo.classList.add("is-animating");
  logoSpinResetTimeout = setTimeout(() => {
    elements.brandLogo?.classList.remove("is-animating");
    logoSpinResetTimeout = null;
  }, LOGO_SPIN_ANIMATION_MS);
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
  state.promotedCards = loadPromotedCardsSettings();

  if (state.supabase) {
    try {
      const fromDb = await loadDataFromSupabase();
      if (fromDb.theatreGroups.length) {
        validateData({ theatreGroups: fromDb.theatreGroups });
        state.data = { theatreGroups: fromDb.theatreGroups };
        state.promotedCards = fromDb.promotedCards.length ? fromDb.promotedCards : cloneDefaultPromotedCards();
        state.source = "supabase";
        state.loadedFromSupabaseThisSession = true;
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
      state.loadedFromSupabaseThisSession = false;
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
  state.loadedFromSupabaseThisSession = false;
}

async function loadDataFromSupabase() {
  const theatres = await fetchAllRowsFromSupabase(() =>
    state.supabase.from("theatres").select("id,name,city,address,website").order("id", { ascending: true })
  );
  const films = await fetchAllRowsFromSupabase(() =>
    state.supabase
      .from("films")
      .select("id,title,year,tmdb_id,ticket_link,tmdb_json")
      .order("id", { ascending: true })
  );
  const theatreFilms = await fetchAllRowsFromSupabase(() =>
    state.supabase
      .from("theatre_films")
      .select("theatre_id,film_id,ticket_link")
      .order("theatre_id", { ascending: true })
      .order("film_id", { ascending: true })
  );
  const showings = await fetchAllRowsFromSupabase(() =>
    state.supabase
      .from("showings")
      .select("id,theatre_id,film_id,show_date,times")
      .order("id", { ascending: true })
  );
  const promos = await fetchAllRowsFromSupabase(() =>
    state.supabase
      .from("promos")
      .select("id,title,button_url,image_src,image_alt,image_name,button_label,enabled,sort_order")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
  );

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
      ticketLink: "",
      legacyTicketLink: filmRow.ticket_link || "",
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
        ticketLink: "",
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
    film.ticketLink = linkRow.ticket_link || "";
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

  return {
    theatreGroups,
    promotedCards: buildPromotedCardsFromSupabaseRows(promos),
  };
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
      ticket_link: film?.legacyTicketLink || "",
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
  renderPromoSettingsEditor();
  elements.adminJson.value = JSON.stringify(stripInternalFields(state.data), null, 2);
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
  state.admin.tmdbApiKey = localStorage.getItem(TMDB_KEY_STORAGE_KEY) || "";
  elements.tmdbApiKeyInput.value = state.admin.tmdbApiKey;
  if (state.source !== "supabase") {
    state.promotedCards = loadPromotedCardsSettings();
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
  const normalized = section === "promos" ? "promos" : "movies";
  state.admin.section = normalized;
  syncAdminSectionUI();
}

function syncAdminSectionUI() {
  const section = state.admin.section === "promos" ? "promos" : "movies";
  elements.adminSectionTabs.forEach((button) => {
    const selected = button.dataset.adminSection === section;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  elements.adminMoviesPanel?.classList.toggle("hidden", section !== "movies");
  elements.adminPromosPanel?.classList.toggle("hidden", section !== "promos");
}

function renderTheatreOptions() {
  const theatres = state.data.theatreGroups;
  elements.adminTheatreSearch.value = state.admin.theatreQuery;
  elements.adminTheatreSearch.disabled = !theatres.length;
  elements.adminTheatreResults.innerHTML = "";
  if (!theatres.length) return;
  if (!state.admin.theatreSearching) return;

  const query = normalizeSearchText(state.admin.theatreQuery);
  const duplicateCountByNameCity = buildAdminDuplicateCountByNameCity(theatres);
  let visibleCount = 0;
  theatres.forEach((theatre, index) => {
    const label = buildAdminTheatreLabel(theatre, index, duplicateCountByNameCity);
    const searchable = buildAdminTheatreSearchText(theatre, label);
    if (query && !searchable.includes(query)) return;
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
    const query = normalizeSearchText(state.admin.filmQuery);
    let visibleCount = 0;
    films.forEach((film, index) => {
      const label = buildFilmGroupKey(film.title, film.year);
      if (query && !normalizeSearchText(label).includes(query)) return;
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

function renderPromoSettingsEditor() {
  if (!elements.promoSettingsList) return;
  elements.promoSettingsList.innerHTML = "";

  const promos = state.promotedCards || [];
  promos.forEach((promo, index) => {
    const item = document.createElement("article");
    item.className = "promo-settings-item";

    const heading = document.createElement("p");
    heading.className = "promo-settings-heading";
    heading.textContent = promo.imageName || promo.imageSrc.replace("./", "");

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
  return normalizeSearchText(value);
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
  savePromotedCardsSettings();
  if (!state.supabase || !state.admin.auth.authenticated) {
    syncAdminEditor();
    render();
    return;
  }
  await saveDataToSupabase();
  const refreshed = await loadDataFromSupabase();
  validateData({ theatreGroups: refreshed.theatreGroups });
  state.data = { theatreGroups: refreshed.theatreGroups };
  state.promotedCards = refreshed.promotedCards.length ? refreshed.promotedCards : cloneDefaultPromotedCards();
  state.source = "supabase";
  state.loadedFromSupabaseThisSession = true;
  syncAdminEditor();
  render();
}

async function saveDataToSupabase() {
  const supabase = state.supabase;
  if (state.source !== "supabase" || !state.loadedFromSupabaseThisSession) {
    throw new Error(
      "Blocked save: current admin data was not loaded from Supabase. Use Reset from source to reload live data before saving."
    );
  }
  await verifySupabaseSchema(supabase);
  const payload = buildReplacePayload(state.data, state.promotedCards);
  const riskyTicketLinkChanges = await findTicketLinkClearRisks(supabase, payload);
  if (riskyTicketLinkChanges.count > 0) {
    const preview = riskyTicketLinkChanges.samples.length
      ? `\n\nExamples:\n- ${riskyTicketLinkChanges.samples.join("\n- ")}`
      : "";
    throw new Error(
      `Blocked save: this update would clear ${riskyTicketLinkChanges.count} existing ticket link(s) in Supabase.${preview}\n\nExplicit clears are currently disabled for safety.`
    );
  }
  const rpc = await supabase.rpc("replace_showtimes_data", { payload, allow_ticket_link_clear: false });
  if (rpc.error) throw rpc.error;
}

async function verifySupabaseSchema(supabase) {
  const checks = await Promise.all([
    supabase.from("theatres").select("id").limit(1),
    supabase.from("films").select("id").limit(1),
    supabase.from("showings").select("id").limit(1),
    supabase.from("theatre_films").select("theatre_id").limit(1),
    supabase.from("promos").select("id").limit(1),
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

async function findTicketLinkClearRisks(supabase, payload) {
  const [theatres, films, theatreFilms] = await Promise.all([
    fetchAllRowsFromSupabase(() =>
      supabase.from("theatres").select("id,name,city").order("id", { ascending: true })
    ),
    fetchAllRowsFromSupabase(() =>
      supabase.from("films").select("id,title,year,tmdb_id").order("id", { ascending: true })
    ),
    fetchAllRowsFromSupabase(() =>
      supabase
        .from("theatre_films")
        .select("theatre_id,film_id,ticket_link")
        .order("theatre_id", { ascending: true })
        .order("film_id", { ascending: true })
    ),
  ]);
  const theatreById = new Map((theatres || []).map((row) => [String(row.id), row]));
  const filmById = new Map((films || []).map((row) => [String(row.id), row]));

  const payloadTheatreByKey = new Map((payload?.theatres || []).map((row) => [row.key, row]));
  const payloadFilmByKey = new Map((payload?.films || []).map((row) => [row.key, row]));
  const payloadLinkByComposite = new Map();

  (payload?.theatre_films || []).forEach((row) => {
    const theatre = payloadTheatreByKey.get(row.theatre_key);
    const film = payloadFilmByKey.get(row.film_key);
    if (!theatre || !film) return;
    const composite = buildTheatreFilmCompositeKey(
      theatre.name,
      theatre.city,
      film.title,
      film.year,
      film.tmdb_id
    );
    payloadLinkByComposite.set(composite, String(row.ticket_link || "").trim());
  });

  const riskyRows = [];
  (theatreFilms || []).forEach((row) => {
    const existingLink = String(row.ticket_link || "").trim();
    if (!existingLink) return;

    const theatre = theatreById.get(String(row.theatre_id));
    const film = filmById.get(String(row.film_id));
    if (!theatre || !film) return;

    const composite = buildTheatreFilmCompositeKey(
      theatre.name,
      theatre.city,
      film.title,
      film.year,
      film.tmdb_id
    );
    const incoming = payloadLinkByComposite.get(composite);
    if (!incoming) {
      riskyRows.push({
        theatreName: theatre.name,
        theatreCity: theatre.city,
        filmTitle: film.title,
        filmYear: film.year,
      });
    }
  });

  return {
    count: riskyRows.length,
    samples: riskyRows.slice(0, 5).map((entry) => {
      const filmLabel = Number.isInteger(Number(entry.filmYear))
        ? `${entry.filmTitle} (${Number(entry.filmYear)})`
        : entry.filmTitle;
      return `${filmLabel} at ${entry.theatreName} (${entry.theatreCity})`;
    }),
  };
}

async function fetchAllRowsFromSupabase(queryBuilderFactory, pageSize = 1000) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const result = await queryBuilderFactory().range(from, to);
    if (result.error) throw result.error;
    const chunk = result.data || [];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function buildTheatreFilmCompositeKey(theatreName, theatreCity, filmTitle, filmYear, filmTmdbId) {
  return [
    normalizeSearchText(theatreName),
    normalizeSearchText(theatreCity),
    buildFilmIdentityKey(filmTitle, filmYear, filmTmdbId),
  ].join("::");
}

function buildFilmIdentityKey(filmTitle, filmYear, filmTmdbId) {
  const tmdbId = Number(filmTmdbId);
  if (Number.isInteger(tmdbId) && tmdbId > 0) {
    return `tmdb:${tmdbId}`;
  }
  return `${normalizeFilmTitle(filmTitle)}::${Number.isInteger(Number(filmYear)) ? Number(filmYear) : ""}`;
}

function buildReplacePayload(data, promotedCards) {
  const theatres = [];
  const films = [];
  const theatreFilms = [];
  const showings = [];

  const filmKeyByUniq = new Map();
  const filmPayloadIndexByKey = new Map();
  let theatreCounter = 0;
  let filmCounter = 0;

  data.theatreGroups.forEach((theatre) => {
    const theatreKey = `t_${theatreCounter++}`;
    theatres.push({
      key: theatreKey,
      db_id: Number.isInteger(Number(theatre._dbId)) ? Number(theatre._dbId) : null,
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
        const filmTicketLink = String(film.ticketLink || "").trim();
        films.push({
          key: filmKey,
          db_id: Number.isInteger(Number(film._dbId)) ? Number(film._dbId) : null,
          title: film.title,
          year: Number.isInteger(Number(film.year)) ? Number(film.year) : null,
          tmdb_id: Number.isInteger(Number(film.tmdbId)) ? Number(film.tmdbId) : null,
          ticket_link: filmTicketLink,
          tmdb_json: film.tmdb || null,
        });
        filmPayloadIndexByKey.set(filmKey, films.length - 1);
      } else {
        const filmTicketLink = String(film.ticketLink || "").trim();
        if (filmTicketLink) {
          const existingFilmIndex = filmPayloadIndexByKey.get(filmKey);
          if (typeof existingFilmIndex === "number" && !films[existingFilmIndex].ticket_link) {
            films[existingFilmIndex].ticket_link = filmTicketLink;
          }
          if (typeof existingFilmIndex === "number" && !films[existingFilmIndex].db_id) {
            const filmDbId = Number.isInteger(Number(film._dbId)) ? Number(film._dbId) : null;
            if (filmDbId) films[existingFilmIndex].db_id = filmDbId;
          }
        }
      }

      theatreFilms.push({
        theatre_key: theatreKey,
        film_key: filmKey,
        theatre_db_id: Number.isInteger(Number(theatre._dbId)) ? Number(theatre._dbId) : null,
        film_db_id: Number.isInteger(Number(film._dbId)) ? Number(film._dbId) : null,
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
    promos: buildPromosReplacePayload(promotedCards),
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
  updateTheatreSortStatus();
  let grouped = {};
  let activeDay = "";
  if (state.view === "days") {
    activeDay = ensureSelectedDay();
    syncDayPickerUI(activeDay);
    grouped = activeDay ? buildSingleDayGroups(state.data.theatreGroups, activeDay) : {};
  } else {
    syncDayPickerUI("");
    grouped = buildGroups(state.data.theatreGroups, state.view);
  }

  elements.results.classList.add("results-masonry");
  elements.results.dataset.view = state.view;
  elements.results.innerHTML = "";
  const cards = [];
  const isFilmStyleView = state.view === "films" || state.view === "days";

  let entries = Object.entries(grouped);
  const searchQuery = getPublicSearchQueryForView(state.view);
  if (searchQuery) {
    if (isFilmStyleView) {
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
    const message = state.view === "films"
      ? "No films found..."
      : state.view === "theatres"
        ? "No theatres found..."
        : "No showtimes for this day...";
    elements.results.innerHTML = `<p class="no-results-message">${message}</p>`;
    return;
  }

  if (isFilmStyleView) {
    entries.sort(([, groupA], [, groupB]) => {
      const scoreA = getFilmGroupSortScore(groupA);
      const scoreB = getFilmGroupSortScore(groupB);
      if (scoreA !== scoreB) return scoreB - scoreA;

      const titleA = groupA?.filmInfo?.film || "";
      const titleB = groupB?.filmInfo?.film || "";
      const normalizedCompare = normalizeSortTitle(titleA).localeCompare(normalizeSortTitle(titleB));
      if (normalizedCompare !== 0) return normalizedCompare;

      const yearA = Number(groupA?.filmInfo?.year || 0);
      const yearB = Number(groupB?.filmInfo?.year || 0);
      if (yearA !== yearB) return yearA - yearB;

      return titleA.localeCompare(titleB);
    });
  } else if (state.view === "theatres") {
    entries.sort(([, groupA], [, groupB]) => {
      const keyA = buildTheatreDistanceKey(groupA?.theatreInfo);
      const keyB = buildTheatreDistanceKey(groupB?.theatreInfo);
      const distanceA = state.theatreDistanceByKey.get(keyA);
      const distanceB = state.theatreDistanceByKey.get(keyB);
      const hasDistanceA = Number.isFinite(distanceA);
      const hasDistanceB = Number.isFinite(distanceB);
      if (hasDistanceA && hasDistanceB && distanceA !== distanceB) return distanceA - distanceB;
      if (hasDistanceA !== hasDistanceB) return hasDistanceA ? -1 : 1;

      const labelA = `${groupA?.theatreInfo?.name || ""} ${groupA?.theatreInfo?.city || ""}`;
      const labelB = `${groupB?.theatreInfo?.name || ""} ${groupB?.theatreInfo?.city || ""}`;
      return labelA.localeCompare(labelB);
    });
  } else {
    entries.sort(([a], [b]) => a.localeCompare(b));
  }

  for (const [groupName, group] of entries) {
    const card = elements.groupTemplate.content.firstElementChild.cloneNode(true);
    const groupTitle = card.querySelector(".group-title");
    const isFilmsView = isFilmStyleView && Boolean(group.filmInfo);
    if (isFilmsView) {
      card.classList.add("film-card");
      groupTitle.textContent = group.filmInfo.film;
      groupTitle.classList.add("group-title-film");
    } else {
      groupTitle.textContent = groupName;
    }
    const subtitle = card.querySelector(".group-subtitle");
    const groupLink = card.querySelector(".group-link");
    const filmExpandToggle = card.querySelector(".film-expand-toggle");
    const groupFilmSummary = card.querySelector(".group-film-summary");
    const groupFilmPoster = card.querySelector(".group-film-poster");
    const groupFilmFacts = card.querySelector(".group-film-facts");
    const list = card.querySelector(".show-list");
    const shows = group.shows;
    let filmGroupExpanded = true;
    let theatreGroupExpanded = true;

    if (group.theatreInfo && state.view === "theatres") {
      subtitle.textContent = `${group.theatreInfo.address}`;
      subtitle.classList.remove("hidden");
      const theatreWebsite = normalizeOutboundUrl(group.theatreInfo.website);
      if (theatreWebsite) {
        groupLink.href = theatreWebsite;
        groupLink.classList.remove("hidden");
      }

      const theatreExpandKey = buildExpandCardKey(state.view, group);
      const theatreHasOverflow = shows.length > THEATRE_COLLAPSED_FILM_COUNT;
      const hiddenFilmCount = Math.max(0, shows.length - THEATRE_COLLAPSED_FILM_COUNT);
      theatreGroupExpanded = !theatreHasOverflow || state.expandedFilmGroups.has(theatreExpandKey);
      if (filmExpandToggle && theatreHasOverflow) {
        filmExpandToggle.classList.add("theatre-card-toggle");
        filmExpandToggle.dataset.filmKey = theatreExpandKey;
        filmExpandToggle.textContent = theatreGroupExpanded
          ? "Show less"
          : `Show all (+${hiddenFilmCount})`;
        filmExpandToggle.setAttribute("aria-expanded", String(theatreGroupExpanded));
        filmExpandToggle.classList.remove("hidden");
      }
    }
    if (isFilmsView) {
      const filmGroupKey = buildExpandCardKey(state.view, group);
      filmGroupExpanded = state.expandedFilmGroups.has(filmGroupKey);
      card.dataset.filmKey = filmGroupKey;
      card.classList.toggle("film-card-collapsed", !filmGroupExpanded);

      if (filmExpandToggle) {
        filmExpandToggle.dataset.filmKey = filmGroupKey;
        filmExpandToggle.textContent = filmGroupExpanded ? "Collapse" : "Expand";
        filmExpandToggle.setAttribute("aria-expanded", String(filmGroupExpanded));
        filmExpandToggle.classList.remove("hidden");
      }

      const facts = buildFilmFacts(group.filmInfo);
      if (groupFilmPoster) {
        groupFilmPoster.onerror = () => {
          groupFilmPoster.onerror = null;
          groupFilmPoster.src = NO_POSTER_IMAGE_URL;
        };
        groupFilmPoster.src = group.filmInfo.posterUrl || NO_POSTER_IMAGE_URL;
        groupFilmPoster.alt = group.filmInfo.posterUrl
          ? `Poster for ${group.filmInfo.film}`
          : `No poster available for ${group.filmInfo.film}`;
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
        if (filmGroupExpanded) {
          groupFilmFacts.classList.remove("hidden");
        } else {
          groupFilmFacts.classList.add("hidden");
        }
      }
      groupFilmSummary.classList.remove("hidden");
      if (!filmGroupExpanded) {
        list.classList.add("hidden");
      }
    }

    if (!isFilmsView || filmGroupExpanded) {
      shows.sort((a, b) => {
        if (state.view === "theatres") {
          const earliestA = getRowEarliestShowtimeTimestamp(a);
          const earliestB = getRowEarliestShowtimeTimestamp(b);
          if (earliestA !== earliestB) return earliestA - earliestB;
          return buildFilmGroupKey(a.film, a.year).localeCompare(buildFilmGroupKey(b.film, b.year));
        }
        return `${a.theatre} ${a.city}`.localeCompare(`${b.theatre} ${b.city}`);
      });

      const showsToRender =
        state.view === "theatres" && !theatreGroupExpanded
          ? shows.slice(0, THEATRE_COLLAPSED_FILM_COUNT)
          : shows;

      for (const show of showsToRender) {
        const item = elements.showItemTemplate.content.firstElementChild.cloneNode(true);
        const main = item.querySelector(".show-main");
        const meta = item.querySelector(".show-meta");
        const schedule = item.querySelector(".show-schedule");
        const row = item.querySelector(".show-row");
        const poster = item.querySelector(".show-poster");
        const link = item.querySelector(".show-link");
        const filmLabel = show.film;

        if (state.view === "theatres") {
          const rowExpandKey = buildExpandRowKey(state.view, group, show);
          const rowExpanded = state.expandedFilmGroups.has(rowExpandKey);
          const rowToggle = document.createElement("button");
          rowToggle.type = "button";
          rowToggle.className = "film-expand-toggle";
          rowToggle.dataset.filmKey = rowExpandKey;
          rowToggle.textContent = rowExpanded ? "Collapse" : "Expand";
          rowToggle.setAttribute("aria-expanded", String(rowExpanded));

          row.classList.add("has-poster");
          poster.onerror = () => {
            poster.onerror = null;
            poster.src = NO_POSTER_IMAGE_URL;
          };
          poster.src = show.posterUrl || NO_POSTER_IMAGE_URL;
          poster.alt = show.posterUrl
            ? `Poster for ${show.film}`
            : `No poster available for ${show.film}`;
          poster.classList.remove("hidden");

          main.textContent = filmLabel;
          meta.textContent = "";
          meta.appendChild(rowToggle);

          if (state.view === "theatres") {
            renderSchedule(schedule, show.dates);
          }

          if (!rowExpanded) {
            schedule.classList.add("hidden");
          } else {
            schedule.classList.remove("hidden");
          }

          const ticketUrl = normalizeOutboundUrl(show.ticketLink);
          if (state.view === "theatres" && rowExpanded && ticketUrl) {
            link.href = ticketUrl;
            link.classList.remove("hidden");
          } else {
            link.classList.add("hidden");
          }
        } else {
          main.textContent = `${show.theatre}`;
          meta.textContent = `${show.city}`;
          renderSchedule(schedule, show.dates);
          const ticketUrl = normalizeOutboundUrl(show.ticketLink);
          if (ticketUrl) {
            link.href = ticketUrl;
            link.classList.remove("hidden");
          }
        }
        list.appendChild(item);
      }
    }

    if (state.view === "theatres" && filmExpandToggle && !filmExpandToggle.classList.contains("hidden")) {
      card.appendChild(filmExpandToggle);
    }

    cards.push(card);
  }

  if (state.view === "films" || state.view === "days") {
    insertPromotedCards(cards, buildPromotedAdCards());
  }

  renderResultCards(cards);
}

function buildPromotedAdCards() {
  const visiblePromos = getVisiblePromotedCards();
  return visiblePromos.map((card) => {
    const article = document.createElement("article");
    article.className = "group-card promo-card";

    const image = document.createElement("img");
    image.className = "promo-card-image";
    image.src = card.imageSrc;
    image.alt = card.imageAlt;
    image.loading = "lazy";
    image.decoding = "async";

    const cta = document.createElement("a");
    cta.className = "promo-card-cta";
    cta.href = card.buttonUrl;
    cta.target = "_blank";
    cta.rel = "noopener noreferrer";
    cta.textContent = card.buttonLabel;

    const titleValue = String(card.title || "").trim();
    if (titleValue) {
      const title = document.createElement("h3");
      title.className = "group-title promo-card-title";
      title.textContent = titleValue;
      article.appendChild(title);
    }
    article.appendChild(image);
    if (card.buttonUrl) {
      article.appendChild(cta);
    }
    return article;
  });
}

function getVisiblePromotedCards() {
  return (state.promotedCards || []).reduce((visible, promo) => {
    if (!promo || !promo.enabled) return visible;
    const hasImage = typeof promo.imageSrc === "string" && promo.imageSrc.trim();
    if (!hasImage) return visible;
    visible.push({
      ...promo,
      buttonUrl: normalizeOutboundUrl(String(promo.buttonUrl || "")),
    });
    return visible;
  }, []);
}

function insertPromotedCards(cards, adCards) {
  if (!Array.isArray(cards) || !cards.length || !Array.isArray(adCards) || !adCards.length) return;

  const total = cards.length;
  if (total < 5) {
    adCards.forEach((adCard) => cards.push(adCard));
    return;
  }

  const columns = Math.max(1, getMasonryColumnCount());
  const desiredPositions = [0.42, 0.74];
  let previousSlot = -1;
  let previousRow = -1;
  adCards.forEach((adCard, index) => {
    const currentTotal = cards.length;
    const minStart = currentTotal >= 14 ? 6 : currentTotal >= 10 ? 4 : 3;
    const minGap = currentTotal >= 18 ? 8 : currentTotal >= 12 ? 6 : 4;
    const minRowGap = index > 0 ? 3 : 0;
    const desiredRatio = desiredPositions[index] || 0.7;
    const rawTarget = Math.floor(currentTotal * desiredRatio);

    const minIndex = previousSlot < 0
      ? minStart
      : Math.min(currentTotal - 1, previousSlot + minGap);
    const maxIndex = Math.max(minIndex, currentTotal - Math.max(columns, 3));
    const target = clampNumber(rawTarget, minIndex, maxIndex);
    const insertIndex = findAdInsertionIndex(cards, target, minIndex, maxIndex, columns, previousRow, minRowGap);
    const states = getGridInsertionStates(cards, columns);
    const rowAtInsert = states[insertIndex]?.row ?? previousRow;

    cards.splice(insertIndex, 0, adCard);
    previousSlot = insertIndex;
    previousRow = rowAtInsert;
  });
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function findAdInsertionIndex(cards, targetIndex, minIndex, maxIndex, columns, previousRow, minRowGap) {
  const states = getGridInsertionStates(cards, columns);
  const target = clampNumber(targetIndex, minIndex, maxIndex);

  for (let index = target; index <= maxIndex; index += 1) {
    if (isCenteredAdSlot(states[index], columns) && hasRequiredRowGap(states[index], previousRow, minRowGap)) {
      return index;
    }
  }
  for (let index = target - 1; index >= minIndex; index -= 1) {
    if (isCenteredAdSlot(states[index], columns) && hasRequiredRowGap(states[index], previousRow, minRowGap)) {
      return index;
    }
  }

  // Global fallback: still prefer center slots.
  for (let index = maxIndex + 1; index < states.length; index += 1) {
    if (isCenteredAdSlot(states[index], columns) && hasRequiredRowGap(states[index], previousRow, minRowGap)) {
      return index;
    }
  }
  for (let index = minIndex - 1; index >= 0; index -= 1) {
    if (isCenteredAdSlot(states[index], columns) && hasRequiredRowGap(states[index], previousRow, minRowGap)) {
      return index;
    }
  }

  // If row gap isn't possible, keep center bias.
  for (let index = target; index <= maxIndex; index += 1) {
    if (isCenteredAdSlot(states[index], columns)) return index;
  }
  for (let index = target - 1; index >= minIndex; index -= 1) {
    if (isCenteredAdSlot(states[index], columns)) return index;
  }

  // Narrow grids cannot always center a 2-column card.
  for (let index = target; index <= maxIndex; index += 1) {
    if (isPreferredAdSlot(states[index], columns) && hasRequiredRowGap(states[index], previousRow, minRowGap)) {
      return index;
    }
  }
  for (let index = target - 1; index >= minIndex; index -= 1) {
    if (isPreferredAdSlot(states[index], columns) && hasRequiredRowGap(states[index], previousRow, minRowGap)) {
      return index;
    }
  }
  for (let index = target; index <= maxIndex; index += 1) {
    if (isPreferredAdSlot(states[index], columns)) return index;
  }
  for (let index = target - 1; index >= minIndex; index -= 1) {
    if (isPreferredAdSlot(states[index], columns)) return index;
  }

  return target;
}

function hasRequiredRowGap(stateAtIndex, previousRow, minRowGap) {
  if (!stateAtIndex) return false;
  if (minRowGap <= 0 || previousRow < 0) return true;
  return stateAtIndex.row - previousRow >= minRowGap;
}

function isCenteredAdSlot(stateAtIndex, columns) {
  if (!stateAtIndex) return false;
  if (columns < 4) return false;
  const startCol = stateAtIndex.colUsed;
  return startCol >= 1 && startCol <= columns - 3;
}

function isPreferredAdSlot(stateAtIndex, columns) {
  if (!stateAtIndex) return false;
  if (columns <= 1) return true;
  return stateAtIndex.colUsed <= columns - 2;
}

function isAcceptableAdSlot(stateAtIndex, columns) {
  if (!stateAtIndex) return false;
  if (columns <= 1) return true;
  return stateAtIndex.colUsed === 0;
}

function getGridInsertionStates(cards, columns) {
  const states = [{ row: 0, colUsed: 0 }];
  if (columns <= 1) {
    for (let i = 0; i < cards.length; i += 1) {
      states.push({ row: i + 1, colUsed: 0 });
    }
    return states;
  }

  let row = 0;
  let colUsed = 0;

  cards.forEach((card) => {
    const span = getCardGridSpan(card, columns);
    if (colUsed > 0 && colUsed + span > columns) {
      row += 1;
      colUsed = 0;
    }

    colUsed += span;
    if (colUsed >= columns) {
      row += 1;
      colUsed = 0;
    }
    states.push({ row, colUsed });
  });

  return states;
}

function getCardGridSpan(card, columns) {
  if (columns <= 1) return 1;
  const isExpandedFilmCard =
    card.classList.contains("film-card") && !card.classList.contains("film-card-collapsed");
  const isPromoCard = card.classList.contains("promo-card");
  if (isExpandedFilmCard || isPromoCard) return 2;
  return 1;
}

function cloneDefaultPromotedCards() {
  return PROMOTED_CARDS.map((promo) => ({
    id: promo.imageSrc,
    enabled: true,
    title: promo.title || "",
    imageSrc: promo.imageSrc,
    imageAlt: promo.imageAlt || "",
    imageName: promo.imageSrc.replace("./", ""),
    buttonLabel: promo.buttonLabel || "Shop Now",
    buttonUrl: promo.buttonUrl || "",
    isDefault: true,
  }));
}

function loadPromotedCardsSettings() {
  const defaults = cloneDefaultPromotedCards();
  const raw = localStorage.getItem(PROMO_SETTINGS_STORAGE_KEY);
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    const byId = new Map(parsed.map((entry) => [String(entry?.id || ""), entry]));
    const mergedDefaults = defaults
      .filter((promo) => !Boolean(byId.get(String(promo.id))?.deleted))
      .map((promo) => {
      const stored = byId.get(String(promo.id)) || {};
      return {
        ...promo,
        enabled: typeof stored.enabled === "boolean" ? stored.enabled : promo.enabled,
        title: typeof stored.title === "string" ? stored.title : promo.title,
        buttonUrl: typeof stored.buttonUrl === "string" ? stored.buttonUrl : promo.buttonUrl,
      };
      });

    const defaultIds = new Set(defaults.map((promo) => String(promo.id)));
    const customPromos = parsed
      .filter((entry) => {
        const id = String(entry?.id || "");
        return id && !defaultIds.has(id) && !entry?.deleted;
      })
      .map((entry) => ({
        id: String(entry.id),
        enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
        title: typeof entry.title === "string" ? entry.title : "",
        imageSrc: typeof entry.imageSrc === "string" ? entry.imageSrc : "",
        imageAlt: typeof entry.imageAlt === "string" ? entry.imageAlt : "",
        imageName: typeof entry.imageName === "string" ? entry.imageName : "custom-promo",
        buttonLabel: typeof entry.buttonLabel === "string" ? entry.buttonLabel : "Shop Now",
        buttonUrl: typeof entry.buttonUrl === "string" ? entry.buttonUrl : "",
        isDefault: false,
      }))
      .filter((promo) => promo.imageSrc);

    return [...mergedDefaults, ...customPromos];
  } catch {
    return defaults;
  }
}

function savePromotedCardsSettings() {
  const payload = (state.promotedCards || []).map((promo) => ({
    id: promo.id,
    deleted: false,
    enabled: Boolean(promo.enabled),
    title: String(promo.title || ""),
    imageSrc: String(promo.imageSrc || ""),
    imageAlt: String(promo.imageAlt || ""),
    imageName: String(promo.imageName || ""),
    buttonLabel: String(promo.buttonLabel || "Shop Now"),
    buttonUrl: String(promo.buttonUrl || ""),
    isDefault: Boolean(promo.isDefault),
  }));
  const activeIds = new Set((state.promotedCards || []).map((promo) => String(promo.id)));
  PROMOTED_CARDS.forEach((promo) => {
    const id = String(promo.imageSrc);
    if (activeIds.has(id)) return;
    payload.push({ id, deleted: true });
  });
  localStorage.setItem(PROMO_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

function buildPromotedCardsFromSupabaseRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      id: `db-${row.id}`,
      enabled: typeof row.enabled === "boolean" ? row.enabled : true,
      title: String(row.title || ""),
      imageSrc: String(row.image_src || ""),
      imageAlt: String(row.image_alt || ""),
      imageName: String(row.image_name || ""),
      buttonLabel: String(row.button_label || "Shop Now"),
      buttonUrl: String(row.button_url || ""),
      isDefault: false,
    }))
    .filter((promo) => promo.imageSrc);
}

function buildPromosReplacePayload(promotedCards) {
  return (promotedCards || [])
    .filter((promo) => promo && String(promo.imageSrc || "").trim())
    .map((promo, index) => ({
      title: String(promo.title || ""),
      button_url: String(promo.buttonUrl || ""),
      image_src: String(promo.imageSrc || ""),
      image_alt: String(promo.imageAlt || ""),
      image_name: String(promo.imageName || ""),
      button_label: String(promo.buttonLabel || "Shop Now"),
      enabled: Boolean(promo.enabled),
      sort_order: index,
    }));
}

function renderResultCards(cards) {
  if (!cards.length) return;

  if (state.view === "films" || state.view === "days") {
    cards.forEach((card) => elements.results.appendChild(card));
    return;
  }

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
  const minColumnWidth = state.view === "films" || state.view === "days"
    ? FILMS_MASONRY_MIN_COLUMN_WIDTH
    : MASONRY_MIN_COLUMN_WIDTH;
  return Math.max(1, Math.floor((width + MASONRY_GAP_PX) / (minColumnWidth + MASONRY_GAP_PX)));
}

function captureFilmCardRects() {
  const rects = new Map();
  if (state.view !== "films" && state.view !== "days") return rects;
  elements.results.querySelectorAll(".group-card[data-film-key]").forEach((card) => {
    const key = card.dataset.filmKey;
    if (!key) return;
    rects.set(key, card.getBoundingClientRect());
  });
  return rects;
}

function animateFilmCardLayout(previousRects) {
  if (state.view !== "films" && state.view !== "days") return;
  if (!previousRects || !previousRects.size) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  elements.results.querySelectorAll(".group-card[data-film-key]").forEach((card) => {
    const key = card.dataset.filmKey;
    if (!key) return;
    const before = previousRects.get(key);
    if (!before) return;
    const after = card.getBoundingClientRect();
    const deltaX = before.left - after.left;
    const deltaY = before.top - after.top;
    const scaleX = before.width / Math.max(after.width, 1);
    const scaleY = before.height / Math.max(after.height, 1);
    const moved =
      Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5 || Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01;
    if (!moved) return;

    card.getAnimations().forEach((animation) => animation.cancel());
    card.animate(
      [
        { transformOrigin: "top left", transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})` },
        { transformOrigin: "top left", transform: "translate(0, 0) scale(1, 1)" },
      ],
      {
        duration: FILM_LAYOUT_ANIMATION_MS,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      }
    );
  });
}

function syncPublicSearchUI() {
  if (!elements.publicSearchWrap || !elements.publicSearchInput) return;
  syncLatestPostVisibility();
  if (state.view === "films") {
    elements.publicSearchWrap.classList.remove("hidden");
    elements.publicSearchInput.placeholder = "Search films...";
    elements.publicSearchInput.value = state.publicSearch.films;
  } else if (state.view === "theatres") {
    elements.publicSearchWrap.classList.remove("hidden");
    elements.publicSearchInput.placeholder = "Search theatres or town...";
    elements.publicSearchInput.value = state.publicSearch.theatres;
  } else {
    elements.publicSearchWrap.classList.add("hidden");
    elements.publicSearchInput.value = "";
  }
  updateTheatreSortStatus();
}

function syncLatestPostVisibility() {
  if (!elements.latestPost) return;
  elements.latestPost.classList.toggle("hidden", state.view !== "days");
}

function getPublicSearchQueryForView(view) {
  if (view === "films") return normalizeSearchText(state.publicSearch.films);
  if (view === "theatres") return normalizeSearchText(state.publicSearch.theatres);
  return "";
}

function normalizeSearchText(value) {
  return stripDiacritics(value)
    .trim()
    .toLowerCase();
}

function getPageScrollTop() {
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}

function setPageScrollTop(value) {
  const top = Math.max(0, Number(value) || 0);
  window.scrollTo(0, top);
}

async function ensureTheatreDistanceSort() {
  if (state.theatreDistanceStatus === "loading" || state.theatreDistanceStatus === "ready") return;
  if (state.theatreDistanceByKey.size) {
    state.theatreDistanceStatus = "ready";
    updateTheatreSortStatus();
    return;
  }
  if (!("geolocation" in navigator)) {
    state.theatreDistanceStatus = "unavailable";
    state.theatreDistanceError = "geolocation-not-supported";
    updateTheatreSortStatus();
    return;
  }

  state.theatreDistanceStatus = "loading";
  state.theatreDistanceError = "";
  updateTheatreSortStatus();
  try {
    const position = await getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 7000,
      maximumAge: 5 * 60 * 1000,
    });
    state.userCoords = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };

    const cache = readTheatreGeoCache();
    const now = Date.now();
    const theatres = state.data.theatreGroups || [];
    for (const theatre of theatres) {
      const distanceKey = buildTheatreDistanceKey(theatre);
      if (!distanceKey) continue;
      const cacheEntry = cache[distanceKey];
      let coords = null;
      if (cacheEntry && now - Number(cacheEntry.updatedAt || 0) < THEATRE_GEO_CACHE_TTL_MS) {
        coords = { lat: Number(cacheEntry.lat), lng: Number(cacheEntry.lng) };
      } else {
        coords = await geocodeTheatre(theatre);
        if (coords) {
          cache[distanceKey] = {
            lat: coords.lat,
            lng: coords.lng,
            updatedAt: now,
          };
        }
      }
      if (!coords) continue;
      const miles = haversineMiles(state.userCoords.lat, state.userCoords.lng, coords.lat, coords.lng);
      if (Number.isFinite(miles)) {
        state.theatreDistanceByKey.set(distanceKey, miles);
      }
    }
    writeTheatreGeoCache(cache);
    state.theatreDistanceStatus = "ready";
    state.theatreDistanceError = "";
  } catch (error) {
    state.theatreDistanceStatus = "unavailable";
    const code = Number(error?.code);
    if (code === 1) {
      state.theatreDistanceError = "location-permission-denied";
    } else if (code === 2) {
      state.theatreDistanceError = "location-unavailable";
    } else if (code === 3) {
      state.theatreDistanceError = "location-timeout";
    } else {
      state.theatreDistanceError = "location-request-failed";
    }
  }

  updateTheatreSortStatus();
  if (state.view === "theatres") render();
}

function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function buildTheatreDistanceKey(theatre) {
  if (!theatre) return "";
  return [
    normalizeSearchText(theatre.name),
    normalizeSearchText(theatre.city),
    normalizeSearchText(theatre.address),
  ].join("::");
}

function buildTheatreGeocodeQueries(theatre) {
  const name = String(theatre?.name || "").trim();
  const address = String(theatre?.address || "").trim();
  const city = String(theatre?.city || "").trim();
  const statePart = "Maine";
  const countryPart = "USA";
  const queries = [
    [address, city, statePart, countryPart].filter(Boolean).join(", "),
    [name, address, city, statePart, countryPart].filter(Boolean).join(", "),
    [name, city, statePart, countryPart].filter(Boolean).join(", "),
    [city, statePart, countryPart].filter(Boolean).join(", "),
  ];
  return Array.from(new Set(queries.filter(Boolean)));
}

async function geocodeTheatre(theatre) {
  const queries = buildTheatreGeocodeQueries(theatre);
  for (const query of queries) {
    const viaNominatim = await geocodeWithNominatimJsonp(query);
    if (viaNominatim) return viaNominatim;
    const viaPhoton = await geocodeWithPhoton(query);
    if (viaPhoton) return viaPhoton;
  }
  return null;
}

async function geocodeWithNominatimJsonp(query) {
  if (!query) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
    const json = await geocodeTheatreJsonp(url);
    const first = Array.isArray(json) ? json[0] : null;
    if (!first) return null;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

async function geocodeWithPhoton(query) {
  if (!query) return null;
  try {
    const url = `https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const json = await response.json();
    const feature = Array.isArray(json?.features) ? json.features[0] : null;
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

function geocodeTheatreJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `__theatreGeoCb_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Geocode JSONP timeout"));
    }, 10000);

    function cleanup() {
      window.clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Geocode JSONP failed"));
    };
    script.src = `${url}&json_callback=${callbackName}`;
    document.head.appendChild(script);
  });
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 3958.7613 * c;
}

function readTheatreGeoCache() {
  try {
    const raw = localStorage.getItem(THEATRE_GEO_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeTheatreGeoCache(cache) {
  try {
    localStorage.setItem(THEATRE_GEO_CACHE_KEY, JSON.stringify(cache || {}));
  } catch {
    // Ignore storage failures (private mode/quota).
  }
}

function updateTheatreSortStatus() {
  const el = elements.theatreSortStatus;
  if (!el) return;
  if (state.view !== "theatres") {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }

  el.classList.remove("hidden");
  const distanceCount = state.theatreDistanceByKey.size;
  if (state.theatreDistanceStatus === "loading") {
    el.textContent = "Theatre sort: trying location-based order...";
    return;
  }
  if (state.theatreDistanceStatus === "ready") {
    if (distanceCount > 0) {
      el.textContent = `Theatre sort: nearest first (${distanceCount} theatres distance-ranked).`;
    } else {
      el.textContent = "Theatre sort: location found, but no theatre distances resolved. Showing alphabetical order.";
    }
    return;
  }
  if (state.theatreDistanceStatus === "unavailable") {
    const reason = state.theatreDistanceError ? ` (${state.theatreDistanceError})` : "";
    el.textContent = `Theatre sort: location unavailable${reason}. Showing alphabetical order.`;
    return;
  }
  el.textContent = "Theatre sort: alphabetical (location not requested yet).";
}

function stripDiacritics(value) {
  const text = String(value || "");
  if (typeof text.normalize !== "function") return text;
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeSortTitle(value) {
  return String(value || "")
    .trim()
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/^the\s+/i, "")
    .toLowerCase();
}

function getFilmGroupSortScore(group) {
  const filmInfo = group?.filmInfo || {};
  const popularity = normalizeScoreRange(toFiniteNumber(filmInfo.popularity), 100);
  const voteAverage = normalizeScoreRange(toFiniteNumber(filmInfo.voteAverage), 10);
  const voteCount = toFiniteNumber(filmInfo.voteCount);
  const voteConfidence = normalizeLogRange(voteCount, 10000);
  const ratingScore = voteAverage * voteConfidence;
  const releaseRecency = calculateReleaseRecencyScore(filmInfo.releaseDate);
  const freshness = calculateTmdbFreshnessMultiplier(filmInfo.matchedAt);

  const upcomingTimes = countGroupUpcomingTimes(group);
  const theatreCoverage = normalizeLogRange(countGroupTheatreCoverage(group), 30);
  const upcomingShowings = normalizeLogRange(upcomingTimes, 80);

  const tmdbScore =
    FILM_SORT_WEIGHTS.tmdbPopularity * popularity +
    FILM_SORT_WEIGHTS.tmdbRating * ratingScore +
    FILM_SORT_WEIGHTS.tmdbRecency * releaseRecency;
  const localDemandScore =
    FILM_SORT_WEIGHTS.upcomingShowings * upcomingShowings +
    FILM_SORT_WEIGHTS.theatreCoverage * theatreCoverage;

  return tmdbScore * freshness + localDemandScore;
}

function countGroupUpcomingTimes(group) {
  return (group?.shows || []).reduce((total, show) => {
    const times = Object.values(show?.dates || {}).reduce((count, dateTimes) => count + (dateTimes?.length || 0), 0);
    return total + times;
  }, 0);
}

function countGroupTheatreCoverage(group) {
  const keys = new Set();
  (group?.shows || []).forEach((show) => {
    keys.add(`${show?.theatre || ""}::${show?.city || ""}`);
  });
  return keys.size;
}

function calculateReleaseRecencyScore(releaseDate) {
  const release = parseIsoDateLike(releaseDate);
  if (!release) return 0;
  const now = new Date();
  const daysSinceRelease = (now.getTime() - release.getTime()) / 86400000;
  if (!Number.isFinite(daysSinceRelease)) return 0;
  if (daysSinceRelease <= 0) return 1;
  if (daysSinceRelease >= RELEASE_RECENCY_WINDOW_DAYS) return 0;
  return 1 - (daysSinceRelease / RELEASE_RECENCY_WINDOW_DAYS);
}

function calculateTmdbFreshnessMultiplier(matchedAt) {
  const matched = parseIsoDateTimeLike(matchedAt);
  if (!matched) return 0.35;
  const ageDays = (Date.now() - matched.getTime()) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  const decay = Math.exp((-Math.LN2 * ageDays) / TMDB_FRESHNESS_HALF_LIFE_DAYS);
  return Math.max(TMDB_FRESHNESS_FLOOR, decay);
}

function normalizeScoreRange(value, max) {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

function normalizeLogRange(value, expectedHigh) {
  if (!Number.isFinite(value) || value <= 0 || expectedHigh <= 0) return 0;
  return Math.max(0, Math.min(1, Math.log1p(value) / Math.log1p(expectedHigh)));
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIsoDateLike(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const head = raw.slice(0, 10);
  return parseIsoDate(head);
}

function parseIsoDateTimeLike(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function getRowEarliestShowtimeTimestamp(row) {
  let earliest = Number.POSITIVE_INFINITY;
  Object.entries(row?.dates || {}).forEach(([date, times]) => {
    (times || []).forEach((time) => {
      const dateTime = getShowDateTime(date, time);
      if (!dateTime) return;
      const value = dateTime.getTime();
      if (value < earliest) earliest = value;
    });
  });
  return earliest;
}

function ensureSelectedDay() {
  if (parseIsoDate(state.selectedDay)) return state.selectedDay;
  state.selectedDay = toIsoDate(new Date());
  return state.selectedDay;
}

function shiftSelectedDay(direction) {
  if (state.view !== "days") return;
  const activeDay = ensureSelectedDay();
  state.selectedDay = addDaysIso(activeDay, direction);
  render();
}

function syncDayPickerUI(activeDay) {
  if (!elements.dayPickerWrap || !elements.dayPickerInput) return;

  if (state.view !== "days") {
    elements.dayPickerWrap.classList.add("hidden");
    return;
  }

  elements.dayPickerWrap.classList.remove("hidden");
  elements.dayPickerInput.disabled = false;
  elements.dayPrevButton.disabled = false;
  elements.dayNextButton.disabled = false;

  if (!activeDay) {
    elements.dayPickerInput.value = "";
    elements.dayPickerInput.title = "Select a date";
    elements.dayPrevButton.disabled = true;
    elements.dayNextButton.disabled = true;
    return;
  }

  elements.dayPickerInput.value = activeDay;
  elements.dayPickerInput.title = formatLongDisplayDate(activeDay);
}

function buildSingleDayGroups(theatres, selectedDate) {
  const grouped = {};
  const now = new Date();

  theatres.forEach((theatre) => {
    (theatre.films || []).forEach((film) => {
      const metadata = extractFilmMetadata(film);
      const year = Number.isInteger(Number(film.year)) ? Number(film.year) : null;
      const times = [];

      (film.showings || []).forEach((showing) => {
        if (showing.date !== selectedDate) return;
        (showing.times || []).forEach((time) => {
          const showDateTime = getShowDateTime(showing.date, time);
          if (!showDateTime || showDateTime < now) return;
          times.push(time);
        });
      });

      if (!times.length) return;
      times.sort(compareTimes);

      const filmKey = buildFilmGroupKey(film.title, year);
      const groupKey = `film::${filmKey}`;
      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          theatreInfo: null,
          dayInfo: { date: selectedDate },
          filmInfo: {
            film: film.title,
            year,
            posterUrl: metadata.posterUrl,
            director: metadata.director,
            stars: metadata.stars,
            genres: metadata.genres,
            popularity: metadata.popularity,
            voteAverage: metadata.voteAverage,
            voteCount: metadata.voteCount,
            releaseDate: metadata.releaseDate,
            matchedAt: metadata.matchedAt,
          },
          shows: [],
        };
      }

      grouped[groupKey].shows.push({
        theatre: theatre.name,
        city: theatre.city,
        film: film.title,
        year,
        ticketLink: film.ticketLink,
        dates: {
          [selectedDate]: times,
        },
      });
    });
  });

  return grouped;
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
        popularity: metadata.popularity,
        voteAverage: metadata.voteAverage,
        voteCount: metadata.voteCount,
        releaseDate: metadata.releaseDate,
        matchedAt: metadata.matchedAt,
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

      if (view === "films") {
        const key = `film::${buildFilmGroupKey(row.film, row.year)}`;
        if (!grouped[key]) {
          grouped[key] = {
            theatreInfo: null,
            dayInfo: null,
            filmInfo: row,
            shows: [],
          };
        }
        grouped[key].shows.push(row);
        return;
      }

      if (view === "theatres") {
        const key = `${theatre.name} · ${theatre.city}`;
        if (!grouped[key]) {
          grouped[key] = {
            theatreInfo,
            dayInfo: null,
            filmInfo: null,
            shows: [],
          };
        }
        grouped[key].shows.push(row);
        return;
      }

      if (view === "days") {
        Object.entries(row.dates).forEach(([date, times]) => {
          if (!grouped[date]) {
            grouped[date] = {
              theatreInfo: null,
              dayInfo: { date },
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

function buildExpandCardKey(view, group) {
  const filmKey = buildFilmGroupKey(group?.filmInfo?.film || "", group?.filmInfo?.year);
  if (view === "films") return `films::${filmKey}`;
  if (view === "theatres") {
    return [
      "theatres",
      group?.theatreInfo?.name || "",
      group?.theatreInfo?.city || "",
      filmKey,
    ].join("::");
  }
  if (view === "days") {
    return [
      "days",
      group?.dayInfo?.date || "",
      filmKey,
    ].join("::");
  }
  return `${view}::${filmKey}`;
}

function buildExpandRowKey(view, group, show) {
  const filmKey = buildFilmGroupKey(show?.film || "", show?.year);
  if (view === "theatres") {
    return [
      "theatres-row",
      group?.theatreInfo?.name || "",
      group?.theatreInfo?.city || "",
      filmKey,
    ].join("::");
  }
  if (view === "days") {
    return [
      "days-row",
      group?.dayInfo?.date || "",
      filmKey,
    ].join("::");
  }
  return `${view}-row::${filmKey}`;
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
  const popularityRaw = tmdb.popularity ?? tmdb.popularity_score ?? film.popularity;
  const voteAverageRaw = tmdb.voteAverage ?? tmdb.vote_average ?? film.voteAverage ?? film.vote_average;
  const voteCountRaw = tmdb.voteCount ?? tmdb.vote_count ?? film.voteCount ?? film.vote_count;
  const releaseDate = String(tmdb.releaseDate || tmdb.release_date || film.releaseDate || film.release_date || "").trim();
  const matchedAt = String(tmdb.matchedAt || tmdb.matched_at || "").trim();
  const genres = normalizeStringArray(tmdb.genres || film.genres);
  const stars = normalizeStringArray(tmdb.stars || film.stars);
  const director = typeof (tmdb.director || film.director) === "string" ? (tmdb.director || film.director).trim() : "";
  const posterUrl = normalizePosterUrl(tmdb.posterUrl || tmdb.posterPath || film.posterUrl || film.posterPath);
  const popularity = toFiniteNumber(popularityRaw);
  const voteAverage = toFiniteNumber(voteAverageRaw);
  const voteCount = toFiniteNumber(voteCountRaw);
  return { genres, stars, director, posterUrl, popularity, voteAverage, voteCount, releaseDate, matchedAt };
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

function formatLongDisplayDate(dateIso) {
  const date = parseIsoDate(dateIso);
  if (!date) return dateIso;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function toIsoDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayDifferenceFromToday(targetDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDay = Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((targetDay - todayDay) / 86400000);
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
