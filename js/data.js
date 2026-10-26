// The showtimes data as the site and the admin both use it: reading it from Supabase,
// checking it, and the small helpers that normalize films, titles and times.
import {
  SHOWTIME_COLUMNS,
  compareTimes,
  getShowDateTime,
  groupShowtimesIntoShowings,
  isPlainObject,
  parseIsoDate,
  stripDiacritics,
  to24HourTime,
} from "./shared.js";

// The admin's copy of its last save. The site falls back to it if Supabase can't be read.
export const STORAGE_KEY = "showtimes-local-edit";
// Supabase Storage bucket holding the promo card images.
export const PROMO_STORAGE_BUCKET = "promo-images";

export async function loadDataFromSupabase(supabase) {
  // Read before the tables: if a save lands mid-load, this version is older and the
  // next save is refused instead of overwriting it.
  const dataVersion = await loadDataVersion(supabase);
  const [theatres, films, theatreFilms, showtimes, promos, festivals] = await Promise.all([
    fetchAllRowsFromSupabase("theatres", () =>
      supabase.from("theatres").select("id,name,city,address,website,latitude,longitude").order("id", { ascending: true })
    ),
    fetchAllRowsFromSupabase("films", () =>
      supabase
        .from("films")
        .select(
          "id,title,year,tmdb_id,synopsis,staff_favorite,staff_favorite_by,featured_on_playweek,featured_on_playweek_url,ranking_override,metadata_source,tmdb_json"
        )
        .order("id", { ascending: true })
    ),
    fetchAllRowsFromSupabase("theatre_films", () =>
      supabase
        .from("theatre_films")
        .select("theatre_id,film_id,ticket_link")
        .order("theatre_id", { ascending: true })
        .order("film_id", { ascending: true })
    ),
    fetchAllRowsFromSupabase("showtimes", () =>
      supabase.from("showtimes").select(SHOWTIME_COLUMNS).order("id", { ascending: true })
    ),
    fetchAllRowsFromSupabase("promos", () =>
      supabase
        .from("promos")
        .select("id,title,button_url,image_path,image_alt,image_name,button_label,enabled,sort_order")
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
    ),
    fetchAllRowsFromSupabase("festivals", () =>
      supabase
        .from("festivals")
        .select("id,slug,name,description,website,primary_color,start_date,end_date,enabled,sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true })
    ),
  ]);
  // The admin and the site work with one entry per theatre, film and day.
  const showings = groupShowtimesIntoShowings(showtimes);

  const theatreById = new Map();
  const filmById = new Map();
  const theatreGroups = theatres.map((theatreRow) => {
    const entry = {
      id: theatreRow.id,
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
      staffFavorite: Boolean(filmRow.staff_favorite),
      staffFavoriteBy: String(filmRow.staff_favorite_by || "").trim(),
      featuredOnPlayweek: Boolean(filmRow.featured_on_playweek),
      featuredOnPlayweekUrl: String(filmRow.featured_on_playweek_url || "").trim(),
      rankingOverride: Boolean(filmRow.ranking_override),
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
        rankingOverride: Boolean(filmTemplate.rankingOverride),
        metadataSource: normalizeMetadataSource(filmTemplate.metadataSource, filmTemplate),
        tmdb: filmTemplate.tmdb,
        showings: [],
        _dbId: filmTemplate._dbId,
      };
      theatre._filmMap.set(String(filmTemplate._dbId), filmCopy);
      theatre.films.push(filmCopy);
    });
  });

  // Theatre-specific ticket links.
  theatreFilms.forEach((linkRow) => {
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
    const festivalId = Number(showingRow.festival_id);

    film.showings.push({
      date: showingRow.show_date,
      room: String(showingRow.room || "").trim(),
      notes: String(showingRow.notes || "").trim(),
      festivalId: showingRow.festival_id != null && Number.isInteger(festivalId) ? festivalId : null,
      times: dedupeSortTimes(Array.isArray(showingRow.times) ? showingRow.times : []),
      premiumTimes: dedupeSortTimes(Array.isArray(showingRow.premium_times) ? showingRow.premium_times : []),
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
    festivals: (festivals || []).map((row) => ({
      id: Number(row.id),
      slug: String(row.slug || "").trim(),
      name: String(row.name || "").trim(),
      description: String(row.description || "").trim(),
      website: String(row.website || "").trim(),
      primaryColor: String(row.primary_color || "").trim(),
      startDate: String(row.start_date || "").trim(),
      endDate: String(row.end_date || "").trim(),
      enabled: Boolean(row.enabled ?? true),
      sortOrder: Number.isInteger(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    })),
    promotedCards: buildPromotedCardsFromSupabaseRows(promos),
    dataVersion,
  };
}

// Null if data_version can't be read (e.g. the table isn't there yet); the save then
// skips the stale-tab check rather than failing, so visitors never notice.
async function loadDataVersion(supabase) {
  try {
    const { data, error } = await supabase.from("data_version").select("version").eq("id", 1).maybeSingle();
    if (error || !data) return null;
    const version = Number(data.version);
    return Number.isInteger(version) ? version : null;
  } catch {
    return null;
  }
}

export async function fetchAllRowsFromSupabase(tableName, queryBuilderFactory, pageSize = 1000) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const result = await queryBuilderFactory().range(from, to);
    if (result.error) {
      throw new Error(`Supabase read failed for table "${tableName}": ${result.error.message}`);
    }
    const chunk = result.data || [];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
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

export function validateData(data) {
  if (!data || !Array.isArray(data.theatreGroups)) {
    throw new Error("Expected object with theatreGroups array.");
  }
  if (typeof data.festivals !== "undefined" && !Array.isArray(data.festivals)) {
    throw new Error("Expected festivals to be an array when provided.");
  }

  const knownFestivalIds = new Set(
    (data.festivals || [])
      .map((festival) => Number(festival?.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );

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
        if (typeof showing?.times !== "undefined" && !Array.isArray(showing.times)) {
          throw new Error(`A showing for "${film.title}" has invalid times array.`);
        }
        if (typeof showing?.premiumTimes !== "undefined" && !Array.isArray(showing.premiumTimes)) {
          throw new Error(`A showing for "${film.title}" has invalid premiumTimes array.`);
        }
        const rawFestivalId = showing?.festivalId;
        const normalizedFestivalId = normalizeNullablePositiveInt(rawFestivalId);
        if (typeof showing === "object" && showing) {
          showing.festivalId = normalizedFestivalId;
        }
        if (normalizedFestivalId !== null && knownFestivalIds.size > 0 && !knownFestivalIds.has(normalizedFestivalId)) {
          if (typeof showing === "object" && showing) {
            showing.festivalId = null;
          }
        }
        const standardTimes = dedupeSortTimes(showing?.times || []);
        const premiumTimes = dedupeSortTimes(showing?.premiumTimes || []);
        if (standardTimes.length === 0 && premiumTimes.length === 0) {
          throw new Error(`A showing for "${film.title}" must include at least one standard or premium time.`);
        }
        for (const time of standardTimes) {
          if (typeof time !== "string" || !time.trim()) {
            throw new Error(`A showing for "${film.title}" contains an empty time.`);
          }
          if (!to24HourTime(time)) {
            throw new Error(`A showing for "${film.title}" has invalid time format. Use h:mm AM/PM.`);
          }
        }
        for (const time of premiumTimes) {
          if (typeof time !== "string" || !time.trim()) {
            throw new Error(`A showing for "${film.title}" contains an empty premium time.`);
          }
          if (!to24HourTime(time)) {
            throw new Error(`A showing for "${film.title}" has invalid premium time format. Use h:mm AM/PM.`);
          }
        }
      }
    }
  }
}

function normalizeNullablePositiveInt(value) {
  if (value === null || typeof value === "undefined") return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function dedupeSortTimes(times) {
  return Array.from(new Set((times || []).map((entry) => String(entry || "").trim()).filter(Boolean))).sort(compareTimes);
}

export function sortFilms(films) {
  films.sort((a, b) => buildFilmGroupKey(a.title, a.year).localeCompare(buildFilmGroupKey(b.title, b.year)));
}

export function buildFilmGroupKey(title, year) {
  if (Number.isInteger(year)) return `${title} (${year})`;
  return title;
}

export function normalizeFilmTitle(value) {
  return stripDiacritics(String(value || ""))
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSearchText(value) {
  return stripDiacritics(value)
    .trim()
    .toLowerCase();
}

export function normalizeMetadataSource(value, film = null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "tmdb" || normalized === "manual") return normalized;
  const tmdbId = Number(film?.tmdbId);
  return Number.isInteger(tmdbId) && tmdbId > 0 ? "tmdb" : "manual";
}

export function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

export function normalizePosterUrl(value) {
  if (!value || typeof value !== "string") return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("/")) return `https://image.tmdb.org/t/p/w185${value}`;
  return "";
}

export function addDaysIso(dateIso, daysToAdd) {
  const base = parseIsoDate(dateIso);
  if (!base) return dateIso;
  const next = new Date(base);
  next.setDate(next.getDate() + daysToAdd);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, "0");
  const d = String(next.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
