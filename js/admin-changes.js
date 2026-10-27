// What a save sends: the difference between two payloads from buildReplacePayload, and a
// short description of it for the Save bar. No DOM access, so Node can load it for tests.

// The rows added, changed or removed between two payloads from buildReplacePayload, or
// null if there are none. Rows are matched on their database id, and ones without an id
// are new. Showtimes are compared a day (theatre, film and date) at a time, and a changed
// day is sent whole. Ticket links and days name their theatre and film by id, or by the
// payload key of a new one.
export function buildChangesPayload(before, after) {
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

export function changesAddRows(changes) {
  return (
    changes.festivals.upsert.some((row) => row.id == null) ||
    ["theatres", "films", "promos"].some((table) => changes[table].upsert.some((row) => row.db_id == null))
  );
}

// The changes from buildChangesPayload as short phrases, like "2 showtime days changed"
// or "1 new film", most common kinds first. Empty for null.
export function describeChanges(changes) {
  if (!changes) return [];
  const parts = [];
  const add = (count, phrase) => {
    if (count) parts.push(phrase(count));
  };
  const { days, entries } = changes.showings;
  const keptDays = new Set(entries.map((entry) => dayRef(entry)));
  const removedDays = days.filter((day) => !keptDays.has(dayRef(day))).length;
  add(days.length - removedDays, (n) => `${pluralize(n, "showtime day")} changed`);
  add(removedDays, (n) => `${pluralize(n, "showtime day")} removed`);
  add(changes.theatre_films.upsert.length, (n) => `${pluralize(n, "ticket link")} changed`);
  add(changes.theatre_films.delete.length, (n) => `${pluralize(n, "ticket link")} removed`);
  [
    ["films", "db_id", "film"],
    ["theatres", "db_id", "theatre"],
    ["festivals", "id", "festival"],
    ["promos", "db_id", "promo"],
  ].forEach(([table, idField, word]) => {
    const { upsert, delete: removed } = changes[table];
    const created = upsert.filter((row) => row[idField] == null).length;
    add(created, (n) => `${n} new ${word}${n === 1 ? "" : "s"}`);
    add(upsert.length - created, (n) => `${pluralize(n, word)} edited`);
    add(removed.length, (n) => `${pluralize(n, word)} removed`);
  });
  return parts;
}

function dayRef(day) {
  return [day.theatre_db_id, day.theatre_key, day.film_db_id, day.film_key, day.show_date].join("|");
}

function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
