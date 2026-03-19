import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DATA_URL = "./data/showtimes.json";
const FILM_PAGES_LIVE_SOURCE_URL = "./data/film-pages-source.live.json";
const FILM_PAGES_SOURCE_URL = "./data/film-pages-source.json";
const STORAGE_KEY = "showtimes-local-edit";
const TMDB_KEY_STORAGE_KEY = "tmdb-api-key-local";
const THEME_STORAGE_KEY = "tmp-theme";
const VIEW_STORAGE_KEY = "tmp-view";
const NO_POSTER_IMAGE_URL = "./assets/images/noposter.webp";
const PLAYWEEK_RECOMMENDS_STAMP_URL = "./assets/images/playweek%20recommends.png";
const FEATURED_ON_PLAYWEEK_STAMP_URL = "./assets/images/featured%20on%20playweek.png";
const PROMO_STORAGE_BUCKET = "promo-images";
const MASONRY_MIN_COLUMN_WIDTH = 280;
const FILMS_MASONRY_MIN_COLUMN_WIDTH = 170;
const MASONRY_GAP_PX = 16;
const PROMOTED_CARDS = Object.freeze([
  {
    title: "The Golden Statue Collection",
    imagePath: "assets/images/golden_statue_promo.gif",
    imageAlt: "The Golden Statue Collection",
    buttonLabel: "Shop Now",
    buttonUrl: "https://shop.themaineplayweek.com",
  },
  {
    title: "TMP Newspaper Tee",
    imagePath: "assets/images/newspaper_promo.gif",
    imageAlt: "TMP Newspaper Tee",
    buttonLabel: "Shop Now",
    buttonUrl: "https://themaineplayweek.printful.me/product/unisex-garment-dyed-heavyweight-t-shirt",
  },
]);
const THEATRE_COLLAPSED_FILM_COUNT = 5;
const FILM_LAYOUT_ANIMATION_MS = 320;
const FILM_SORT_WEIGHTS = Object.freeze({
  tmdbPopularity: 0.2,
  tmdbRating: 0.15,
  tmdbRecency: 0.1,
  upcomingShowings: 0.35,
  theatreCoverage: 0.15,
  staffFavoriteBoost: 0.12,
});
const RELEASE_RECENCY_WINDOW_DAYS = 14;
const SUBSTACK_ARCHIVE_URL = "https://themaineplayweek.substack.com/api/v1/archive?sort=new";
const THEATRE_GEO_CACHE_KEY = "theatre-geocode-cache-v1";
const THEATRE_GEO_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const DEFAULT_DAYS_VIEW_RADIUS_MILES = 50;
const LOCATION_PREFERENCE_STORAGE_KEY = "tmp-location-preference-v1";
const LOCATION_CHOOSER_SEEN_STORAGE_KEY = "tmp-location-chooser-seen-v1";

const SUPABASE_URL = "https://rjfsjoratsfqcyyjseqm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqZnNqb3JhdHNmcWN5eWpzZXFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Mzc5MDgsImV4cCI6MjA4ODIxMzkwOH0.dmcQ_ffwmm4JIKTjSUNNYLGQ9w_v1mR6VRMZimVnLNg";
const LOGO_SPIN_ANIMATION_MS = 420;
const LIGHT_THEME = "light";
const DARK_THEME = "dark";
const ENABLE_SUPABASE_DELTA_SAVE = false;
const LOCATION_ICON_DARK_MODE_SRC = "assets/icons/location-light.png";
const LOCATION_ICON_LIGHT_MODE_SRC = "assets/icons/location.png";
const WORDMARK_VARIANTS = Object.freeze([
  {
    darkSrc: "assets/brand/TMP Wordmark v01 Dark.png",
    lightSrc: "assets/brand/TMP Wordmark v01 Light.png",
  },
  {
    darkSrc: "assets/brand/TMP Wordmark v02 Dark.png",
    lightSrc: "assets/brand/TMP Wordmark v02 Light.png",
  },
  {
    darkSrc: "assets/brand/TMP Wordmark v03 Dark.png",
    lightSrc: "assets/brand/TMP Wordmark v03 Light.png",
  },
  {
    darkSrc: "assets/brand/TMP Wordmark v04 Dark.png",
    lightSrc: "assets/brand/TMP Wordmark v04 Light.png",
  },
  {
    darkSrc: "assets/brand/TMP Wordmark v05 Dark.png",
    lightSrc: "assets/brand/TMP Wordmark v05 Light.png",
  },
]);
const THEME_COLOR_MAP = {
  [LIGHT_THEME]: "#ECE5E0",
  [DARK_THEME]: "#121816",
};
const VALID_VIEWS = new Set(["films", "theatres", "days"]);

const state = {
  data: { theatreGroups: [] },
  view: "days",
  source: "json",
  loadedFromSupabaseThisSession: false,
  supabaseBaselinePayload: null,
  expandedFilmGroups: new Set(),
  theatreDistanceByKey: new Map(),
  theatreDistanceStatus: "idle",
  theatreDistanceError: "",
  userCoords: null,
  locationPreference: {
    mode: "unset",
    zip: "",
    lat: null,
    lng: null,
  },
  locationChooserSeen: false,
  publicSearch: {
    films: "",
    theatres: "",
  },
  selectedDay: "",
  daysViewRadiusMiles: DEFAULT_DAYS_VIEW_RADIUS_MILES,
  theme: LIGHT_THEME,
  brandWordmarkVariant: WORDMARK_VARIANTS[0],
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
  dayRadiusInput: document.getElementById("dayRadiusInput"),
  dayPrevButton: document.getElementById("dayPrevButton"),
  dayNextButton: document.getElementById("dayNextButton"),
  locationChooserModal: document.getElementById("locationChooserModal"),
  locationChooserTriggerWrap: document.getElementById("locationChooserTriggerWrap"),
  openLocationChooser: document.getElementById("openLocationChooser"),
  locationControlIcon: document.getElementById("locationControlIcon"),
  closeLocationChooser: document.getElementById("closeLocationChooser"),
  useDeviceLocation: document.getElementById("useDeviceLocation"),
  zipLocationForm: document.getElementById("zipLocationForm"),
  zipLocationInput: document.getElementById("zipLocationInput"),
  useZipLocation: document.getElementById("useZipLocation"),
  locationChooserMessage: document.getElementById("locationChooserMessage"),
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
  modalTheatreLatitudeInput: document.getElementById("modalTheatreLatitudeInput"),
  modalTheatreLongitudeInput: document.getElementById("modalTheatreLongitudeInput"),
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
  addShowing: document.getElementById("addShowing"),
  showingsList: document.getElementById("showingsList"),
  promoSettingsList: document.getElementById("promoSettingsList"),
  saveAllAdmin: document.getElementById("saveAllAdmin"),
  saveAllPromos: document.getElementById("saveAllPromos"),
  adminJson: document.getElementById("adminJson"),
  applyJson: document.getElementById("applyJson"),
  downloadCsvTemplate: document.getElementById("downloadCsvTemplate"),
  uploadCsv: document.getElementById("uploadCsv"),
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
  initializeBrandWordmarkVariant();
  initializeTheme();
  initializeViewPreference();
  loadLocationPreference();
  loadLocationChooserSeen();
  initializeSupabase();
  bindEvents();
  void loadLatestSubstackPost();
  await refreshAuthState();
  await loadData();
  initializeAdminState();
  loadAdminSettings();
  syncAdminEditor();
  syncPublicSearchUI();
  refreshLocationChooser();
  maybeShowLocationChooserOnFirstVisit();
  if ((state.view === "theatres" || state.view === "days") && hasConfiguredLocationPreference()) {
    void ensureTheatreDistanceSort();
  }
  updateTheatreSortStatus();
  render();
  registerSortDebugTools();
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
      const filmPageUrl = String(filmExpandToggle.dataset.filmPageUrl || "").trim();
      if (filmPageUrl) {
        window.open(filmPageUrl, "_blank", "noopener,noreferrer");
        return;
      }
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
      if (state.expandedFilmGroups.has(key)) {
        state.expandedFilmGroups.delete(key);
      } else {
        state.expandedFilmGroups.add(key);
      }
      render();
      requestAnimationFrame(() => {
        setPageScrollTop(scrollTopBefore);
        animateFilmCardLayout(previousRects);
      });
      return;
    }

    const tappedFilmCard = event.target.closest(".group-card.film-card");
    const isFilmCardView = state.view === "days";
    const isInteractiveTarget = Boolean(event.target.closest("a, button, input, select, textarea, summary, label"));
    const isFilmTitleTarget = Boolean(event.target.closest(".group-title-film"));
    const isCardBlankspaceTarget = event.target === tappedFilmCard;
    const isFilmCardTapToExpand =
      isFilmCardView &&
      Boolean(tappedFilmCard) &&
      tappedFilmCard.classList.contains("film-card-collapsed") &&
      !isInteractiveTarget;
    if (isFilmCardTapToExpand) {
      const key = tappedFilmCard.dataset.filmKey;
      if (!key || state.expandedFilmGroups.has(key)) return;
      const scrollTopBefore = getPageScrollTop();
      const previousRects = captureFilmCardRects();
      state.expandedFilmGroups.add(key);
      render();
      requestAnimationFrame(() => {
        setPageScrollTop(scrollTopBefore);
        animateFilmCardLayout(previousRects);
      });
      return;
    }

    const isFilmCardTapToCollapse =
      isFilmCardView &&
      Boolean(tappedFilmCard) &&
      !tappedFilmCard.classList.contains("film-card-collapsed") &&
      !isInteractiveTarget &&
      (isFilmTitleTarget || isCardBlankspaceTarget);
    if (isFilmCardTapToCollapse) {
      const key = tappedFilmCard.dataset.filmKey;
      if (!key || !state.expandedFilmGroups.has(key)) return;
      const scrollTopBefore = getPageScrollTop();
      const previousRects = captureFilmCardRects();
      state.expandedFilmGroups.delete(key);
      render();
      requestAnimationFrame(() => {
        setPageScrollTop(scrollTopBefore);
        animateFilmCardLayout(previousRects);
      });
      return;
    }

    const poster = event.target.closest(".group-film-poster, .show-poster");
    if (!poster || poster.classList.contains("hidden")) return;
    const posterFilmPageUrl = String(poster.dataset.filmPageUrl || "").trim();
    if (posterFilmPageUrl) {
      window.open(posterFilmPageUrl, "_blank", "noopener,noreferrer");
      return;
    }
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

  elements.dayRadiusInput?.addEventListener("change", () => {
    const requestedRadius = Number(elements.dayRadiusInput.value);
    state.daysViewRadiusMiles =
      Number.isFinite(requestedRadius) && requestedRadius > 0
        ? requestedRadius
        : DEFAULT_DAYS_VIEW_RADIUS_MILES;
    render();
  });

  elements.openLocationChooser?.addEventListener("click", () => {
    openLocationChooserModal();
  });

  elements.theatreSortStatus?.addEventListener("click", (event) => {
    const trigger = event.target.closest('[data-action="change-location"]');
    if (!trigger) return;
    event.preventDefault();
    openLocationChooserModal();
  });

  elements.closeLocationChooser?.addEventListener("click", () => {
    state.locationChooserSeen = true;
    persistLocationChooserSeen();
    closeLocationChooserModal();
  });

  elements.locationChooserModal?.addEventListener("cancel", () => {
    state.locationChooserSeen = true;
    persistLocationChooserSeen();
    setLocationChooserMessage("");
  });

  elements.useDeviceLocation?.addEventListener("click", async () => {
    if (!("geolocation" in navigator)) {
      setLocationChooserMessage("Location is not supported on this device. Use ZIP instead.");
      return;
    }
    elements.useDeviceLocation.disabled = true;
    setLocationChooserMessage("Checking browser location permissions...");
    try {
      await getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 7000,
        maximumAge: 5 * 60 * 1000,
      });
      state.locationPreference = {
        mode: "geolocation",
        zip: "",
        lat: null,
        lng: null,
      };
      persistLocationPreference();
      state.locationChooserSeen = true;
      persistLocationChooserSeen();
      closeLocationChooserModal();
      refreshLocationChooser();
      state.theatreDistanceByKey.clear();
      state.theatreDistanceStatus = "idle";
      state.theatreDistanceError = "";
      void ensureTheatreDistanceSort();
      render();
    } catch {
      setLocationChooserMessage("Could not access your location. You can use ZIP instead.");
    } finally {
      elements.useDeviceLocation.disabled = false;
    }
  });

  elements.zipLocationForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const zip = normalizeZipCode(elements.zipLocationInput?.value || "");
    if (!isValidZipCode(zip)) {
      setLocationChooserMessage("Enter a valid US ZIP code (e.g., 04101).");
      return;
    }
    elements.useZipLocation.disabled = true;
    setLocationChooserMessage("Looking up ZIP code location...");
    try {
      const coords = await geocodeZipCode(zip);
      if (!coords) {
        setLocationChooserMessage("Could not find that ZIP code. Try another ZIP.");
        return;
      }
      state.locationPreference = {
        mode: "zip",
        zip,
        lat: coords.lat,
        lng: coords.lng,
      };
      persistLocationPreference();
      state.locationChooserSeen = true;
      persistLocationChooserSeen();
      closeLocationChooserModal();
      refreshLocationChooser();
      state.theatreDistanceByKey.clear();
      state.theatreDistanceStatus = "idle";
      state.theatreDistanceError = "";
      void ensureTheatreDistanceSort();
      render();
    } finally {
      elements.useZipLocation.disabled = false;
    }
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

    renderPromoSettingsEditor();
    render();
    elements.adminMessage.textContent = "Promo settings updated.";
  });

  elements.promoSettingsList?.addEventListener("click", async (event) => {
    if (!requireAdminAuth()) return;
    const removeButton = event.target.closest("button[data-remove-promo-index]");
    if (!removeButton) return;
    const promoIndex = Number(removeButton.dataset.removePromoIndex);
    if (Number.isNaN(promoIndex) || promoIndex < 0 || promoIndex >= state.promotedCards.length) return;
    const promo = state.promotedCards[promoIndex];
    const label = String(promo?.title || promo?.imageName || "this promo").trim();
    const confirmed = window.confirm(`Delete ${label}?`);
    if (!confirmed) return;
    if (promo?.imagePath) {
      try {
        await deletePromoImageFromStorage(promo.imagePath);
      } catch {
        // Non-blocking: allow metadata delete even if storage cleanup fails.
      }
    }
    state.promotedCards.splice(promoIndex, 1);
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
      metadataSource: "manual",
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
    elements.editFilmMetadataModal.close();
    syncAdminEditor();
    elements.adminMessage.textContent = "Saved manual film metadata.";
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
      const details = await fetchTmdbMovieById(state.admin.tmdbApiKey, Number(film.tmdbId));
      film.tmdb = buildTmdbRecord(details);
      film.metadataSource = "tmdb";
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

  const handleSaveAllChanges = async () => {
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
      const saveResult = await persistData();
      if (saveResult.localDraftWarning) {
        elements.adminMessage.textContent = `All changes saved to Supabase. ${saveResult.localDraftWarning}`;
      } else {
        elements.adminMessage.textContent = "All changes saved to Supabase.";
      }
    } catch (error) {
      elements.adminMessage.textContent = `Save failed: ${error.message}. Run latest supabase/schema.sql and try again.`;
    } finally {
      state.admin.isSaving = false;
      syncAdminEditor();
    }
  };

  elements.saveAllAdmin.addEventListener("click", handleSaveAllChanges);
  elements.saveAllPromos?.addEventListener("click", handleSaveAllChanges);

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

  elements.downloadCsvTemplate?.addEventListener("click", () => {
    const header = [
      "theatre_name",
      "theatre_city",
      "film_title",
      "show_date",
      "show_times",
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
        "https://tickets.example.com/anora",
        "",
        "",
      ],
      ["Nickelodeon Cinema", "Portland", "Anora", "2026-03-13", "4:00 PM|7:45 PM", "", "", ""],
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
      const content = await file.text();
      // Preserve _dbId fields so CSV edits map to existing Supabase rows.
      const nextData = JSON.parse(JSON.stringify(state.data));
      const result = importShowtimesCsv(nextData, content);
      validateData(nextData);
      state.data = nextData;
      initializeAdminState();
      syncAdminEditor();
      render();
      elements.adminMessage.textContent =
        `Imported CSV: ${result.rowsProcessed} rows, ${result.showingDatesUpdated} showing date entries updated. ` +
        "Click Save All Changes to sync Supabase.";
      elements.uploadCsv.value = "";
    } catch (error) {
      elements.adminMessage.textContent = `CSV import failed: ${error.message}`;
    }
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

function initializeBrandWordmarkVariant() {
  if (!WORDMARK_VARIANTS.length) return;
  const randomIndex = Math.floor(Math.random() * WORDMARK_VARIANTS.length);
  state.brandWordmarkVariant = WORDMARK_VARIANTS[randomIndex] || WORDMARK_VARIANTS[0];
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
  refreshLocationChooser();
  maybeShowLocationChooserOnFirstVisit();
  if ((state.view === "theatres" || state.view === "days") && hasConfiguredLocationPreference()) {
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
    elements.brandLogo.src = normalizedTheme === DARK_THEME
      ? "assets/brand/TMP logo light.png"
      : "assets/brand/TMP logo dark.png";
  }

  if (elements.brandWordmark) {
    const variant = state.brandWordmarkVariant || WORDMARK_VARIANTS[0];
    elements.brandWordmark.src =
      normalizedTheme === DARK_THEME
        ? variant.lightSrc
        : variant.darkSrc;
  }

  if (elements.themeToggle) {
    const isDark = normalizedTheme === DARK_THEME;
    const nextThemeLabel = isDark ? "light" : "dark";
    elements.themeToggle.setAttribute("aria-label", `Switch to ${nextThemeLabel} mode`);
    elements.themeToggle.setAttribute("title", `Switch to ${nextThemeLabel} mode`);
  }

  if (elements.locationControlIcon) {
    elements.locationControlIcon.src =
      normalizedTheme === DARK_THEME ? LOCATION_ICON_DARK_MODE_SRC : LOCATION_ICON_LIGHT_MODE_SRC;
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
  state.promotedCards = cloneDefaultPromotedCards();

  if (state.supabase) {
    try {
      const fromDb = await loadDataFromSupabase();
      if (fromDb.theatreGroups.length) {
        validateData({ theatreGroups: fromDb.theatreGroups });
        state.data = { theatreGroups: fromDb.theatreGroups };
        state.promotedCards = fromDb.promotedCards;
        state.source = "supabase";
        state.loadedFromSupabaseThisSession = true;
        updateSupabaseBaselinePayload();
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
      state.supabaseBaselinePayload = null;
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`Failed to load ${DATA_URL}`);
    }
    const json = await response.json();
    validateData(json);
    state.data = json;
    state.source = "json";
    state.loadedFromSupabaseThisSession = false;
    state.supabaseBaselinePayload = null;
    return;
  } catch (error) {
    const fallbackData = await loadFallbackDataFromFilmPagesSource();
    if (!fallbackData) {
      throw error;
    }
    state.data = fallbackData;
    state.source = "film-pages-json";
    state.loadedFromSupabaseThisSession = false;
    state.supabaseBaselinePayload = null;
  }
}

async function loadFallbackDataFromFilmPagesSource() {
  const fallbackUrls = [FILM_PAGES_LIVE_SOURCE_URL, FILM_PAGES_SOURCE_URL];
  for (const url of fallbackUrls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const source = await response.json();
      const theatreGroups = buildTheatreGroupsFromFilmPagesSource(source);
      if (!theatreGroups.length) continue;
      const normalized = { theatreGroups };
      validateData(normalized);
      return normalized;
    } catch {
      // try next source
    }
  }
  return null;
}

function buildTheatreGroupsFromFilmPagesSource(source) {
  if (!source || !Array.isArray(source.films)) return [];
  const theatreMap = new Map();

  for (const filmEntry of source.films) {
    const filmTitle = String(filmEntry?.title || "").trim();
    const filmYear = Number.isInteger(Number(filmEntry?.year)) ? Number(filmEntry.year) : null;
    const tmdbId = Number.isInteger(Number(filmEntry?.tmdbId)) ? Number(filmEntry.tmdbId) : null;
    if (!filmTitle || (!filmYear && !tmdbId)) continue;

    const showings = Array.isArray(filmEntry?.showings) ? filmEntry.showings : [];
    for (const showing of showings) {
      const theatreName = String(showing?.theatre || "").trim();
      const theatreCity = String(showing?.city || "").trim();
      const showDate = String(showing?.date || "").trim();
      const showTime = String(showing?.time || "").trim();
      if (!theatreName || !theatreCity || !showDate || !showTime) continue;

      const theatreWebsite = String(showing?.theatreWebsite || "").trim();
      const theatreKey = `${theatreName.toLowerCase()}::${theatreCity.toLowerCase()}`;
      let theatre = theatreMap.get(theatreKey);
      if (!theatre) {
        theatre = {
          name: theatreName,
          city: theatreCity,
          address: "Address unavailable",
          website: theatreWebsite || "https://themaineplayweek.com",
          latitude: Number.isFinite(Number(showing?.latitude)) ? Number(showing.latitude) : undefined,
          longitude: Number.isFinite(Number(showing?.longitude)) ? Number(showing.longitude) : undefined,
          films: [],
          _filmMap: new Map(),
        };
        theatreMap.set(theatreKey, theatre);
      } else {
        if ((!theatre.website || theatre.website === "https://themaineplayweek.com") && theatreWebsite) {
          theatre.website = theatreWebsite;
        }
        if (!Number.isFinite(Number(theatre.latitude)) && Number.isFinite(Number(showing?.latitude))) {
          theatre.latitude = Number(showing.latitude);
        }
        if (!Number.isFinite(Number(theatre.longitude)) && Number.isFinite(Number(showing?.longitude))) {
          theatre.longitude = Number(showing.longitude);
        }
      }

      const filmKey = `${normalizeFilmTitle(filmTitle)}::${filmYear || ""}::${tmdbId || ""}`;
      let theatreFilm = theatre._filmMap.get(filmKey);
      if (!theatreFilm) {
        theatreFilm = {
          title: filmTitle,
          year: filmYear || undefined,
          tmdbId: tmdbId || undefined,
          ticketLink: String(showing?.ticketLink || filmEntry?.legacyTicketLink || "").trim(),
          staffFavorite: Boolean(filmEntry?.staffFavorite),
          staffFavoriteBy: String(filmEntry?.staffFavoriteBy || "").trim(),
          featuredOnPlayweek: Boolean(filmEntry?.featuredOnPlayweek),
          featuredOnPlayweekUrl: String(filmEntry?.featuredOnPlayweekUrl || "").trim(),
          metadataSource: normalizeMetadataSource("tmdb", { tmdbId }),
          tmdb: {
            overview: String(filmEntry?.description || "").trim(),
            posterUrl: String(filmEntry?.posterUrl || "").trim(),
            director: String(filmEntry?.director || "").trim(),
            genres: normalizeStringArray(filmEntry?.genres),
            stars: normalizeStringArray(filmEntry?.stars),
            releaseDate: String(filmEntry?.releaseDate || "").trim(),
            popularity: Number.isFinite(Number(filmEntry?.popularity)) ? Number(filmEntry.popularity) : undefined,
            voteAverage: Number.isFinite(Number(filmEntry?.voteAverage)) ? Number(filmEntry.voteAverage) : undefined,
            voteCount: Number.isFinite(Number(filmEntry?.voteCount)) ? Number(filmEntry.voteCount) : undefined,
          },
          showings: [],
          _showingByDate: new Map(),
        };
        theatre._filmMap.set(filmKey, theatreFilm);
        theatre.films.push(theatreFilm);
      } else if (!theatreFilm.ticketLink && showing?.ticketLink) {
        theatreFilm.ticketLink = String(showing.ticketLink || "").trim();
      }

      let filmShowing = theatreFilm._showingByDate.get(showDate);
      if (!filmShowing) {
        filmShowing = { date: showDate, times: [] };
        theatreFilm._showingByDate.set(showDate, filmShowing);
        theatreFilm.showings.push(filmShowing);
      }
      if (!filmShowing.times.includes(showTime)) {
        filmShowing.times.push(showTime);
      }
    }
  }

  const theatreGroups = Array.from(theatreMap.values());
  theatreGroups.forEach((theatre) => {
    theatre.films = theatre.films.filter((film) => Array.isArray(film.showings) && film.showings.length > 0);
    theatre.films.forEach((film) => {
      film.showings.sort((a, b) => a.date.localeCompare(b.date));
      film.showings.forEach((showing) => {
        showing.times.sort(compareTimes);
      });
      delete film._showingByDate;
    });
    theatre.films.sort((a, b) => {
      const titleCompare = normalizeSortTitle(a?.title || "").localeCompare(normalizeSortTitle(b?.title || ""));
      if (titleCompare !== 0) return titleCompare;
      return Number(b?.year || 0) - Number(a?.year || 0);
    });
    delete theatre._filmMap;
  });

  return theatreGroups.filter((theatre) => theatre.films.length > 0);
}

async function loadDataFromSupabase() {
  const theatres = await fetchAllRowsFromSupabase(() =>
    state.supabase.from("theatres").select("id,name,city,address,website,latitude,longitude").order("id", { ascending: true })
  );
  const films = await fetchAllRowsFromSupabase(() =>
    state.supabase
      .from("films")
      .select(
        "id,title,year,tmdb_id,synopsis,ticket_link,staff_favorite,staff_favorite_by,featured_on_playweek,featured_on_playweek_url,metadata_source,tmdb_json"
      )
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
      .select("id,title,button_url,image_path,image_alt,image_name,button_label,enabled,sort_order")
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
      latitude: Number.isFinite(Number(theatreRow.latitude)) ? Number(theatreRow.latitude) : undefined,
      longitude: Number.isFinite(Number(theatreRow.longitude)) ? Number(theatreRow.longitude) : undefined,
      films: [],
      _dbId: theatreRow.id,
      _filmMap: new Map(),
    };
    theatreById.set(theatreRow.id, entry);
    return entry;
  });

  films.forEach((filmRow) => {
    const tmdbJson = isPlainObject(filmRow.tmdb_json) ? { ...filmRow.tmdb_json } : {};
    const synopsis = String(filmRow.synopsis || "").trim();
    if (synopsis && !String(tmdbJson.overview || "").trim()) {
      tmdbJson.overview = synopsis;
    }
    filmById.set(filmRow.id, {
      title: filmRow.title,
      year: filmRow.year,
      tmdbId: filmRow.tmdb_id,
      synopsis,
      ticketLink: "",
      legacyTicketLink: filmRow.ticket_link || "",
      staffFavorite: Boolean(filmRow.staff_favorite),
      staffFavoriteBy: String(filmRow.staff_favorite_by || "").trim(),
      featuredOnPlayweek: Boolean(filmRow.featured_on_playweek),
      featuredOnPlayweekUrl: String(filmRow.featured_on_playweek_url || "").trim(),
      metadataSource: normalizeMetadataSource(filmRow.metadata_source, { tmdbId: filmRow.tmdb_id }),
      tmdb: tmdbJson,
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
        synopsis: String(filmTemplate.synopsis || ""),
        ticketLink: "",
        staffFavorite: Boolean(filmTemplate.staffFavorite),
        staffFavoriteBy: String(filmTemplate.staffFavoriteBy || ""),
        featuredOnPlayweek: Boolean(filmTemplate.featuredOnPlayweek),
        featuredOnPlayweekUrl: String(filmTemplate.featuredOnPlayweekUrl || ""),
        metadataSource: normalizeMetadataSource(filmTemplate.metadataSource, filmTemplate),
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
    if (typeof theatre?.latitude !== "undefined" && theatre.latitude !== null) {
      const latitude = Number(theatre.latitude);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        throw new Error(`Theatre "${theatre.name}" has invalid latitude.`);
      }
    }
    if (typeof theatre?.longitude !== "undefined" && theatre.longitude !== null) {
      const longitude = Number(theatre.longitude);
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new Error(`Theatre "${theatre.name}" has invalid longitude.`);
      }
    }
    const hasLatitude = Number.isFinite(Number(theatre?.latitude));
    const hasLongitude = Number.isFinite(Number(theatre?.longitude));
    if (hasLatitude !== hasLongitude) {
      throw new Error(`Theatre "${theatre.name}" must include both latitude and longitude.`);
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
      if (typeof film?.featuredOnPlayweekUrl !== "undefined" && typeof film?.featuredOnPlayweekUrl !== "string") {
        throw new Error(`Film "${film.title}" at "${theatre.name}" has invalid featuredOnPlayweekUrl.`);
      }
      if (typeof film?.metadataSource !== "undefined") {
        const metadataSource = String(film.metadataSource || "").trim().toLowerCase();
        if (metadataSource && metadataSource !== "tmdb" && metadataSource !== "manual") {
          throw new Error(`Film "${film.title}" at "${theatre.name}" has invalid metadataSource.`);
        }
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
  elements.editFilmMetadata.disabled = !hasFilm || state.admin.isSaving || state.admin.isRefreshingTmdb;
  elements.deleteFilm.disabled = !hasFilm;
  elements.refreshTmdb.disabled = !hasFilm || state.admin.isSaving || state.admin.isRefreshingTmdb;
  elements.showingDateInput.disabled = !hasFilm;
  elements.showingTimesInput.disabled = !hasFilm;
  elements.addShowing.disabled = !hasFilm;
  elements.saveAllAdmin.disabled = state.admin.isSaving || state.admin.isRefreshingTmdb;
  if (elements.saveAllPromos) {
    elements.saveAllPromos.disabled = state.admin.isSaving || state.admin.isRefreshingTmdb;
  }
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
  const requiredHeaders = ["theatre_name", "theatre_city", "film_title", "show_date", "show_times"];
  const missingHeaders = requiredHeaders.filter((key) => !headerIndexByKey.has(key));
  if (missingHeaders.length) {
    throw new Error(`Missing required CSV header(s): ${missingHeaders.join(", ")}`);
  }

  const stats = {
    rowsProcessed: 0,
    showingDatesUpdated: 0,
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
    const showDate = readCsvValue(row, headerIndexByKey, "show_date");
    const showTimesRaw = readCsvValue(row, headerIndexByKey, "show_times");

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
    if (!parsedTimes.length) {
      throw new Error(`Row ${rowNumber}: show_times must include at least one time.`);
    }
    const invalidTime = parsedTimes.find((time) => !to24HourTime(time));
    if (invalidTime) {
      throw new Error(`Row ${rowNumber}: invalid time "${invalidTime}". Use h:mm AM/PM.`);
    }

    const theatreMatches = data.theatreGroups.filter(
      (entry) => normalizeSearchText(entry?.name) === normalizeSearchText(theatreName)
    );
    if (!theatreMatches.length) {
      throw new Error(`Row ${rowNumber}: theatre "${theatreName}" was not found. Add it in admin first.`);
    }
    const theatre = theatreMatches.find(
      (entry) => normalizeSearchText(entry?.city) === normalizeSearchText(theatreCity)
    );
    if (!theatre) {
      throw new Error(
        `Row ${rowNumber}: theatre "${theatreName}" with city "${theatreCity}" was not found.`
      );
    }

    if (!Array.isArray(theatre.films)) theatre.films = [];
    const filmMatches = theatre.films.filter((entry) => {
      if (normalizeFilmTitle(entry?.title) !== normalizeFilmTitle(filmTitle)) return false;
      if (filmTmdbId !== null) return Number(entry?.tmdbId) === filmTmdbId;
      if (filmYear !== null) return Number(entry?.year) === filmYear;
      return true;
    });
    if (!filmMatches.length) {
      throw new Error(
        `Row ${rowNumber}: film "${filmTitle}" was not found at theatre "${theatre.name}". Add the film first.`
      );
    }
    if (filmMatches.length > 1 && filmTmdbId === null && filmYear === null) {
      throw new Error(
        `Row ${rowNumber}: multiple "${filmTitle}" entries at "${theatre.name}". Include film_year or film_tmdb_id.`
      );
    }

    const film = filmMatches[0];
    if (ticketLinkRaw) {
      film.ticketLink = normalizeOutboundUrl(ticketLinkRaw);
    }

    if (!Array.isArray(film.showings)) film.showings = [];
    const showing = film.showings.find((entry) => entry.date === showDate);
    if (showing) {
      const beforeCount = Array.isArray(showing.times) ? showing.times.length : 0;
      showing.times = Array.from(new Set([...(showing.times || []), ...parsedTimes])).sort(compareTimes);
      if (showing.times.length !== beforeCount) {
        stats.showingDatesUpdated += 1;
      }
    } else {
      film.showings.push({
        date: showDate,
        times: Array.from(new Set(parsedTimes)).sort(compareTimes),
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

function normalizeMetadataSource(value, film = null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "tmdb" || normalized === "manual") return normalized;
  const tmdbId = Number(film?.tmdbId);
  return Number.isInteger(tmdbId) && tmdbId > 0 ? "tmdb" : "manual";
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

function normalizeFilmTitle(value) {
  return stripDiacritics(String(value || ""))
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findFilmIndex(films, targetFilm) {
  const idx = films.findIndex((film) => filmsMatch(film, targetFilm));
  return idx >= 0 ? idx : 0;
}

function sortFilms(films) {
  films.sort((a, b) => buildFilmGroupKey(a.title, a.year).localeCompare(buildFilmGroupKey(b.title, b.year)));
}

async function persistData() {
  let localDraftWarning = "";
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripInternalFields(state.data)));
  } catch (error) {
    if (!isStorageQuotaExceeded(error)) throw error;
    localDraftWarning =
      "Could not cache a local browser draft because this browser storage is full.";
  }

  if (!state.supabase || !state.admin.auth.authenticated) {
    syncAdminEditor();
    render();
    return { localDraftWarning };
  }
  await saveDataToSupabase();
  const refreshed = await loadDataFromSupabase();
  validateData({ theatreGroups: refreshed.theatreGroups });
  state.data = { theatreGroups: refreshed.theatreGroups };
  state.promotedCards = refreshed.promotedCards;
  state.source = "supabase";
  state.loadedFromSupabaseThisSession = true;
  updateSupabaseBaselinePayload();
  syncAdminEditor();
  render();
  return { localDraftWarning };
}

function isStorageQuotaExceeded(error) {
  if (!error) return false;
  if (error?.name === "QuotaExceededError") return true;
  if (typeof error?.code === "number" && error.code === 22) return true;
  const message = String(error?.message || "").toLowerCase();
  return message.includes("quota") || message.includes("exceeded");
}

function updateSupabaseBaselinePayload() {
  state.supabaseBaselinePayload = buildReplacePayload(state.data, state.promotedCards);
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

  const baselinePayload = state.supabaseBaselinePayload;
  if (ENABLE_SUPABASE_DELTA_SAVE && baselinePayload) {
    const deltaPayload = buildShowtimesDeltaPayload(baselinePayload, payload);
    if (isDeltaPayloadEmpty(deltaPayload)) return;
    const deltaRpc = await supabase.rpc("apply_showtimes_delta", { payload: deltaPayload });
    if (!deltaRpc.error) return;
    if (!isMissingDeltaRpcError(deltaRpc.error)) throw deltaRpc.error;
  }

  const fullReplaceRpc = await supabase.rpc("replace_showtimes_data", { payload, allow_ticket_link_clear: false });
  if (fullReplaceRpc.error) throw fullReplaceRpc.error;
}

async function verifySupabaseSchema(supabase) {
  const checks = await Promise.all([
    supabase.from("theatres").select("id").limit(1),
    supabase.from("films").select("id,metadata_source").limit(1),
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
      latitude: Number.isFinite(Number(theatre.latitude)) ? Number(theatre.latitude) : null,
      longitude: Number.isFinite(Number(theatre.longitude)) ? Number(theatre.longitude) : null,
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
          synopsis: extractFilmSynopsis(film),
          metadata_source: normalizeMetadataSource(film.metadataSource, film),
          ticket_link: filmTicketLink,
          staff_favorite: Boolean(film.staffFavorite),
          staff_favorite_by: String(film.staffFavoriteBy || "").trim(),
          featured_on_playweek: Boolean(film.featuredOnPlayweek),
          featured_on_playweek_url: String(film.featuredOnPlayweekUrl || "").trim(),
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
        if (filmTicketLink) {
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

function buildShowtimesDeltaPayload(previousPayload, nextPayload) {
  const prevTheatresById = new Map(
    (previousPayload?.theatres || [])
      .filter((row) => Number.isInteger(Number(row?.db_id)))
      .map((row) => [Number(row.db_id), row])
  );
  const nextTheatresById = new Map(
    (nextPayload?.theatres || [])
      .filter((row) => Number.isInteger(Number(row?.db_id)))
      .map((row) => [Number(row.db_id), row])
  );
  const theatresUpsert = (nextPayload?.theatres || []).filter((row) => {
    const dbId = Number(row?.db_id);
    if (!Number.isInteger(dbId)) return true;
    const prev = prevTheatresById.get(dbId);
    if (!prev) return true;
    return hasTheatreRowChanges(prev, row);
  });
  const theatresDeleteIds = Array.from(prevTheatresById.keys()).filter((id) => !nextTheatresById.has(id));

  const prevFilmsById = new Map(
    (previousPayload?.films || [])
      .filter((row) => Number.isInteger(Number(row?.db_id)))
      .map((row) => [Number(row.db_id), row])
  );
  const nextFilmsById = new Map(
    (nextPayload?.films || [])
      .filter((row) => Number.isInteger(Number(row?.db_id)))
      .map((row) => [Number(row.db_id), row])
  );
  const filmsUpsert = (nextPayload?.films || []).filter((row) => {
    const dbId = Number(row?.db_id);
    if (!Number.isInteger(dbId)) return true;
    const prev = prevFilmsById.get(dbId);
    if (!prev) return true;
    return hasFilmRowChanges(prev, row);
  });
  const filmsDeleteIds = Array.from(prevFilmsById.keys()).filter((id) => !nextFilmsById.has(id));

  const prevLinksByKey = new Map((previousPayload?.theatre_films || []).map((row) => [buildTheatreFilmRowKey(row), row]));
  const nextLinksByKey = new Map((nextPayload?.theatre_films || []).map((row) => [buildTheatreFilmRowKey(row), row]));
  const theatreFilmsUpsert = (nextPayload?.theatre_films || []).filter((row) => {
    const prev = prevLinksByKey.get(buildTheatreFilmRowKey(row));
    if (!prev) return true;
    return String(prev.ticket_link || "") !== String(row.ticket_link || "");
  });
  const theatreFilmsDelete = (previousPayload?.theatre_films || [])
    .filter((row) => {
      const key = buildTheatreFilmRowKey(row);
      if (nextLinksByKey.has(key)) return false;
      return Number.isInteger(Number(row?.theatre_db_id)) && Number.isInteger(Number(row?.film_db_id));
    })
    .map((row) => ({
      theatre_db_id: Number(row.theatre_db_id),
      film_db_id: Number(row.film_db_id),
    }));

  const showingDelta = buildShowingsDelta(previousPayload?.showings || [], nextPayload?.showings || []);

  const prevPromosById = new Map(
    (previousPayload?.promos || [])
      .filter((row) => Number.isInteger(Number(row?.db_id)))
      .map((row) => [Number(row.db_id), row])
  );
  const nextPromosById = new Map(
    (nextPayload?.promos || [])
      .filter((row) => Number.isInteger(Number(row?.db_id)))
      .map((row) => [Number(row.db_id), row])
  );
  const promosUpsert = (nextPayload?.promos || []).filter((row) => {
    const dbId = Number(row?.db_id);
    if (!Number.isInteger(dbId)) return true;
    const prev = prevPromosById.get(dbId);
    if (!prev) return true;
    return hasPromoRowChanges(prev, row);
  });
  const promosDeleteIds = Array.from(prevPromosById.keys()).filter((id) => !nextPromosById.has(id));

  return {
    theatres_upsert: theatresUpsert,
    theatres_delete_ids: theatresDeleteIds,
    films_upsert: filmsUpsert,
    films_delete_ids: filmsDeleteIds,
    theatre_films_upsert: theatreFilmsUpsert,
    theatre_films_delete: theatreFilmsDelete,
    showings_replace_pairs: showingDelta.replacePairs,
    showings_upsert: showingDelta.upsertRows,
    promos_upsert: promosUpsert,
    promos_delete_ids: promosDeleteIds,
  };
}

function isDeltaPayloadEmpty(deltaPayload) {
  if (!deltaPayload || typeof deltaPayload !== "object") return true;
  return Object.values(deltaPayload).every((value) => !Array.isArray(value) || value.length === 0);
}

function isMissingDeltaRpcError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (!message.includes("apply_showtimes_delta")) return false;
  return (
    message.includes("could not find") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

function hasTheatreRowChanges(previousRow, nextRow) {
  return (
    String(previousRow?.name || "") !== String(nextRow?.name || "") ||
    String(previousRow?.city || "") !== String(nextRow?.city || "") ||
    String(previousRow?.address || "") !== String(nextRow?.address || "") ||
    String(previousRow?.website || "") !== String(nextRow?.website || "") ||
    nullableNumber(previousRow?.latitude) !== nullableNumber(nextRow?.latitude) ||
    nullableNumber(previousRow?.longitude) !== nullableNumber(nextRow?.longitude)
  );
}

function hasFilmRowChanges(previousRow, nextRow) {
  return (
    String(previousRow?.title || "") !== String(nextRow?.title || "") ||
    nullableInt(previousRow?.year) !== nullableInt(nextRow?.year) ||
    nullableInt(previousRow?.tmdb_id) !== nullableInt(nextRow?.tmdb_id) ||
    String(previousRow?.synopsis || "") !== String(nextRow?.synopsis || "") ||
    String(previousRow?.metadata_source || "") !== String(nextRow?.metadata_source || "") ||
    String(previousRow?.ticket_link || "") !== String(nextRow?.ticket_link || "") ||
    Boolean(previousRow?.staff_favorite) !== Boolean(nextRow?.staff_favorite) ||
    String(previousRow?.staff_favorite_by || "") !== String(nextRow?.staff_favorite_by || "") ||
    Boolean(previousRow?.featured_on_playweek) !== Boolean(nextRow?.featured_on_playweek) ||
    String(previousRow?.featured_on_playweek_url || "") !== String(nextRow?.featured_on_playweek_url || "") ||
    !areJsonValuesEqual(previousRow?.tmdb_json, nextRow?.tmdb_json)
  );
}

function hasPromoRowChanges(previousRow, nextRow) {
  return (
    String(previousRow?.title || "") !== String(nextRow?.title || "") ||
    String(previousRow?.button_url || "") !== String(nextRow?.button_url || "") ||
    String(previousRow?.image_path || "") !== String(nextRow?.image_path || "") ||
    String(previousRow?.image_alt || "") !== String(nextRow?.image_alt || "") ||
    String(previousRow?.image_name || "") !== String(nextRow?.image_name || "") ||
    String(previousRow?.button_label || "") !== String(nextRow?.button_label || "") ||
    Boolean(previousRow?.enabled) !== Boolean(nextRow?.enabled) ||
    nullableInt(previousRow?.sort_order) !== nullableInt(nextRow?.sort_order)
  );
}

function extractFilmSynopsis(film) {
  const directSynopsis = String(film?.synopsis || "").trim();
  if (directSynopsis) return directSynopsis;
  const tmdbSynopsis = String(film?.tmdb?.overview || "").trim();
  return tmdbSynopsis;
}

function buildTheatreFilmRowKey(row) {
  const theatreDbId = Number(row?.theatre_db_id);
  const filmDbId = Number(row?.film_db_id);
  if (Number.isInteger(theatreDbId) && Number.isInteger(filmDbId)) {
    return `db:${theatreDbId}:${filmDbId}`;
  }
  return `key:${String(row?.theatre_key || "")}:${String(row?.film_key || "")}`;
}

function buildShowingsDelta(previousRows, nextRows) {
  const previousPairs = indexShowingsByPair(previousRows);
  const nextPairs = indexShowingsByPair(nextRows);

  const replaceKeys = new Set();
  const upsertRows = [];

  nextPairs.forEach((nextEntry, key) => {
    const previousEntry = previousPairs.get(key);
    const previousSignature = previousEntry ? serializeShowingList(previousEntry.showings) : "";
    const nextSignature = serializeShowingList(nextEntry.showings);
    if (previousEntry && previousSignature === nextSignature) return;
    replaceKeys.add(key);
    nextEntry.showings.forEach((showing) => {
      upsertRows.push({
        theatre_key: nextEntry.theatreKey,
        film_key: nextEntry.filmKey,
        theatre_db_id: nextEntry.theatreDbId,
        film_db_id: nextEntry.filmDbId,
        show_date: showing.show_date,
        times: showing.times,
      });
    });
  });

  previousPairs.forEach((_entry, key) => {
    if (!nextPairs.has(key)) replaceKeys.add(key);
  });

  const replacePairs = Array.from(replaceKeys).map((key) => {
    const entry = nextPairs.get(key) || previousPairs.get(key);
    return {
      theatre_key: entry?.theatreKey || "",
      film_key: entry?.filmKey || "",
      theatre_db_id: entry?.theatreDbId,
      film_db_id: entry?.filmDbId,
    };
  });

  return { replacePairs, upsertRows };
}

function indexShowingsByPair(rows) {
  const index = new Map();
  (rows || []).forEach((row) => {
    const theatreDbId = nullableInt(row?.theatre_db_id);
    const filmDbId = nullableInt(row?.film_db_id);
    const theatreKey = String(row?.theatre_key || "");
    const filmKey = String(row?.film_key || "");
    const pairKey =
      Number.isInteger(theatreDbId) && Number.isInteger(filmDbId)
        ? `db:${theatreDbId}:${filmDbId}`
        : `key:${theatreKey}:${filmKey}`;
    if (!index.has(pairKey)) {
      index.set(pairKey, {
        theatreDbId,
        filmDbId,
        theatreKey,
        filmKey,
        showings: [],
      });
    }
    const entry = index.get(pairKey);
    entry.showings.push({
      show_date: String(row?.show_date || ""),
      times: Array.from(new Set(row?.times || [])).sort(compareTimes),
    });
  });

  index.forEach((entry) => {
    entry.showings.sort((a, b) => a.show_date.localeCompare(b.show_date));
  });
  return index;
}

function serializeShowingList(showings) {
  return JSON.stringify(showings || []);
}

function areJsonValuesEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function nullableInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function nullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    const selectedRadiusMiles = getDaysViewRadiusMiles();
    if (state.theatreDistanceStatus === "idle") {
      void ensureTheatreDistanceSort();
    }
    activeDay = ensureSelectedDay();
    syncDayPickerUI(activeDay);
    grouped = activeDay ? buildSingleDayGroups(state.data.theatreGroups, activeDay) : {};
    grouped = filterSingleDayGroupsByDistance(grouped, selectedRadiusMiles);
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
      entries = entries.filter(([, group]) => doesFilmStyleGroupMatchSearch(group, searchQuery));
    } else if (state.view === "theatres") {
      entries = entries.filter(([groupName, group]) => doesTheatreGroupMatchSearch(groupName, group, searchQuery));
    }
  }
  if (!entries.length) {
    const message = state.view === "films"
      ? "No films found..."
      : state.view === "theatres"
        ? "No theatres found..."
        : state.theatreDistanceStatus === "loading"
          ? "Finding nearby showtimes..."
          : state.theatreDistanceError === "location-not-configured"
            ? "Set your location or ZIP code to view nearby showtimes."
          : state.theatreDistanceStatus !== "ready"
            ? "Nearby showtimes require location access."
            : `No showtimes within ${getDaysViewRadiusMiles()} miles for this day...`;
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
      if (group.filmInfo.staffFavorite) {
        card.classList.add("film-card-staff-favorite");
        const favoriteStamp = document.createElement("img");
        favoriteStamp.className = "film-favorite-stamp";
        favoriteStamp.src = PLAYWEEK_RECOMMENDS_STAMP_URL;
        favoriteStamp.alt = "Playweek recommends";
        favoriteStamp.loading = "lazy";
        favoriteStamp.decoding = "async";
        if (group.filmInfo.staffFavoriteBy) {
          favoriteStamp.title = `Playweek recommends (${group.filmInfo.staffFavoriteBy})`;
        }
        favoriteStamp.onerror = () => {
          favoriteStamp.remove();
        };
        card.appendChild(favoriteStamp);
      }
      if (group.filmInfo.featuredOnPlayweek) {
        card.classList.add("film-card-featured-playweek");
        const featuredStamp = document.createElement("img");
        featuredStamp.className = "film-featured-stamp";
        featuredStamp.src = FEATURED_ON_PLAYWEEK_STAMP_URL;
        featuredStamp.alt = "Featured on the Playweek";
        featuredStamp.loading = "lazy";
        featuredStamp.decoding = "async";
        featuredStamp.onerror = () => {
          featuredStamp.remove();
        };
        card.appendChild(featuredStamp);
      }
    } else {
      groupTitle.textContent = groupName;
    }
    const subtitle = card.querySelector(".group-subtitle");
    const groupLink = card.querySelector(".group-link");
    const filmExpandToggle = card.querySelector(".film-expand-toggle");
    const groupFilmSummary = card.querySelector(".group-film-summary");
    const groupFilmPoster = card.querySelector(".group-film-poster");
    const groupFilmFacts = card.querySelector(".group-film-facts");
    const groupFeatureLink = card.querySelector(".group-feature-link");
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
      const shouldLinkToFilmPage = state.view === "films";
      filmGroupExpanded = shouldLinkToFilmPage ? false : state.expandedFilmGroups.has(filmGroupKey);
      card.dataset.filmKey = filmGroupKey;
      card.classList.toggle("film-card-collapsed", !filmGroupExpanded);

      if (filmGroupExpanded && groupFilmSummary) {
        const stamps = Array.from(card.querySelectorAll(".film-favorite-stamp, .film-featured-stamp"));
        stamps.forEach((stamp) => {
          groupFilmSummary.appendChild(stamp);
        });
      }

      if (filmExpandToggle) {
        if (shouldLinkToFilmPage) {
          filmExpandToggle.dataset.filmPageUrl = buildFilmPageUrl(group.filmInfo?.film, group.filmInfo?.year);
          filmExpandToggle.removeAttribute("data-film-key");
          filmExpandToggle.textContent = "View Film Page";
          filmExpandToggle.removeAttribute("aria-expanded");
        } else {
          filmExpandToggle.dataset.filmKey = filmGroupKey;
          filmExpandToggle.removeAttribute("data-film-page-url");
          filmExpandToggle.textContent = filmGroupExpanded ? "Collapse" : "Expand";
          filmExpandToggle.setAttribute("aria-expanded", String(filmGroupExpanded));
        }
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
        if (shouldLinkToFilmPage) {
          groupFilmPoster.dataset.filmPageUrl = buildFilmPageUrl(group.filmInfo?.film, group.filmInfo?.year);
        } else {
          groupFilmPoster.removeAttribute("data-film-page-url");
        }
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
      const tmdbUrl = buildTmdbMovieUrl(group.filmInfo.tmdbId);
      const groupFilmDetails = groupFilmFacts?.parentElement || groupFilmSummary;
      let groupTmdbLink = groupFilmDetails?.querySelector(".group-tmdb-link");
      if (!groupTmdbLink && groupFilmDetails) {
        groupTmdbLink = document.createElement("a");
        groupTmdbLink.className = "group-tmdb-link hidden";
        groupTmdbLink.target = "_blank";
        groupTmdbLink.rel = "noopener noreferrer";
        groupTmdbLink.textContent = "View on TMDb";
        if (groupFeatureLink && groupFeatureLink.parentElement === groupFilmDetails) {
          groupFilmDetails.insertBefore(groupTmdbLink, groupFeatureLink);
        } else {
          groupFilmDetails.appendChild(groupTmdbLink);
        }
      }
      if (groupTmdbLink) {
        if (filmGroupExpanded && tmdbUrl) {
          groupTmdbLink.href = tmdbUrl;
          groupTmdbLink.classList.remove("hidden");
        } else {
          groupTmdbLink.classList.add("hidden");
          groupTmdbLink.removeAttribute("href");
        }
      }
      if (groupFeatureLink) {
        const featuredUrl = normalizeOutboundUrl(group.filmInfo.featuredOnPlayweekUrl || "");
        const canShowFeatureLink = filmGroupExpanded && group.filmInfo.featuredOnPlayweek && Boolean(featuredUrl);
        if (canShowFeatureLink) {
          groupFeatureLink.href = featuredUrl;
          groupFeatureLink.classList.remove("hidden");
        } else {
          groupFeatureLink.classList.add("hidden");
          groupFeatureLink.removeAttribute("href");
        }
      }
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
          rowToggle.className = "film-expand-toggle theatre-row-toggle";
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

          if (state.view === "theatres") {
            renderSchedule(schedule, show.dates);
          }

          if (!rowExpanded) {
            meta.appendChild(rowToggle);
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
          if (rowExpanded) {
            item.appendChild(rowToggle);
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
    const imageSrc = resolvePromoImageSrc(promo);
    const hasImage = typeof imageSrc === "string" && imageSrc.trim();
    if (!hasImage) return visible;
    visible.push({
      ...promo,
      imageSrc,
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
    id: promo.imagePath,
    enabled: true,
    title: promo.title || "",
    imagePath: promo.imagePath,
    imageAlt: promo.imageAlt || "",
    imageName: promo.imagePath.split("/").pop() || promo.imagePath,
    buttonLabel: promo.buttonLabel || "Shop Now",
    buttonUrl: promo.buttonUrl || "",
  }));
}

function buildPromotedCardsFromSupabaseRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      id: `db-${row.id}`,
      enabled: typeof row.enabled === "boolean" ? row.enabled : true,
      title: String(row.title || ""),
      imagePath: String(row.image_path || ""),
      imageAlt: String(row.image_alt || ""),
      imageName: String(row.image_name || ""),
      buttonLabel: String(row.button_label || "Shop Now"),
      buttonUrl: String(row.button_url || ""),
    }))
    .filter((promo) => promo.imagePath);
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

function resolvePromoImageSrc(promo) {
  const path = String(promo?.imagePath || "").trim();
  if (!path) return "";
  if (path.startsWith("assets/") || path.startsWith("./assets/")) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return state.supabase?.storage?.from(PROMO_STORAGE_BUCKET).getPublicUrl(path)?.data?.publicUrl || "";
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
    elements.publicSearchInput.placeholder = "Search films or genres...";
    elements.publicSearchInput.value = state.publicSearch.films;
  } else if (state.view === "theatres") {
    elements.publicSearchWrap.classList.remove("hidden");
    elements.publicSearchInput.placeholder = "Search theatres, town, or film...";
    elements.publicSearchInput.value = state.publicSearch.theatres;
  } else {
    elements.publicSearchWrap.classList.add("hidden");
    elements.publicSearchInput.value = "";
  }
  refreshLocationChooser();
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

function doesFilmStyleGroupMatchSearch(group, query) {
  if (!query) return true;
  const filmTitleMatches = normalizeSearchText(group?.filmInfo?.film || "").includes(query);
  if (filmTitleMatches) return true;
  return normalizeStringArray(group?.filmInfo?.genres).some((genre) => normalizeSearchText(genre).includes(query));
}

function doesTheatreGroupMatchSearch(groupName, group, query) {
  if (!query) return true;
  const theatreName = group?.theatreInfo?.name || groupName;
  const theatreCity = group?.theatreInfo?.city || "";
  if (normalizeSearchText(theatreName).includes(query) || normalizeSearchText(theatreCity).includes(query)) {
    return true;
  }
  return (group?.shows || []).some((show) => normalizeSearchText(show?.film || "").includes(query));
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

function loadLocationPreference() {
  try {
    const raw = localStorage.getItem(LOCATION_PREFERENCE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const mode = parsed?.mode === "zip" || parsed?.mode === "geolocation" ? parsed.mode : "unset";
    const zip = normalizeZipCode(parsed?.zip || "");
    const lat = Number(parsed?.lat);
    const lng = Number(parsed?.lng);
    state.locationPreference = {
      mode,
      zip: mode === "zip" ? zip : "",
      lat: mode === "zip" && Number.isFinite(lat) ? lat : null,
      lng: mode === "zip" && Number.isFinite(lng) ? lng : null,
    };
  } catch {
    state.locationPreference = { mode: "unset", zip: "", lat: null, lng: null };
  }
}

function loadLocationChooserSeen() {
  state.locationChooserSeen = localStorage.getItem(LOCATION_CHOOSER_SEEN_STORAGE_KEY) === "1";
}

function persistLocationChooserSeen() {
  localStorage.setItem(LOCATION_CHOOSER_SEEN_STORAGE_KEY, state.locationChooserSeen ? "1" : "0");
}

function persistLocationPreference() {
  localStorage.setItem(LOCATION_PREFERENCE_STORAGE_KEY, JSON.stringify(state.locationPreference));
}

function hasConfiguredLocationPreference() {
  return state.locationPreference.mode === "zip" || state.locationPreference.mode === "geolocation";
}

function maybeShowLocationChooserOnFirstVisit() {
  if (state.locationChooserSeen || hasConfiguredLocationPreference()) return;
  openLocationChooserModal();
}

function openLocationChooserModal() {
  if (!elements.locationChooserModal) return;
  if (!elements.locationChooserMessage?.textContent) {
    setLocationChooserMessage("Use your location or ZIP code to sort nearby showtimes.");
  }
  if (typeof elements.locationChooserModal.showModal === "function") {
    if (!elements.locationChooserModal.open) {
      elements.locationChooserModal.showModal();
    }
    return;
  }
  elements.locationChooserModal.setAttribute("open", "open");
}

function closeLocationChooserModal() {
  if (!elements.locationChooserModal) return;
  setLocationChooserMessage("");
  if (typeof elements.locationChooserModal.close === "function") {
    if (elements.locationChooserModal.open) {
      elements.locationChooserModal.close();
    }
    return;
  }
  elements.locationChooserModal.removeAttribute("open");
}

function refreshLocationChooser() {
  if (!elements.locationChooserTriggerWrap) return;
  const shouldShow = state.view === "theatres" || state.view === "days";
  elements.locationChooserTriggerWrap.classList.toggle("hidden", !shouldShow);
  if (shouldShow && !elements.locationChooserMessage?.textContent) {
    setLocationChooserMessage("Use your location or ZIP code to sort nearby showtimes.");
  }
}

function setLocationChooserMessage(message) {
  if (!elements.locationChooserMessage) return;
  elements.locationChooserMessage.textContent = String(message || "");
}

function normalizeZipCode(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function isValidZipCode(zip) {
  return /^\d{5}(?:-\d{4})?$/.test(zip);
}

async function geocodeZipCode(zip) {
  const query = `${zip}, USA`;
  const viaNominatim = await geocodeWithNominatimJsonp(query);
  if (viaNominatim) return viaNominatim;
  const viaPhoton = await geocodeWithPhoton(query);
  if (viaPhoton) return viaPhoton;
  return null;
}

async function ensureTheatreDistanceSort() {
  if (state.theatreDistanceStatus === "loading" || state.theatreDistanceStatus === "ready") return;
  if (state.theatreDistanceByKey.size) {
    state.theatreDistanceStatus = "ready";
    updateTheatreSortStatus();
    return;
  }
  if (!hasConfiguredLocationPreference()) {
    state.theatreDistanceStatus = "unavailable";
    state.theatreDistanceError = "location-not-configured";
    refreshLocationChooser();
    updateTheatreSortStatus();
    if (state.view === "theatres" || state.view === "days") render();
    return;
  }

  state.theatreDistanceStatus = "loading";
  state.theatreDistanceError = "";
  updateTheatreSortStatus();
  try {
    if (state.locationPreference.mode === "zip") {
      const lat = Number(state.locationPreference.lat);
      const lng = Number(state.locationPreference.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        state.theatreDistanceStatus = "unavailable";
        state.theatreDistanceError = "zip-location-invalid";
        refreshLocationChooser();
        updateTheatreSortStatus();
        if (state.view === "theatres" || state.view === "days") render();
        return;
      }
      state.userCoords = { lat, lng };
    } else {
      if (!("geolocation" in navigator)) {
        state.theatreDistanceStatus = "unavailable";
        state.theatreDistanceError = "geolocation-not-supported";
        refreshLocationChooser();
        updateTheatreSortStatus();
        if (state.view === "theatres" || state.view === "days") render();
        return;
      }
      const position = await getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 7000,
        maximumAge: 5 * 60 * 1000,
      });
      state.userCoords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
    }

    const cache = readTheatreGeoCache();
    const now = Date.now();
    const theatres = state.data.theatreGroups || [];
    for (const theatre of theatres) {
      const distanceKey = buildTheatreDistanceKey(theatre);
      if (!distanceKey) continue;
      let coords = null;
      const storedCoords = getTheatreCoordinates(theatre);
      if (storedCoords) {
        coords = storedCoords;
      } else {
        const cacheEntry = cache[distanceKey];
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

  refreshLocationChooser();
  updateTheatreSortStatus();
  if (state.view === "theatres" || state.view === "days") render();
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

function getTheatreCoordinates(theatre) {
  const lat = Number(theatre?.latitude);
  const lng = Number(theatre?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
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
    setTheatreSortStatus("Finding theatres near you...");
    return;
  }
  if (state.theatreDistanceStatus === "ready") {
    if (distanceCount > 0) {
      if (state.locationPreference.mode === "zip" && state.locationPreference.zip) {
        setTheatreSortStatus(
          `Sorted by distance from ZIP ${state.locationPreference.zip} (${distanceCount} theatres).`,
          { includeChangeLocation: true }
        );
      } else {
        setTheatreSortStatus(
          `Sorted by distance from your current location (${distanceCount} theatres).`,
          { includeChangeLocation: true }
        );
      }
    } else {
      setTheatreSortStatus("Could not calculate theatre distances. Showing theatres A-Z.", { includeChangeLocation: true });
    }
    return;
  }
  if (state.theatreDistanceStatus === "unavailable") {
    if (state.theatreDistanceError === "location-not-configured") {
      setTheatreSortStatus("Set your location or ZIP code to sort theatres by distance.", { includeChangeLocation: true });
      return;
    }
    if (state.theatreDistanceError === "zip-location-invalid") {
      setTheatreSortStatus("Could not find that ZIP code. Try another ZIP or use current location.", { includeChangeLocation: true });
      return;
    }
    setTheatreSortStatus("Location unavailable. Showing theatres A-Z.", { includeChangeLocation: true });
    return;
  }
  setTheatreSortStatus("Showing theatres A-Z. Set location to sort by distance.", { includeChangeLocation: true });
}

function setTheatreSortStatus(message, options = {}) {
  const el = elements.theatreSortStatus;
  if (!el) return;
  const { includeChangeLocation = false } = options;
  el.textContent = String(message || "");
  if (!includeChangeLocation) return;
  const changeLocationButton = document.createElement("a");
  changeLocationButton.href = "#";
  changeLocationButton.className = "theatre-sort-change-link";
  changeLocationButton.dataset.action = "change-location";
  changeLocationButton.textContent = "Change location";
  el.appendChild(document.createTextNode(" "));
  el.appendChild(changeLocationButton);
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

function getFilmGroupSortBreakdown(group) {
  const filmInfo = group?.filmInfo || {};
  const popularity = normalizeScoreRange(toFiniteNumber(filmInfo.popularity), 100);
  const voteAverage = normalizeScoreRange(toFiniteNumber(filmInfo.voteAverage), 10);
  const voteCount = toFiniteNumber(filmInfo.voteCount);
  const voteConfidence = normalizeLogRange(voteCount, 10000);
  const ratingScore = voteAverage * voteConfidence;
  const releaseRecency = calculateReleaseRecencyScore(filmInfo.releaseDate);

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
  const editorialBoost = filmInfo.staffFavorite ? FILM_SORT_WEIGHTS.staffFavoriteBoost : 0;
  const finalScore = tmdbScore + localDemandScore + editorialBoost;

  return {
    finalScore,
    tmdbScore,
    localDemandScore,
    editorialBoost,
    inputs: {
      popularity,
      voteAverage,
      voteCount,
      voteConfidence,
      ratingScore,
      releaseRecency,
      upcomingTimes,
      upcomingShowings,
      theatreCoverage,
      staffFavorite: Boolean(filmInfo.staffFavorite),
      featuredOnPlayweek: Boolean(filmInfo.featuredOnPlayweek),
    },
    weights: FILM_SORT_WEIGHTS,
  };
}

function getFilmGroupSortScore(group) {
  return getFilmGroupSortBreakdown(group).finalScore;
}

function registerSortDebugTools() {
  if (typeof window === "undefined") return;
  const debugApi = {
    filmSortBreakdown(options = {}) {
      const query = normalizeSearchText(options.query || "");
      const limitRaw = Number(options.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : null;

      const grouped = buildGroups(state.data.theatreGroups, "films");
      const rows = Object.values(grouped).map((group) => {
        const filmInfo = group?.filmInfo || {};
        const breakdown = getFilmGroupSortBreakdown(group);
        return {
          film: String(filmInfo.film || "").trim(),
          year: Number.isFinite(Number(filmInfo.year)) ? Number(filmInfo.year) : null,
          score: breakdown.finalScore,
          tmdbScore: breakdown.tmdbScore,
          localDemandScore: breakdown.localDemandScore,
          editorialBoost: breakdown.editorialBoost,
          popularity: breakdown.inputs.popularity,
          ratingScore: breakdown.inputs.ratingScore,
          releaseRecency: breakdown.inputs.releaseRecency,
          voteAverage: breakdown.inputs.voteAverage,
          voteCount: breakdown.inputs.voteCount,
          voteConfidence: breakdown.inputs.voteConfidence,
          upcomingTimes: breakdown.inputs.upcomingTimes,
          upcomingShowings: breakdown.inputs.upcomingShowings,
          theatreCoverage: breakdown.inputs.theatreCoverage,
          staffFavorite: breakdown.inputs.staffFavorite,
          featuredOnPlayweek: breakdown.inputs.featuredOnPlayweek,
        };
      });

      const filtered = query
        ? rows.filter((row) => normalizeSearchText(row.film).includes(query))
        : rows;
      filtered.sort((a, b) => b.score - a.score);
      const finalRows = limit ? filtered.slice(0, limit) : filtered;
      console.table(finalRows);
      return finalRows;
    },
  };

  window.__tmpDebug = Object.freeze(debugApi);
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

function getDaysViewRadiusMiles() {
  const parsed = Number(state.daysViewRadiusMiles);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAYS_VIEW_RADIUS_MILES;
}

function filterSingleDayGroupsByDistance(groups, maxMiles) {
  const filtered = {};
  Object.entries(groups || {}).forEach(([key, group]) => {
    const nearbyShows = (group?.shows || []).filter((show) => {
      const theatreDistance = getDistanceForTheatre(show.theatre, show.city, show.address);
      return Number.isFinite(theatreDistance) && theatreDistance <= maxMiles;
    });
    if (!nearbyShows.length) return;
    filtered[key] = {
      ...group,
      shows: nearbyShows,
    };
  });
  return filtered;
}

function getDistanceForTheatre(name, city, address) {
  const key = buildTheatreDistanceKey({ name, city, address });
  if (!key) return Number.NaN;
  return Number(state.theatreDistanceByKey.get(key));
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
  if (elements.dayRadiusInput) {
    elements.dayRadiusInput.disabled = false;
    elements.dayRadiusInput.value = String(getDaysViewRadiusMiles());
  }
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
            tmdbId: Number.isInteger(Number(film.tmdbId)) ? Number(film.tmdbId) : null,
            posterUrl: metadata.posterUrl,
            director: metadata.director,
            stars: metadata.stars,
            genres: metadata.genres,
            staffFavorite: metadata.staffFavorite,
            staffFavoriteBy: metadata.staffFavoriteBy,
            featuredOnPlayweek: metadata.featuredOnPlayweek,
            featuredOnPlayweekUrl: metadata.featuredOnPlayweekUrl,
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
        address: theatre.address,
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
        tmdbId: Number.isInteger(Number(film.tmdbId)) ? Number(film.tmdbId) : null,
        ticketLink: film.ticketLink,
        posterUrl: metadata.posterUrl,
        director: metadata.director,
        stars: metadata.stars,
        genres: metadata.genres,
        staffFavorite: metadata.staffFavorite,
        staffFavoriteBy: metadata.staffFavoriteBy,
        featuredOnPlayweek: metadata.featuredOnPlayweek,
        featuredOnPlayweekUrl: metadata.featuredOnPlayweekUrl,
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
              tmdbId: row.tmdbId,
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

function buildTmdbMovieUrl(tmdbId) {
  const id = Number(tmdbId);
  if (!Number.isInteger(id) || id <= 0) return "";
  return `https://www.themoviedb.org/movie/${id}`;
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
  const staffFavorite = Boolean(film.staffFavorite ?? tmdb.staffFavorite ?? tmdb.staff_favorite);
  const staffFavoriteBy = String(film.staffFavoriteBy || tmdb.staffFavoriteBy || tmdb.staff_favorite_by || "").trim();
  const featuredOnPlayweek = Boolean(
    film.featuredOnPlayweek ?? tmdb.featuredOnPlayweek ?? tmdb.featured_on_playweek
  );
  const featuredOnPlayweekUrl = String(
    film.featuredOnPlayweekUrl || tmdb.featuredOnPlayweekUrl || tmdb.featured_on_playweek_url || ""
  ).trim();
  const popularity = toFiniteNumber(popularityRaw);
  const voteAverage = toFiniteNumber(voteAverageRaw);
  const voteCount = toFiniteNumber(voteCountRaw);
  return {
    genres,
    stars,
    director,
    posterUrl,
    staffFavorite,
    staffFavoriteBy,
    featuredOnPlayweek,
    featuredOnPlayweekUrl,
    popularity,
    voteAverage,
    voteCount,
    releaseDate,
    matchedAt,
  };
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

function buildFilmPageUrl(title, year) {
  const slug = slugifyFilmPageSegment(
    Number.isInteger(Number(year)) ? `${String(title || "")}-${Number(year)}` : String(title || "")
  );
  return `films/${slug}/`;
}

function slugifyFilmPageSegment(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    .slice(0, 80);
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
