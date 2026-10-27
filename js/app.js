import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { renderMapMarkers, showMapToggle, hideMapToggle } from "./map-view.js";
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_CLIENT_OPTIONS,
  markStagingPage,
  buildFilmPageUrl,
  compareTimes,
  debounce,
  formatDisplayDate,
  geocodeUsZip,
  LOCATION_PREFERENCE_STORAGE_KEY,
  getDayDifferenceFromToday,
  getFilmSortBreakdown,
  getShowDateTime,
  getShowtimeNote,
  initShowtimeNoteTooltips,
  normalizeOutboundUrl,
  normalizeSortTitle,
  parseIsoDate,
  toFiniteNumber,
} from "./shared.js";
import {
  PROMO_STORAGE_BUCKET,
  STORAGE_KEY,
  addDaysIso,
  buildFilmGroupKey,
  dedupeSortTimes,
  loadActiveDataFromSupabase,
  normalizeFilmTitle,
  normalizeMetadataSource,
  normalizePosterUrl,
  normalizeSearchText,
  normalizeStringArray,
  validateData,
} from "./data.js";

const FILM_PAGES_LIVE_SOURCE_URL = "./data/film-pages-source.live.json";
const FILM_PAGES_SOURCE_URL = "./data/film-pages-source.json";
const THEME_STORAGE_KEY = "tmp-theme";
const VIEW_STORAGE_KEY = "tmp-view";
const NO_POSTER_IMAGE_URL = "./assets/images/noposter.webp";
const PLAYWEEK_RECOMMENDS_STAMP_URL = "./assets/images/playweek%20recommends.png";
const FEATURED_ON_PLAYWEEK_STAMP_URL = "./assets/images/featured%20on%20playweek.png";
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
const THEATRE_GEO_CACHE_KEY = "theatre-geocode-cache-v1";
const THEATRE_GEO_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const DEFAULT_DAYS_VIEW_RADIUS_MILES = 50;
const DAYS_VIEW_RADIUS_STORAGE_KEY = "tmp-days-radius-v1";
const SEARCH_INPUT_DEBOUNCE_MS = 180;

const LOGO_SPIN_ANIMATION_MS = 420;
const LIGHT_THEME = "light";
const DARK_THEME = "dark";
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
const VALID_VIEWS = new Set(["films", "theatres", "days", "festivals"]);
const NAV_VIEW_LABELS = Object.freeze({
  days: "Near You",
  theatres: "Theatres",
  films: "All Films",
  festivals: "Festivals",
});

const state = {
  data: { theatreGroups: [], festivals: [] },
  view: "films",
  // Where state.data came from. Visitors get "supabase-active" (only films with upcoming
  // showtimes); the admin replaces it with the full "supabase" load, the only one it saves.
  source: "film-pages-json",
  loadedFromSupabaseThisSession: false,
  // data_version when the admin data was loaded; sent with saves so stale tabs are refused.
  dataVersion: null,
  dataLoadError: "",
  expandedFilmGroups: new Set(),
  expandedFestivals: new Set(),
  expandedFestivalDays: new Set(),
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
  publicSearch: {
    films: "",
    theatres: "",
    festivals: "",
  },
  selectedDay: "",
  daysViewRadiusMiles: DEFAULT_DAYS_VIEW_RADIUS_MILES,
  theme: LIGHT_THEME,
  brandWordmarkVariant: WORDMARK_VARIANTS[0],
  supabase: null,
  promotedCards: cloneDefaultPromotedCards(),
};

const elements = {
  appLoader: document.getElementById("appLoader"),
  themeColorMeta: document.querySelector('meta[name="theme-color"]'),
  themeToggle: document.getElementById("themeToggle"),
  brandLogo: document.getElementById("brandLogo"),
  brandWordmark: document.getElementById("brandWordmark"),
  navMenuWrap: document.getElementById("navMenuWrap"),
  navMenu: document.getElementById("navMenu"),
  navMenuLabel: document.getElementById("navMenuLabel"),
  navMenuItems: Array.from(document.querySelectorAll(".nav-menu-item")),
  publicSearchWrap: document.getElementById("publicSearchWrap"),
  publicSearchInput: document.getElementById("publicSearchInput"),
  dayPickerWrap: document.getElementById("dayPickerWrap"),
  dayPickerInput: document.getElementById("dayPickerInput"),
  dayPickerDisplayLabel: document.getElementById("dayPickerDisplayLabel"),
  radiusButtonGroup: document.getElementById("radiusButtonGroup"),
  radiusOptions: Array.from(document.querySelectorAll(".radius-option")),
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
  adminDrawerLoading: document.getElementById("adminDrawerLoading"),
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
  await waitForNextPaint();
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

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

async function init() {
  initializeBrandWordmarkVariant();
  initializeTheme();
  loadLocationPreference();
  initializeViewPreference();
  loadDaysViewRadius();
  initializeSupabase();
  bindEvents();
  initShowtimeNoteTooltips();
  void loadLatestSubstackPost();
  await loadData();
  syncPublicSearchUI();
  refreshLocationChooser();
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
    const author = String(post.author || "The Maine Playweek").trim();
    const imageUrl = normalizeSubstackImageUrl(post.cover_image);


    elements.latestPostTitle.textContent = title;
    elements.latestPostSubtitle.textContent = subtitle || "Read the latest post from The Maine Playweek.";
    elements.latestPostByline.textContent = author;
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
  } catch (error) {
    // Keep fallback content when feed access is blocked.
  }
}

function setLatestPostFallback() {
  elements.latestPostTitle.textContent = "Latest from The Playweek";
  elements.latestPostSubtitle.textContent = "Read our newest writing on The Maine Playweek Substack.";
  elements.latestPostByline.textContent = "themaineplayweek.substack.com";
  elements.latestPostLink.href = "https://themaineplayweek.substack.com";
  elements.latestPostImage.classList.add("hidden");
  elements.latestPostImage.removeAttribute("src");
  syncLatestPostVisibility();
}

// Served by the Vercel function in api/latest-post.js, since Substack can't be read from
// the browser.
async function fetchLatestSubstackPost() {
  const response = await fetch("/api/latest-post");
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function buildSubtitle(descriptionHtml) {
  const plain = stripHtml(descriptionHtml).replace(/\s+/g, " ").trim();
  if (!plain) return "";
  return plain.length > 180 ? `${plain.slice(0, 177).trimEnd()}...` : plain;
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
  state.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_CLIENT_OPTIONS);
  markStagingPage();
}

function bindEvents() {
  elements.themeToggle?.addEventListener("click", () => {
    animateThemeToggle();
    const nextTheme = state.theme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
    applyTheme(nextTheme);
    saveThemeChoice(nextTheme);
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
    const festivalToggle = event.target.closest(".festival-toggle");
    if (festivalToggle) {
      const festivalKey = festivalToggle.dataset.festivalKey;
      if (festivalKey) {
        if (state.expandedFestivals.has(festivalKey)) {
          state.expandedFestivals.delete(festivalKey);
        } else {
          state.expandedFestivals.add(festivalKey);
        }
        render();
      }
      return;
    }

    const festivalShowMore = event.target.closest(".festival-show-more");
    if (festivalShowMore) {
      const dayKey = festivalShowMore.dataset.dayKey;
      if (dayKey) {
        state.expandedFestivalDays.add(dayKey);
        render();
      }
      return;
    }

    const festivalShowFewer = event.target.closest(".festival-show-fewer");
    if (festivalShowFewer) {
      const dayKey = festivalShowFewer.dataset.dayKey;
      if (dayKey) {
        state.expandedFestivalDays.delete(dayKey);
        render();
      }
      return;
    }

    const filmExpandToggle = event.target.closest(".film-expand-toggle");
    if (filmExpandToggle) {
      // All Films' "View Film Page" is a plain link; let the browser follow it.
      if (filmExpandToggle.matches("a")) return;
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
      window.location.assign(posterFilmPageUrl);
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
    closeNavMenu();
  });

  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view;
      setView(view, { persist: true });
    });
  });

  elements.navMenu?.addEventListener("click", (event) => {
    const item = event.target.closest(".nav-menu-item");
    if (!item) return;
    const view = item.dataset.view;
    if (view) {
      setView(view, { persist: true });
      closeNavMenu();
    }
  });

  document.addEventListener("click", (event) => {
    if (elements.navMenuWrap && !elements.navMenuWrap.contains(event.target)) {
      closeNavMenu();
    }
  });

  const debouncedPublicSearchRender = debounce(() => {
    render();
  }, SEARCH_INPUT_DEBOUNCE_MS);

  elements.publicSearchInput?.addEventListener("input", () => {
    const value = elements.publicSearchInput.value || "";
    if (state.view === "films") {
      state.publicSearch.films = value;
    } else if (state.view === "theatres") {
      state.publicSearch.theatres = value;
    } else if (state.view === "festivals") {
      state.publicSearch.festivals = value;
    }
    debouncedPublicSearchRender();
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

  elements.radiusButtonGroup?.addEventListener("click", (event) => {
    const option = event.target.closest(".radius-option");
    if (!option) return;
    const requestedRadius = Number(option.dataset.value);
    if (!Number.isFinite(requestedRadius) || requestedRadius <= 0) return;
    state.daysViewRadiusMiles = requestedRadius;
    persistDaysViewRadius();
    syncRadiusButtons();
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
    closeLocationChooserModal();
    if (state.view === "days" && !hasConfiguredLocationPreference()) {
      setView("films", { persist: true });
    }
  });

  elements.locationChooserModal?.addEventListener("cancel", () => {
    setLocationChooserMessage("");
    if (state.view === "days" && !hasConfiguredLocationPreference()) {
      setView("films", { persist: true });
    }
  });

  elements.useDeviceLocation?.addEventListener("click", async () => {
    if (!("geolocation" in navigator)) {
      setLocationChooserMessage("Location is not supported on this device. Use ZIP instead.");
      return;
    }
    elements.useDeviceLocation.disabled = true;
    setLocationChooserMessage("Checking browser location permissions...");
    try {
      const position = await getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 7000,
        maximumAge: 5 * 60 * 1000,
      });
      state.locationPreference = {
        mode: "geolocation",
        zip: "",
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      persistLocationPreference();
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

  const adminIntroText = elements.adminIntroText.textContent;
  elements.adminToggle.addEventListener("click", async () => {
    const open = elements.adminPanel.classList.toggle("open");
    elements.adminToggle.setAttribute("aria-expanded", String(open));
    if (!open) return;
    elements.adminDrawerLoading?.classList.remove("hidden");
    elements.adminPanel.style.pointerEvents = "none";
    const startTime = performance.now();
    try {
      const admin = await loadAdmin();
      elements.adminIntroText.textContent = adminIntroText;
      admin.showAdminPanel();
    } catch (error) {
      elements.adminIntroText.textContent = `The admin could not load: ${error.message}. Reload the page and try again.`;
    }
    const elapsed = performance.now() - startTime;
    const minDisplayTime = 200;
    const remainingTime = Math.max(0, minDisplayTime - elapsed);
    setTimeout(() => {
      elements.adminDrawerLoading?.classList.add("hidden");
      elements.adminPanel.style.pointerEvents = "auto";
    }, remainingTime);
  });
}

// The admin's code and markup are downloaded the first time the panel opens. A failed
// download is not remembered, so the next open tries again.
let adminModulePromise = null;
function loadAdmin() {
  adminModulePromise ??= import("./admin.js")
    .then(async (admin) => {
      await admin.initAdmin({ state, render });
      return admin;
    })
    .catch((error) => {
      adminModulePromise = null;
      throw error;
    });
  return adminModulePromise;
}

// The theme follows the system setting unless the visitor picks the other one with the
// logo button. That choice is saved under THEME_STORAGE_KEY, which the film pages also
// read; picking the system theme again clears it.
function getSystemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? DARK_THEME : LIGHT_THEME;
}

function readSavedTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === LIGHT_THEME || stored === DARK_THEME ? stored : "";
  } catch {
    return "";
  }
}

function saveThemeChoice(theme) {
  try {
    if (theme === getSystemTheme()) {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Storage can be blocked; the theme still applies to this page.
  }
}

function initializeTheme() {
  applyTheme(readSavedTheme() || getSystemTheme());

  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    if (!readSavedTheme()) applyTheme(getSystemTheme());
  });
}

function initializeBrandWordmarkVariant() {
  if (!WORDMARK_VARIANTS.length) return;
  const randomIndex = Math.floor(Math.random() * WORDMARK_VARIANTS.length);
  state.brandWordmarkVariant = WORDMARK_VARIANTS[randomIndex] || WORDMARK_VARIANTS[0];
}

function closeNavMenu() {
  elements.navMenuWrap?.removeAttribute("open");
}

function initializeViewPreference() {
  const storedView = String(localStorage.getItem(VIEW_STORAGE_KEY) || "").trim();
  if (VALID_VIEWS.has(storedView)) {
    state.view = storedView;
  } else if (hasConfiguredLocationPreference()) {
    // First visit, but a location was already saved (e.g. on a film page).
    state.view = "days";
  }
  // Near You needs a location; without one, open All Films rather than a pop-up.
  if (state.view === "days" && !hasConfiguredLocationPreference()) {
    state.view = "films";
  }
  syncViewTabSelection();
}

function syncViewTabSelection() {
  elements.tabs.forEach((button) => {
    const selected = button.dataset.view === state.view;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  if (elements.navMenuLabel) {
    elements.navMenuLabel.textContent = NAV_VIEW_LABELS[state.view] || state.view;
  }
  elements.navMenuItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === state.view);
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
  if (state.view === "days" && !hasConfiguredLocationPreference()) {
    openLocationChooserModal();
  }
  if ((state.view === "theatres" || state.view === "days") && hasConfiguredLocationPreference()) {
    void ensureTheatreDistanceSort();
  }

  updateTheatreSortStatus();
  render();
}

function applyTheme(theme) {
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

async function loadData() {
  state.promotedCards = cloneDefaultPromotedCards();

  if (state.supabase) {
    try {
      const fromDb = await loadActiveDataFromSupabase(state.supabase, toIsoDate(new Date()));
      if (fromDb.theatreGroups.length) {
        validateData({ theatreGroups: fromDb.theatreGroups, festivals: fromDb.festivals || [] });
        state.data = { theatreGroups: fromDb.theatreGroups, festivals: fromDb.festivals || [] };
        state.promotedCards = fromDb.promotedCards;
        state.source = "supabase-active";
        state.loadedFromSupabaseThisSession = false;
        state.dataVersion = null;
        return;
      }
    } catch (error) {
      // Shown in the admin, where saving and CSV import are blocked on fallback data.
      state.dataLoadError = `Supabase data load failed; falling back to local/static data. ${String(error?.message || "")}`.trim();
      // fall through to local fallback
    }
  }

  const localData = localStorage.getItem(STORAGE_KEY);
  if (localData) {
    try {
      const parsed = JSON.parse(localData);
      validateData(parsed);
      state.data = {
        theatreGroups: Array.isArray(parsed?.theatreGroups) ? parsed.theatreGroups : [],
        festivals: Array.isArray(parsed?.festivals) ? parsed.festivals : [],
      };
      state.source = "local";
      state.loadedFromSupabaseThisSession = false;
      state.dataVersion = null;
      return;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const fallbackData = await loadFallbackDataFromFilmPagesSource();
  if (!fallbackData) {
    throw new Error("Could not load showtimes from Supabase or the film pages data.");
  }
  state.data = {
    theatreGroups: Array.isArray(fallbackData?.theatreGroups) ? fallbackData.theatreGroups : [],
    festivals: Array.isArray(fallbackData?.festivals) ? fallbackData.festivals : [],
  };
  state.source = "film-pages-json";
  state.loadedFromSupabaseThisSession = false;
  state.dataVersion = null;
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
      const normalized = { theatreGroups, festivals: [] };
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
          rankingOverride: Boolean(filmEntry?.rankingOverride || filmEntry?.ranking_override),
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
        filmShowing = { date: showDate, room: String(showing?.room || "").trim(), times: [], premiumTimes: [] };
        theatreFilm._showingByDate.set(showDate, filmShowing);
        theatreFilm.showings.push(filmShowing);
      }
      const isPremium = Boolean(
        showing?.isPremium ||
          String(showing?.format || "").trim().toLowerCase() === "premium"
      );
      const targetTimes = isPremium ? filmShowing.premiumTimes : filmShowing.times;
      if (!targetTimes.includes(showTime)) {
        targetTimes.push(showTime);
      }
    }
  }

  const theatreGroups = Array.from(theatreMap.values());
  theatreGroups.forEach((theatre) => {
    theatre.films = theatre.films.filter((film) => Array.isArray(film.showings) && film.showings.length > 0);
    theatre.films.forEach((film) => {
      film.showings.sort((a, b) => a.date.localeCompare(b.date));
      film.showings.forEach((showing) => {
        showing.times = dedupeSortTimes(showing.times || []);
        showing.premiumTimes = dedupeSortTimes(showing.premiumTimes || []);
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

function render() {
  updateTheatreSortStatus();

  // Show/hide map toggle based on view
  if (state.view === "theatres") {
    showMapToggle();
  } else {
    hideMapToggle();
  }

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
    grouped = state.view === "festivals"
      ? buildFestivalGroups(state.data.theatreGroups, state.data.festivals || [])
      : buildGroups(state.data.theatreGroups, state.view);
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
    } else if (state.view === "festivals") {
      entries = entries.filter(([groupName, group]) => doesFestivalGroupMatchSearch(groupName, group, searchQuery));
    }
  }
  if (!entries.length) {
    const message = state.view === "films"
      ? "No films found..."
      : state.view === "theatres"
        ? "No theatres found..."
        : state.view === "festivals"
          ? "No festivals found..."
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
      const overrideA = Boolean(groupA?.filmInfo?.rankingOverride);
      const overrideB = Boolean(groupB?.filmInfo?.rankingOverride);
      if (overrideA !== overrideB) return overrideA ? -1 : 1;

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
  } else if (state.view === "festivals") {
    entries.sort(([, groupA], [, groupB]) => {
      const tsA = Date.parse(groupA?.festivalInfo?.startDate || groupA?.festivalInfo?.endDate || "");
      const tsB = Date.parse(groupB?.festivalInfo?.startDate || groupB?.festivalInfo?.endDate || "");
      const validA = !isNaN(tsA);
      const validB = !isNaN(tsB);
      if (validA !== validB) return validA ? -1 : 1;
      if (tsA !== tsB) return tsA - tsB;
      const nameA = String(groupA?.festivalInfo?.name || "");
      const nameB = String(groupB?.festivalInfo?.name || "");
      return nameA.localeCompare(nameB);
    });
  } else {
    entries.sort(([a], [b]) => a.localeCompare(b));
  }

  for (const [groupName, group] of entries) {
    const card = elements.groupTemplate.content.firstElementChild.cloneNode(true);

    // Add data-theatre-id for map view lookup
    if (state.view === "theatres" && group.theatreInfo) {
      card.setAttribute("data-theatre-id", group.theatreInfo.id);
    }

    const groupTitle = card.querySelector(".group-title");
    const isFilmsView = isFilmStyleView && Boolean(group.filmInfo);
    if (isFilmsView) {
      card.classList.add("film-card");
      // Add line break after colon in film title
      const filmTitle = group.filmInfo.film;
      const colonIndex = filmTitle.indexOf(":");
      if (colonIndex >= 0) {
        groupTitle.replaceChildren(
          filmTitle.slice(0, colonIndex + 1),
          document.createElement("br"),
          filmTitle.slice(colonIndex + 1)
        );
      } else {
        groupTitle.textContent = filmTitle;
      }
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
      groupTitle.textContent = state.view === "festivals"
        ? String(group?.festivalInfo?.name || groupName)
        : groupName;
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
    if (group.festivalInfo && state.view === "festivals") {
      card.classList.add("festival-card");
      const festivalKey = `festival-${group.festivalInfo.id || groupName}`;
      const festivalExpanded = state.expandedFestivals.has(festivalKey);
      card.dataset.festivalKey = festivalKey;
      card.classList.toggle("festival-card-collapsed", !festivalExpanded);

      const festivalPrimaryColor = String(group.festivalInfo.primaryColor || "").trim();
      if (festivalPrimaryColor) {
        card.style.setProperty("--festival-accent", festivalPrimaryColor);
      } else {
        card.style.removeProperty("--festival-accent");
      }
      const details = formatFestivalDateRange(group.festivalInfo.startDate, group.festivalInfo.endDate);
      subtitle.textContent = "";
      subtitle.classList.add("hidden");
      if (details) {
        let dateStamp = card.querySelector(".festival-date-stamp");
        if (!dateStamp) {
          dateStamp = document.createElement("span");
          dateStamp.className = "festival-date-stamp";
          card.insertBefore(dateStamp, subtitle);
        }
        dateStamp.textContent = details;
      }
      const festivalWebsite = normalizeOutboundUrl(group.festivalInfo.website);
      if (festivalWebsite) {
        groupLink.href = festivalWebsite;
        groupLink.textContent = "Visit festival website";
        groupLink.classList.remove("hidden");
      }

      if (filmExpandToggle) {
        filmExpandToggle.classList.add("festival-toggle");
        filmExpandToggle.dataset.festivalKey = festivalKey;
        const chevron = festivalExpanded ? "▼" : "▶";
        filmExpandToggle.innerHTML = `<span class="festival-chevron">${chevron}</span>`;
        filmExpandToggle.setAttribute("aria-expanded", String(festivalExpanded));
        filmExpandToggle.setAttribute("aria-label", festivalExpanded ? `Collapse ${group.festivalInfo.name}` : `Expand ${group.festivalInfo.name}`);
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
          // A real link, so it can be opened in a new tab or copied like any other.
          const filmPageLink = document.createElement("a");
          filmPageLink.className = "film-expand-toggle";
          filmPageLink.href = buildFilmPageUrl(group.filmInfo?.film, group.filmInfo?.year);
          filmPageLink.textContent = "View Film Page";
          filmExpandToggle.replaceWith(filmPageLink);
        } else {
          filmExpandToggle.dataset.filmKey = filmGroupKey;
          filmExpandToggle.textContent = filmGroupExpanded ? "Collapse" : "Expand";
          filmExpandToggle.setAttribute("aria-expanded", String(filmGroupExpanded));
          filmExpandToggle.classList.remove("hidden");
        }
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
      const filmPageUrl = buildFilmPageUrl(group.filmInfo?.film, group.filmInfo?.year);
      const isNearYouView = state.view === "days";
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
        if (isNearYouView) {
          groupTmdbLink.classList.add("group-view-film-link");
          groupTmdbLink.textContent = "View Film Page";
          groupTmdbLink.removeAttribute("target");
          groupTmdbLink.removeAttribute("rel");
        } else {
          groupTmdbLink.classList.remove("group-view-film-link");
          groupTmdbLink.textContent = "View on TMDb";
          groupTmdbLink.target = "_blank";
          groupTmdbLink.rel = "noopener noreferrer";
        }
        const actionUrl = isNearYouView ? filmPageUrl : tmdbUrl;
        if (filmGroupExpanded && actionUrl) {
          groupTmdbLink.href = actionUrl;
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
        if (state.view === "festivals") {
          const earliestA = getRowEarliestShowtimeTimestamp(a);
          const earliestB = getRowEarliestShowtimeTimestamp(b);
          if (earliestA !== earliestB) return earliestA - earliestB;
          const filmComparison = buildFilmGroupKey(a.film, a.year).localeCompare(buildFilmGroupKey(b.film, b.year));
          if (filmComparison !== 0) return filmComparison;
          return `${a.theatre} ${a.city}`.localeCompare(`${b.theatre} ${b.city}`);
        }
        if (state.view === "days") {
          const keyA = buildTheatreDistanceKey({ name: a.theatre, city: a.city, address: a.address });
          const keyB = buildTheatreDistanceKey({ name: b.theatre, city: b.city, address: b.address });
          const distanceA = state.theatreDistanceByKey.get(keyA);
          const distanceB = state.theatreDistanceByKey.get(keyB);
          const hasDistanceA = Number.isFinite(distanceA);
          const hasDistanceB = Number.isFinite(distanceB);
          if (hasDistanceA && hasDistanceB && distanceA !== distanceB) return distanceA - distanceB;
          if (hasDistanceA !== hasDistanceB) return hasDistanceA ? -1 : 1;
        }
        return `${a.theatre} ${a.city}`.localeCompare(`${b.theatre} ${b.city}`);
      });

      const showsToRender =
        state.view === "theatres" && !theatreGroupExpanded
          ? shows.slice(0, THEATRE_COLLAPSED_FILM_COUNT)
          : shows;

      const festivalShowsToRender = state.view === "festivals"
        ? expandFestivalShowsByDate(showsToRender)
        : null;
      let lastFestivalDateHeader = "";
      let showsInCurrentDay = 0;
      let showMoreButtonAddedForDay = false;
      const festivalKey = `festival-${group.festivalInfo?.id || groupName}`;
      const festivalExpanded = state.view === "festivals" && state.expandedFestivals.has(festivalKey);

      // Group shows by date for festivals to track show counts
      const showsByDate = {};
      if (state.view === "festivals" && festivalShowsToRender) {
        for (const show of festivalShowsToRender) {
          const showDate = String(show?.festivalDate || "").trim();
          if (showDate) {
            if (!showsByDate[showDate]) showsByDate[showDate] = [];
            showsByDate[showDate].push(show);
          }
        }
      }

      for (const show of (festivalShowsToRender || showsToRender)) {
        if (state.view === "festivals") {
          const showDate = String(show?.festivalDate || "").trim();
          if (showDate && showDate !== lastFestivalDateHeader) {
            // Add "Show fewer" button for the previous day if it was expanded
            if (lastFestivalDateHeader && showMoreButtonAddedForDay) {
              const previousDayKey = `day-${festivalKey}-${lastFestivalDateHeader}`;
              if (state.expandedFestivalDays.has(previousDayKey)) {
                const showFewerButton = document.createElement("li");
                showFewerButton.className = "festival-show-more-button";
                const button = document.createElement("button");
                button.type = "button";
                button.className = "festival-show-fewer";
                button.dataset.dayKey = previousDayKey;
                button.textContent = "Show fewer";
                showFewerButton.appendChild(button);
                list.appendChild(showFewerButton);
              }
            }

            const dateDivider = document.createElement("li");
            dateDivider.className = "festival-date-divider";
            dateDivider.textContent = formatDisplayDate(showDate);
            list.appendChild(dateDivider);
            lastFestivalDateHeader = showDate;
            showsInCurrentDay = 0;
            showMoreButtonAddedForDay = false;
          }

          // For festivals, limit to first 4 shows per day unless day is expanded
          const dayKey = `day-${festivalKey}-${String(show?.festivalDate || "").trim()}`;
          const dayExpanded = state.expandedFestivalDays.has(dayKey);
          const totalShowsForDay = showsByDate[String(show?.festivalDate || "").trim()]?.length || 0;

          if (!dayExpanded && showsInCurrentDay >= 4) {
            // Add "Show more" button once after 4th show
            if (!showMoreButtonAddedForDay && totalShowsForDay > 4) {
              const showMoreButton = document.createElement("li");
              showMoreButton.className = "festival-show-more-button";
              const button = document.createElement("button");
              button.type = "button";
              button.className = "festival-show-more";
              button.dataset.dayKey = dayKey;
              button.textContent = "Show more";
              showMoreButton.appendChild(button);
              list.appendChild(showMoreButton);
              showMoreButtonAddedForDay = true;
            }
            continue;
          }

          // Mark that we should add "show fewer" after all shows for this day
          if (dayExpanded && !showMoreButtonAddedForDay && totalShowsForDay > 4) {
            showMoreButtonAddedForDay = true; // Reuse flag to track we've handled this day
          }

          showsInCurrentDay++;
        }
        if (state.view === "theatres") {
          list.appendChild(
            buildTheatreShowItem(group, show, state.expandedFilmGroups.has(buildExpandRowKey(state.view, group, show)))
          );
          continue;
        }
        const item = elements.showItemTemplate.content.firstElementChild.cloneNode(true);
        const main = item.querySelector(".show-main");
        const meta = item.querySelector(".show-meta");
        const schedule = item.querySelector(".show-schedule");
        const row = item.querySelector(".show-row");
        const poster = item.querySelector(".show-poster");
        const link = item.querySelector(".show-link");
        const showFestivalIds = Array.isArray(show?.festivalIds) ? show.festivalIds : [];
        const festivalBadgeLabel = getFestivalBadgeLabel(showFestivalIds);

        if (state.view === "festivals") {
          item.classList.add("festival-show-item");
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
          main.textContent = show.film || show.theatre || "Showtime";
          meta.textContent = [show.theatre || "", show.room || show.city || ""]
            .filter(Boolean)
            .join(", ");
          const ribbon = document.createElement("span");
          ribbon.className = "festival-entry-ribbon";
          ribbon.textContent = "Festival Selection";
          main.prepend(ribbon);
        } else {
          main.textContent = `${show.theatre}`;
          const theatreKey = `${show.theatre} · ${show.city}`;
          const roomValue =
            String(show?.room || "").trim() ||
            String(show?.roomByTheatre?.[theatreKey] || "").trim();
          meta.textContent = [show.city || "", roomValue ? `Room: ${roomValue}` : ""].filter(Boolean).join(" · ");
          if (showFestivalIds.length) {
            const ribbon = document.createElement("span");
            ribbon.className = "festival-entry-ribbon festival-entry-ribbon-inline";
            ribbon.textContent = festivalBadgeLabel;
            main.prepend(ribbon);
          }
        }
        renderSchedule(schedule, show.dates, show.premiumDates, show.timeNotes);
        const ticketUrl = normalizeOutboundUrl(show.ticketLink);
        if (ticketUrl) {
          link.href = ticketUrl;
          link.classList.remove("hidden");
        }
        if (state.view === "festivals") {
          const rowActions = document.createElement("div");
          rowActions.className = "theatre-row-actions";
          if (!link.classList.contains("hidden")) {
            rowActions.appendChild(link);
          }
          const rowFilmPageLink = document.createElement("a");
          rowFilmPageLink.className = "theatre-row-film-link";
          rowFilmPageLink.href = buildFilmPageUrl(show.film, show.year);
          rowFilmPageLink.textContent = "View Film Page";
          rowActions.appendChild(rowFilmPageLink);
          item.appendChild(rowActions);
        }

        if (state.view === "festivals") {
          const showDate = String(show?.festivalDate || "").trim();
          const dayKey = `day-${festivalKey}-${showDate}`;
          const dayExpanded = state.expandedFestivalDays.has(dayKey);
          // Show first 4 shows always, then only show more if day is expanded
          if (festivalExpanded && (showsInCurrentDay <= 4 || dayExpanded)) {
            list.appendChild(item);
          }
        } else {
          list.appendChild(item);
        }
      }

      if (state.view === "festivals") {
        // Add "Show fewer" button for the last day if it was expanded
        if (lastFestivalDateHeader && showMoreButtonAddedForDay) {
          const lastDayKey = `day-${festivalKey}-${lastFestivalDateHeader}`;
          const showsByLastDay = showsByDate[lastFestivalDateHeader]?.length || 0;
          if (state.expandedFestivalDays.has(lastDayKey) && showsByLastDay > 4) {
            const showFewerButton = document.createElement("li");
            showFewerButton.className = "festival-show-more-button";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "festival-show-fewer";
            button.dataset.dayKey = lastDayKey;
            button.textContent = "Show fewer";
            showFewerButton.appendChild(button);
            list.appendChild(showFewerButton);
          }
        }

        list.classList.toggle("hidden", !festivalExpanded);
        if (festivalExpanded && shows.length === 0) {
          const placeholder = document.createElement("li");
          placeholder.className = "festival-empty-placeholder";
          placeholder.textContent = "Programming coming soon.";
          list.appendChild(placeholder);
        }
      }
    }

    if ((state.view === "theatres" || state.view === "festivals") && filmExpandToggle && !filmExpandToggle.classList.contains("hidden")) {
      card.appendChild(filmExpandToggle);
    }

    cards.push(card);
  }

  if (state.view === "films" || state.view === "days") {
    insertPromotedCards(cards, buildPromotedAdCards());
  }

  renderResultCards(cards);

  // Render theatres on map if in theatre view
  if (state.view === "theatres" && entries.length > 0) {
    const theatreList = entries
      .map(([, group]) => group.theatreInfo)
      .filter(theatre => theatre && theatre.latitude && theatre.longitude);

    // The location the distances were measured from: the saved ZIP or this visit's device
    // location. The map never asks for location itself.
    const userLocation = state.userCoords ? { ...state.userCoords } : null;

    // The side panel shows the same film rows as the list, built from these groups.
    const groupByTheatreId = new Map(entries.map(([, group]) => [group.theatreInfo?.id, group]));
    renderMapMarkers(theatreList, userLocation, (theatreId, isRowExpanded) => {
      const group = groupByTheatreId.get(theatreId);
      return group ? buildTheatreMapCard(group, isRowExpanded) : null;
    });
  }
}

// One film row of a theatre's card: poster, title, and the next day's times, or every
// date plus the ticket and film page links when `rowExpanded`. A film playing on only
// one date always shows its links, with no toggle. Used by the Theatres list and the
// map's side panel.
function buildTheatreShowItem(group, show, rowExpanded) {
  const item = elements.showItemTemplate.content.firstElementChild.cloneNode(true);
  const main = item.querySelector(".show-main");
  const meta = item.querySelector(".show-meta");
  const schedule = item.querySelector(".show-schedule");
  const row = item.querySelector(".show-row");
  const poster = item.querySelector(".show-poster");
  const link = item.querySelector(".show-link");
  const showFestivalIds = Array.isArray(show?.festivalIds) ? show.festivalIds : [];
  const showDates = Object.keys({ ...show.dates, ...show.premiumDates }).sort();
  const hasMoreDates = showDates.length > 1;
  const showsEverything = rowExpanded || !hasMoreDates;

  const rowToggle = document.createElement("button");
  rowToggle.type = "button";
  rowToggle.className = "film-expand-toggle theatre-row-toggle";
  rowToggle.dataset.filmKey = buildExpandRowKey("theatres", group, show);
  rowToggle.textContent = rowExpanded ? "Collapse" : "More Dates & Tickets";
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

  main.textContent = show.film;
  if (showFestivalIds.length) {
    const ribbon = document.createElement("span");
    ribbon.className = "festival-entry-ribbon festival-entry-ribbon-inline";
    ribbon.textContent = getFestivalBadgeLabel(showFestivalIds);
    main.prepend(ribbon);
  }
  const showDateKeys = Object.keys(show?.dates || {});
  const singleDateRoom =
    showDateKeys.length === 1
      ? String(show?.roomByDate?.[showDateKeys[0]] || "").trim()
      : "";
  meta.textContent = singleDateRoom ? `Room: ${singleDateRoom}` : "";

  const visibleDates = showsEverything ? showDates : showDates.slice(0, 1);
  schedule.replaceChildren(
    ...visibleDates.map((date) =>
      createScheduleRow(date, show.dates?.[date], show.premiumDates?.[date], show.timeNotes)
    )
  );
  if (!showsEverything) schedule.appendChild(rowToggle);

  // The links go in the text column, under the times, so a short row doesn't push them
  // below the poster.
  const textColumn = schedule.parentElement;
  const ticketUrl = normalizeOutboundUrl(show.ticketLink);
  if (showsEverything && ticketUrl) {
    link.href = ticketUrl;
    link.classList.remove("hidden");
    textColumn.appendChild(link);
  } else {
    link.classList.add("hidden");
  }
  if (showsEverything) {
    const rowFilmPageLink = document.createElement("a");
    rowFilmPageLink.className = "theatre-row-film-link";
    rowFilmPageLink.href = buildFilmPageUrl(show.film, show.year);
    rowFilmPageLink.textContent = "View Film Page";
    const rowActions = document.createElement("div");
    rowActions.className = "theatre-row-actions";
    if (hasMoreDates) rowActions.appendChild(rowToggle);
    rowActions.appendChild(rowFilmPageLink);
    textColumn.appendChild(rowActions);
  }
  return item;
}

// The map side panel's card for a theatre: the same heading and film rows as its card in
// the Theatres list, with every film shown. `isRowExpanded(key)` reports the panel's own
// expanded rows.
function buildTheatreMapCard(group, isRowExpanded) {
  const theatre = group.theatreInfo || {};
  const card = document.createElement("article");
  card.className = "group-card";
  card.dataset.theatreId = String(theatre.id ?? "");

  const title = document.createElement("h3");
  title.className = "group-title";
  title.textContent = `${theatre.name} · ${theatre.city}`;
  card.appendChild(title);

  if (theatre.address) {
    const subtitle = document.createElement("p");
    subtitle.className = "group-subtitle";
    subtitle.textContent = theatre.address;
    card.appendChild(subtitle);
  }

  const website = normalizeOutboundUrl(theatre.website);
  if (website) {
    const link = document.createElement("a");
    link.className = "group-link";
    link.href = website;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Visit theatre website";
    card.appendChild(link);
  }

  const list = document.createElement("ul");
  list.className = "show-list";
  (group.shows || []).forEach((show) => {
    list.appendChild(buildTheatreShowItem(group, show, isRowExpanded(buildExpandRowKey("theatres", group, show))));
  });
  card.appendChild(list);
  return card;
}

function getFestivalBadgeLabel(festivalIds) {
  const name = (festivalIds || [])
    .map((id) => (state.data.festivals || []).find((festival) => Number(festival?.id) === Number(id))?.name || "")
    .map((value) => String(value).trim())
    .find(Boolean);
  return name || "Festival Selection";
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

function resolvePromoImageSrc(promo) {
  const path = String(promo?.imagePath || "").trim();
  if (!path) return "";
  if (path.startsWith("assets/") || path.startsWith("./assets/")) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return state.supabase?.storage?.from(PROMO_STORAGE_BUCKET).getPublicUrl(path)?.data?.publicUrl || "";
}

function renderResultCards(cards) {
  if (!cards.length) return;

  if (state.view === "films" || state.view === "days" || state.view === "festivals") {
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
  } else if (state.view === "festivals") {
    elements.publicSearchWrap.classList.remove("hidden");
    elements.publicSearchInput.placeholder = "Search festivals, films, or theatres...";
    elements.publicSearchInput.value = state.publicSearch.festivals;
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
  if (view === "festivals") return normalizeSearchText(state.publicSearch.festivals);
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

function doesFestivalGroupMatchSearch(groupName, group, query) {
  if (!query) return true;
  const festivalName = group?.festivalInfo?.name || groupName;
  const festivalDescription = group?.festivalInfo?.description || "";
  if (
    normalizeSearchText(festivalName).includes(query) ||
    normalizeSearchText(festivalDescription).includes(query)
  ) {
    return true;
  }
  return (group?.shows || []).some((show) => {
    const haystack = [
      show?.film || "",
      show?.theatre || "",
      show?.city || "",
    ]
      .map((value) => normalizeSearchText(value))
      .join(" ");
    return haystack.includes(query);
  });
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

function persistLocationPreference() {
  localStorage.setItem(LOCATION_PREFERENCE_STORAGE_KEY, JSON.stringify(state.locationPreference));
}

function hasConfiguredLocationPreference() {
  return state.locationPreference.mode === "zip" || state.locationPreference.mode === "geolocation";
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
  const viaZipLookup = await geocodeUsZip(zip);
  if (viaZipLookup) return viaZipLookup;
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

function getFilmGroupSortBreakdown(group) {
  const filmInfo = group?.filmInfo || {};
  const breakdown = getFilmSortBreakdown({
    popularity: filmInfo.popularity,
    voteAverage: filmInfo.voteAverage,
    voteCount: filmInfo.voteCount,
    releaseDate: filmInfo.releaseDate,
    staffFavorite: filmInfo.staffFavorite,
    upcomingTimes: countGroupUpcomingTimes(group),
    theatreCount: countGroupTheatreCoverage(group),
  });
  return {
    ...breakdown,
    inputs: {
      ...breakdown.inputs,
      staffFavorite: Boolean(filmInfo.staffFavorite),
      featuredOnPlayweek: Boolean(filmInfo.featuredOnPlayweek),
    },
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
      return finalRows;
    },
  };

  window.__tmpDebug = Object.freeze(debugApi);
}

function countGroupUpcomingTimes(group) {
  return (group?.shows || []).reduce((total, show) => {
    const standardCount = Object.values(show?.dates || {}).reduce((count, dateTimes) => count + (dateTimes?.length || 0), 0);
    const premiumCount = Object.values(show?.premiumDates || {}).reduce(
      (count, dateTimes) => count + (dateTimes?.length || 0),
      0
    );
    return total + standardCount + premiumCount;
  }, 0);
}

function countGroupTheatreCoverage(group) {
  const keys = new Set();
  (group?.shows || []).forEach((show) => {
    keys.add(`${show?.theatre || ""}::${show?.city || ""}`);
  });
  return keys.size;
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
  Object.entries(row?.premiumDates || {}).forEach(([date, times]) => {
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

function loadDaysViewRadius() {
  try {
    const stored = Number(localStorage.getItem(DAYS_VIEW_RADIUS_STORAGE_KEY));
    const isOffered = elements.radiusOptions.some((option) => Number(option.dataset.value) === stored);
    if (isOffered) state.daysViewRadiusMiles = stored;
  } catch {
    // Storage can be blocked; keep the default radius.
  }
  syncRadiusButtons();
}

function persistDaysViewRadius() {
  try {
    localStorage.setItem(DAYS_VIEW_RADIUS_STORAGE_KEY, String(getDaysViewRadiusMiles()));
  } catch {
    // Storage can be blocked; the choice still applies until reload.
  }
}

function syncRadiusButtons() {
  const radius = getDaysViewRadiusMiles();
  elements.radiusOptions.forEach((option) => {
    const selected = Number(option.dataset.value) === radius;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  });
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
  elements.dayPrevButton.disabled = false;
  elements.dayNextButton.disabled = false;

  if (!activeDay) {
    elements.dayPickerInput.value = "";
    elements.dayPickerInput.title = "Select a date";
    if (elements.dayPickerDisplayLabel) elements.dayPickerDisplayLabel.textContent = "";
    elements.dayPrevButton.disabled = true;
    elements.dayNextButton.disabled = true;
    return;
  }

  elements.dayPickerInput.value = activeDay;
  elements.dayPickerInput.title = formatLongDisplayDate(activeDay);
  if (elements.dayPickerDisplayLabel) {
    const isNarrow = window.matchMedia("(max-width: 640px)").matches;
    elements.dayPickerDisplayLabel.textContent = isNarrow
      ? formatShortDate(activeDay)
      : formatDisplayDate(activeDay);
  }
}

function buildSingleDayGroups(theatres, selectedDate) {
  const grouped = {};
  const now = new Date();

  theatres.forEach((theatre) => {
    (theatre.films || []).forEach((film) => {
      const metadata = extractFilmMetadata(film);
      const year = Number.isInteger(Number(film.year)) ? Number(film.year) : null;
      const times = [];
      const premiumTimes = [];
      const festivalIds = new Set();
      let room = "";
      const timeNotes = {};

      (film.showings || []).forEach((showing) => {
        if (showing.date !== selectedDate) return;
        (showing.times || []).forEach((time) => {
          const showDateTime = getShowDateTime(showing.date, time);
          if (!showDateTime || showDateTime < now) return;
          times.push(time);
          if (!room) room = String(showing?.room || "").trim();
          addTimeNote(timeNotes, showing.date, time, false, showing?.notes);
          const festivalId = Number.isInteger(Number(showing?.festivalId)) ? Number(showing.festivalId) : null;
          if (festivalId) festivalIds.add(festivalId);
        });
        (showing.premiumTimes || []).forEach((time) => {
          const showDateTime = getShowDateTime(showing.date, time);
          if (!showDateTime || showDateTime < now) return;
          premiumTimes.push(time);
          if (!room) room = String(showing?.room || "").trim();
          addTimeNote(timeNotes, showing.date, time, true, showing?.notes);
          const festivalId = Number.isInteger(Number(showing?.festivalId)) ? Number(showing.festivalId) : null;
          if (festivalId) festivalIds.add(festivalId);
        });
      });

      if (!times.length && !premiumTimes.length) return;
      times.sort(compareTimes);
      premiumTimes.sort(compareTimes);

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
            rankingOverride: metadata.rankingOverride,
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
        room,
        timeNotes,
        festivalIds: Array.from(festivalIds.values()),
        ticketLink: film.ticketLink,
        dates: {
          [selectedDate]: times,
        },
        premiumDates: {
          [selectedDate]: premiumTimes,
        },
      });
    });
  });

  return grouped;
}

function buildFestivalGroups(theatres, festivals) {
  const grouped = {};
  const now = new Date();
  const festivalById = new Map(
    (festivals || [])
      .filter((festival) => Number.isInteger(Number(festival?.id)))
      .map((festival) => [Number(festival.id), festival])
  );

  theatres.forEach((theatre) => {
    (theatre.films || []).forEach((film) => {
      const metadata = extractFilmMetadata(film);
      (film.showings || []).forEach((showing) => {
        const festivalId = Number.isInteger(Number(showing?.festivalId)) ? Number(showing.festivalId) : null;
        if (!festivalId) return;
        const times = (showing.times || []).filter((time) => {
          const showDateTime = getShowDateTime(showing.date, time);
          return Boolean(showDateTime && showDateTime >= now);
        });
        const premiumTimes = (showing.premiumTimes || []).filter((time) => {
          const showDateTime = getShowDateTime(showing.date, time);
          return Boolean(showDateTime && showDateTime >= now);
        });
        if (!times.length && !premiumTimes.length) return;
        const timeNotes = {};
        times.forEach((time) => addTimeNote(timeNotes, showing.date, time, false, showing?.notes));
        premiumTimes.forEach((time) => addTimeNote(timeNotes, showing.date, time, true, showing?.notes));

        const festival = festivalById.get(festivalId);
        if (festival && !festival.enabled) return;
        const festivalName = String(festival?.name || `Festival ${festivalId}`).trim();
        const groupKey = `festival::${festivalId}`;
        if (!grouped[groupKey]) {
          grouped[groupKey] = {
            festivalInfo: {
              id: festivalId,
              name: festivalName,
              description: String(festival?.description || "").trim(),
              website: String(festival?.website || "").trim(),
              primaryColor: String(festival?.primaryColor || "").trim(),
              startDate: String(festival?.startDate || "").trim(),
              endDate: String(festival?.endDate || "").trim(),
              sortOrder: Number.isInteger(Number(festival?.sortOrder)) ? Number(festival.sortOrder) : 0,
            },
            theatreInfo: null,
            dayInfo: null,
            filmInfo: null,
            shows: [],
          };
        }

        grouped[groupKey].shows.push({
          theatre: theatre.name,
          city: theatre.city,
          room: String(showing?.room || "").trim(),
          timeNotes,
          film: film.title,
          year: Number.isInteger(Number(film.year)) ? Number(film.year) : null,
          ticketLink: film.ticketLink,
          posterUrl: metadata.posterUrl,
          director: metadata.director,
          stars: metadata.stars,
          genres: metadata.genres,
          dates: {
            [showing.date]: dedupeSortTimes(times),
          },
          premiumDates: {
            [showing.date]: dedupeSortTimes(premiumTimes),
          },
        });
      });
    });
  });

  for (const [festivalId, festival] of festivalById) {
    if (festival && !festival.enabled) continue;
    const groupKey = `festival::${festivalId}`;
    if (grouped[groupKey]) continue;
    const festivalName = String(festival?.name || `Festival ${festivalId}`).trim();
    grouped[groupKey] = {
      festivalInfo: {
        id: festivalId,
        name: festivalName,
        description: String(festival?.description || "").trim(),
        website: String(festival?.website || "").trim(),
        primaryColor: String(festival?.primaryColor || "").trim(),
        startDate: String(festival?.startDate || "").trim(),
        endDate: String(festival?.endDate || "").trim(),
        sortOrder: Number.isInteger(Number(festival?.sortOrder)) ? Number(festival.sortOrder) : 0,
      },
      theatreInfo: null,
      dayInfo: null,
      filmInfo: null,
      shows: [],
    };
  }

  return grouped;
}

function buildGroups(theatres, view) {
  const grouped = {};
  const now = new Date();

  theatres.forEach((theatre) => {
    const theatreInfo = {
      id: theatre.id,
      name: theatre.name,
      city: theatre.city,
      address: theatre.address,
      website: theatre.website,
      latitude: theatre.latitude,
      longitude: theatre.longitude,
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
        rankingOverride: metadata.rankingOverride,
        popularity: metadata.popularity,
        voteAverage: metadata.voteAverage,
        voteCount: metadata.voteCount,
        releaseDate: metadata.releaseDate,
        matchedAt: metadata.matchedAt,
        dates: {},
        premiumDates: {},
        roomByDate: {},
        timeNotes: {},
        festivalIdsSet: new Set(),
      };

      film.showings.forEach((showing) => {
        (showing.times || []).forEach((time) => {
          const showDateTime = getShowDateTime(showing.date, time);
          if (!showDateTime || showDateTime < now) return;
          if (!row.dates[showing.date]) row.dates[showing.date] = [];
          row.dates[showing.date].push(time);
          if (!row.roomByDate[showing.date]) row.roomByDate[showing.date] = String(showing?.room || "").trim();
          addTimeNote(row.timeNotes, showing.date, time, false, showing?.notes);
          const festivalId = Number.isInteger(Number(showing?.festivalId)) ? Number(showing.festivalId) : null;
          if (festivalId) row.festivalIdsSet.add(festivalId);
        });
        (showing.premiumTimes || []).forEach((time) => {
          const showDateTime = getShowDateTime(showing.date, time);
          if (!showDateTime || showDateTime < now) return;
          if (!row.premiumDates[showing.date]) row.premiumDates[showing.date] = [];
          row.premiumDates[showing.date].push(time);
          if (!row.roomByDate[showing.date]) row.roomByDate[showing.date] = String(showing?.room || "").trim();
          addTimeNote(row.timeNotes, showing.date, time, true, showing?.notes);
          const festivalId = Number.isInteger(Number(showing?.festivalId)) ? Number(showing.festivalId) : null;
          if (festivalId) row.festivalIdsSet.add(festivalId);
        });
      });

      if (Object.keys(row.dates).length || Object.keys(row.premiumDates).length) {
        row.festivalIds = Array.from(row.festivalIdsSet.values());
        delete row.festivalIdsSet;
        rowsByFilm[buildFilmGroupKey(row.film, row.year)] = row;
      }
    });

    Object.values(rowsByFilm).forEach((row) => {
      Object.keys(row.dates).forEach((date) => {
        row.dates[date].sort(compareTimes);
      });
      Object.keys(row.premiumDates).forEach((date) => {
        row.premiumDates[date].sort(compareTimes);
      });
      if (!Object.keys(row.dates).length && !Object.keys(row.premiumDates).length) return;

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
      }
    });
  });

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
  return `${view}-row::${filmKey}`;
}

function renderSchedule(container, dates, premiumDates = {}, timeNotes = {}) {
  container.innerHTML = "";
  const dateKeys = new Set([...Object.keys(dates || {}), ...Object.keys(premiumDates || {})]);
  const dateEntries = Array.from(dateKeys)
    .sort((a, b) => a.localeCompare(b))
    .map((date) => [date, dates?.[date] || [], premiumDates?.[date] || []]);

  const visibleEntries = dateEntries.slice(0, 2);
  const hiddenEntries = dateEntries.slice(2);

  visibleEntries.forEach(([date, times, premiumTimes]) => {
    container.appendChild(createScheduleRow(date, times, premiumTimes, timeNotes));
  });

  if (hiddenEntries.length) {
    const details = document.createElement("details");
    details.className = "show-schedule-collapse";

    const summary = document.createElement("summary");
    summary.className = "show-schedule-summary";
    summary.textContent = `More dates (${hiddenEntries.length})`;
    details.appendChild(summary);

    const extra = document.createElement("div");
    hiddenEntries.forEach(([date, times, premiumTimes]) => {
      extra.appendChild(createScheduleRow(date, times, premiumTimes, timeNotes));
    });
    details.appendChild(extra);

    container.appendChild(details);
  }
}

function createScheduleRow(date, times, premiumTimes = [], timeNotes = {}) {
  const row = document.createElement("div");
  row.className = "show-schedule-row";

  const label = document.createElement("span");
  label.className = "show-schedule-day";
  label.textContent = formatDisplayDate(date);

  const value = document.createElement("span");
  value.className = "show-schedule-times";
  const mergedTimes = [
    ...(times || []).filter(Boolean).map((time) => ({ time, isPremium: false })),
    ...(premiumTimes || []).filter(Boolean).map((time) => ({ time, isPremium: true })),
  ].sort((a, b) => {
    const byTime = compareTimes(a.time, b.time);
    if (byTime !== 0) return byTime;
    if (a.isPremium === b.isPremium) return 0;
    return a.isPremium ? 1 : -1;
  });

  mergedTimes.forEach((entry, index) => {
    if (index > 0) {
      value.appendChild(document.createTextNode(", "));
    }
    const note = timeNotes?.[buildTimeNoteKey(date, entry.time, entry.isPremium)] || "";
    let timeEl;
    if (entry.isPremium) {
      timeEl = document.createElement("span");
      timeEl.className = "show-premium-pill";
      timeEl.textContent = `Premium ${entry.time}`;
    } else if (note) {
      timeEl = document.createElement("span");
      timeEl.textContent = entry.time;
    } else {
      value.appendChild(document.createTextNode(entry.time));
      return;
    }
    if (note) attachShowtimeNote(timeEl, note);
    value.appendChild(timeEl);
  });

  row.appendChild(label);
  row.appendChild(value);
  return row;
}

function buildTimeNoteKey(date, time, isPremium) {
  return `${date}|${time}|${isPremium ? "premium" : "standard"}`;
}

function addTimeNote(timeNotes, date, time, isPremium, notes) {
  const text = getShowtimeNote(notes, time);
  if (!text) return;
  const key = buildTimeNoteKey(date, time, isPremium);
  const existing = timeNotes[key];
  if (!existing) {
    timeNotes[key] = text;
  } else if (!existing.split(" · ").includes(text)) {
    timeNotes[key] = `${existing} · ${text}`;
  }
}

function attachShowtimeNote(timeEl, note) {
  timeEl.classList.add("show-time-noted");
  timeEl.dataset.note = note;
  timeEl.tabIndex = 0;
  const icon = document.createElement("span");
  icon.className = "show-note-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "i";
  timeEl.appendChild(icon);
  const srNote = document.createElement("span");
  srNote.className = "visually-hidden";
  srNote.textContent = ` (Note: ${note})`;
  timeEl.appendChild(srNote);
}

function expandFestivalShowsByDate(shows) {
  const flattened = [];
  (shows || []).forEach((show) => {
    const dateKeys = new Set([
      ...Object.keys(show?.dates || {}),
      ...Object.keys(show?.premiumDates || {}),
    ]);
    dateKeys.forEach((date) => {
      const dateKey = String(date || "").trim();
      if (!dateKey) return;
      const times = dedupeSortTimes(show?.dates?.[dateKey] || []);
      const premiumTimes = dedupeSortTimes(show?.premiumDates?.[dateKey] || []);
      if (!times.length && !premiumTimes.length) return;
      flattened.push({
        ...show,
        festivalDate: dateKey,
        dates: { [dateKey]: times },
        premiumDates: { [dateKey]: premiumTimes },
      });
    });
  });

  flattened.sort((a, b) => {
    const dateA = String(a?.festivalDate || "");
    const dateB = String(b?.festivalDate || "");
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    const earliestA = getRowEarliestShowtimeTimestamp(a);
    const earliestB = getRowEarliestShowtimeTimestamp(b);
    if (earliestA !== earliestB) return earliestA - earliestB;
    const filmComparison = buildFilmGroupKey(a?.film, a?.year).localeCompare(buildFilmGroupKey(b?.film, b?.year));
    if (filmComparison !== 0) return filmComparison;
    return `${a?.theatre || ""} ${a?.city || ""}`.localeCompare(`${b?.theatre || ""} ${b?.city || ""}`);
  });

  return flattened;
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
  const rankingOverride = Boolean(
    film.rankingOverride ?? film.ranking_override ?? tmdb.rankingOverride ?? tmdb.ranking_override
  );
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
    rankingOverride,
    popularity,
    voteAverage,
    voteCount,
    releaseDate,
    matchedAt,
  };
}

function formatShortDate(dateIso) {
  const date = parseIsoDate(dateIso);
  if (!date) return dateIso;
  const dayDiff = getDayDifferenceFromToday(date);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff > 1 && dayDiff <= 6) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
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

function formatFestivalDateRange(startDateIso, endDateIso) {
  const start = parseIsoDate(startDateIso);
  const end = parseIsoDate(endDateIso);
  const fmt = (date) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(date);
  if (start && end) return `${fmt(start)} - ${fmt(end)}`;
  if (start) return fmt(start);
  if (end) return fmt(end);
  return "";
}

function toIsoDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
