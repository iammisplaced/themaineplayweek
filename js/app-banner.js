// The "get the app" banner at the top of the main page and film pages, and Google Analytics
// events for the store links. Loaded as a plain script straight after <body>, so the banner is
// there for the first paint and nothing moves down to make room for it.

const APP_BANNER_STORES = {
  ios: "https://apps.apple.com/us/app/the-maine-playweek/id6837351844",
  // The referrer shows up in Play Console, so installs can be told apart by where they came from.
  android:
    "https://play.google.com/store/apps/details?id=com.themaineplayweek.app&referrer=utm_source%3Dwebsite%26utm_medium%3Dbanner",
};
const APP_BANNER_STORAGE_KEY = "tmp-app-banner-hidden-v1";
const APP_BANNER_HIDE_MS = 60 * 24 * 60 * 60 * 1000;

// Which store the banner should point to, or "" for no banner. Safari on iPhone gets Apple's own
// banner instead (the apple-itunes-app tag). Other iPhone browsers and in-app browsers don't
// have "Version/… Safari/…" in their user agent, or add a name of their own.
function appBannerStore(userAgent) {
  if (/bot\b|crawl|spider|lighthouse/i.test(userAgent)) return "";
  if (/Android/i.test(userAgent) && !/Windows Phone/i.test(userAgent)) return "android";
  if (!/iPhone|iPad|iPod/.test(userAgent)) return "";
  const isSafari =
    /Version\/\d/.test(userAgent) &&
    /Safari\//.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|OPR\/|GSA\/|DuckDuckGo|Ddg\/|YaBrowser|FBAN|FBAV|FB_IAB|Instagram/.test(userAgent);
  return isSafari ? "" : "ios";
}

// Dismissing the banner, or tapping through to the store, hides it for a while.
function isAppBannerHidden(stored, now) {
  const hiddenAt = Number(stored);
  return hiddenAt > 0 && now >= hiddenAt && now - hiddenAt < APP_BANNER_HIDE_MS;
}

(() => {
  const track = (name, params) => {
    if (typeof gtag === "function") gtag("event", name, params);
  };

  document.addEventListener("click", (event) => {
    const badge = event.target.closest?.(".app-badges a");
    if (badge) track("app_badge_tap", { store: badge.href.includes("play.google") ? "android" : "ios" });
  });

  const store = appBannerStore(navigator.userAgent);
  if (!store) return;

  try {
    if (isAppBannerHidden(localStorage.getItem(APP_BANNER_STORAGE_KEY), Date.now())) return;
  } catch {}

  const rememberHidden = () => {
    try {
      localStorage.setItem(APP_BANNER_STORAGE_KEY, String(Date.now()));
    } catch {}
  };

  const banner = document.createElement("aside");
  banner.className = "app-banner";
  banner.setAttribute("aria-label", "The Maine Playweek app");
  banner.innerHTML = `
    <img class="app-banner-icon" src="/assets/icons/apple-touch-icon.png" alt="" width="40" height="40" />
    <p class="app-banner-text">
      <strong>The Maine Playweek</strong>
      <span>Star films and hear when they come to Maine.</span>
    </p>
    <a class="app-banner-get" href="${APP_BANNER_STORES[store].replace(/&/g, "&amp;")}" rel="noopener">Get<span class="app-banner-get-more"> the app</span></a>
    <button class="app-banner-close" type="button" aria-label="Close app banner">✕</button>`;

  banner.querySelector(".app-banner-get").addEventListener("click", () => {
    track("app_banner_tap", { store });
    rememberHidden();
  });
  banner.querySelector(".app-banner-close").addEventListener("click", () => {
    track("app_banner_dismiss", { store });
    rememberHidden();
    banner.remove();
  });

  // Android Chrome may offer the Play app by itself; one prompt at a time is enough.
  window.addEventListener("beforeinstallprompt", (event) => {
    if (banner.isConnected) event.preventDefault();
  });

  document.body.prepend(banner);
  track("app_banner_view", { store });
})();
