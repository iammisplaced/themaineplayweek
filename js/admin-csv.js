// Showtimes CSV import for the admin. No DOM access, so Node can load it for tests.
// The CSV lists showtimes known to be happening, not every showtime, so an import only
// adds. findTimesMissingFromCsv lists what the site has on the days the CSV covers but the
// CSV doesn't, and removeCsvMissingTimes takes out only the ones the admin picks.
import { getShowDateTime, mergeShowtimeNotes, normalizeOutboundUrl, parseIsoDate, to24HourTime } from "./shared.js";
import { dedupeSortTimes, normalizeFilmTitle, normalizeSearchText, sortFilms } from "./data.js";

export function importShowtimesCsv(data, csvContent) {
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
    filmsCreated: 0,
    createdFilms: [],
    ticketLinksChanged: 0,
    // One entry per theatre, film and date the CSV lists, in CSV order: the times the CSV
    // gives and the times the site had before. See summarizeCsvDays.
    days: [],
  };
  const dayByFilmAndDate = new Map();
  const changedDetails = { room: new Set(), notes: new Set(), festival: new Set() };

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
      const ticketLink = normalizeOutboundUrl(ticketLinkRaw);
      if (ticketLink !== (film.ticketLink || "")) stats.ticketLinksChanged += 1;
      film.ticketLink = ticketLink;
    }

    if (!Array.isArray(film.showings)) film.showings = [];
    let showing = film.showings.find((entry) => entry.date === showDate);
    let day = dayByFilmAndDate.get(film)?.get(showDate);
    if (!day) {
      day = {
        theatre,
        film,
        date: showDate,
        newFilm: !filmMatches.length,
        beforeTimes: showing ? dedupeSortTimes(showing.times) : [],
        beforePremiumTimes: showing ? dedupeSortTimes(showing.premiumTimes) : [],
        csvTimes: [],
        csvPremiumTimes: [],
      };
      if (!dayByFilmAndDate.has(film)) dayByFilmAndDate.set(film, new Map());
      dayByFilmAndDate.get(film).set(showDate, day);
      stats.days.push(day);
    }
    day.csvTimes = dedupeSortTimes([...day.csvTimes, ...parsedTimes]);
    day.csvPremiumTimes = dedupeSortTimes([...day.csvPremiumTimes, ...parsedPremiumTimes]);

    if (showing) {
      const before = { room: showing.room || "", notes: showing.notes || "", festival: showing.festivalId || null };
      showing.times = dedupeSortTimes([...(showing.times || []), ...timesNotIn(parsedTimes, showing.times)]);
      showing.premiumTimes = dedupeSortTimes([
        ...(showing.premiumTimes || []),
        ...timesNotIn(parsedPremiumTimes, showing.premiumTimes),
      ]);
      if (clearRoom || csvRoom) showing.room = csvRoom;
      if (clearNotes) showing.notes = "";
      else if (csvNotes) showing.notes = mergeShowtimeNotes(showing.notes, csvNotes);
      if (resolvedFestivalId) {
        showing.festivalId = resolvedFestivalId;
      }
      if ((showing.room || "") !== before.room) changedDetails.room.add(day);
      if ((showing.notes || "") !== before.notes) changedDetails.notes.add(day);
      if ((showing.festivalId || null) !== before.festival) changedDetails.festival.add(day);
    } else {
      showing = {
        date: showDate,
        room: csvRoom,
        notes: csvNotes,
        festivalId: resolvedFestivalId,
        times: dedupeSortTimes(parsedTimes),
        premiumTimes: dedupeSortTimes(parsedPremiumTimes),
      };
      film.showings.push(showing);
      film.showings.sort((a, b) => a.date.localeCompare(b.date));
    }

    stats.rowsProcessed += 1;
  }

  stats.roomsChanged = changedDetails.room.size;
  stats.notesChanged = changedDetails.notes.size;
  stats.festivalsChanged = changedDetails.festival.size;
  return stats;
}

// The times each listed day gains: CSV times the site didn't have. Days with nothing new
// are left out.
export function summarizeCsvDays(days) {
  return days
    .map((day) => ({
      theatre: day.theatre,
      film: day.film,
      date: day.date,
      newFilm: day.newFilm,
      newDay: !day.beforeTimes.length && !day.beforePremiumTimes.length,
      times: timesNotIn(day.csvTimes, day.beforeTimes),
      premiumTimes: timesNotIn(day.csvPremiumTimes, day.beforePremiumTimes),
    }))
    .filter((day) => day.times.length || day.premiumTimes.length);
}

// Times the site has, on a theatre and date the CSV covers, that the CSV doesn't list:
// a moved or cancelled show, or one the CSV's source missed. Times that have already
// started are left out (they're dropped on the next save anyway). Run it on the data
// after importShowtimesCsv, with that call's result.
export function findTimesMissingFromCsv(data, importResult, now = new Date()) {
  const csvTimesByFilm = new Map();
  const datesByTheatre = new Map();
  importResult.days.forEach((day) => {
    if (!csvTimesByFilm.has(day.film)) csvTimesByFilm.set(day.film, new Map());
    csvTimesByFilm.get(day.film).set(day.date, day);
    if (!datesByTheatre.has(day.theatre)) datesByTheatre.set(day.theatre, new Set());
    datesByTheatre.get(day.theatre).add(day.date);
  });

  const missing = [];
  data.theatreGroups.forEach((theatre) => {
    const dates = datesByTheatre.get(theatre);
    if (!dates) return;
    (theatre.films || []).forEach((film) => {
      (film.showings || []).forEach((showing) => {
        if (!dates.has(showing.date)) return;
        const csvDay = csvTimesByFilm.get(film)?.get(showing.date);
        const entry = {
          theatre,
          film,
          date: showing.date,
          times: timesNotIn(showing.times, csvDay?.csvTimes || []),
          premiumTimes: timesNotIn(showing.premiumTimes, csvDay?.csvPremiumTimes || []),
        };
        const notStarted = (time) => {
          const startsAt = getShowDateTime(showing.date, time);
          return !startsAt || startsAt >= now;
        };
        entry.times = entry.times.filter(notStarted);
        entry.premiumTimes = entry.premiumTimes.filter(notStarted);
        if (entry.times.length || entry.premiumTimes.length) missing.push(entry);
      });
    });
  });
  missing.sort(
    (a, b) =>
      String(a.theatre.name).localeCompare(String(b.theatre.name)) ||
      a.date.localeCompare(b.date) ||
      String(a.film.title).localeCompare(String(b.film.title))
  );
  return missing;
}

// Removes the picked times ({ film, date, time, premium }) from the data. A day left with
// no times is removed.
export function removeCsvMissingTimes(picks) {
  picks.forEach(({ film, date, time, premium }) => {
    const showing = (film.showings || []).find((entry) => entry.date === date);
    if (!showing) return;
    const key = premium ? "premiumTimes" : "times";
    showing[key] = (showing[key] || []).filter((entry) => !sameTime(entry, time));
    if (!(showing.times || []).length && !(showing.premiumTimes || []).length) {
      film.showings = film.showings.filter((entry) => entry !== showing);
    }
  });
}

function sameTime(a, b) {
  const a24 = to24HourTime(a);
  return a24 ? a24 === to24HourTime(b) : String(a).trim() === String(b).trim();
}

function timesNotIn(times, others) {
  return dedupeSortTimes(times).filter((time) => !(others || []).some((other) => sameTime(time, other)));
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
    rows[0][0] = String(rows[0][0] || "").replace(/^﻿/, "");
  }

  return rows;
}

export function toCsvCell(value) {
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

function normalizeCityMatchText(value) {
  return normalizeSearchText(value).replace(/\b(maine|me)\b/g, "").replace(/,\s*$/g, "").trim();
}
