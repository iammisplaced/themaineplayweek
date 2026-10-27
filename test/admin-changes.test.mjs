import assert from "node:assert/strict";
import { test } from "node:test";
import { buildChangesPayload, changesAddRows, describeChanges } from "../js/admin-changes.js";

// A small payload shaped like buildReplacePayload's: one theatre, two films, saved rows.
function makePayload() {
  return {
    festivals: [{ id: 1, key: "f1", name: "PIFF" }],
    theatres: [{ db_id: 10, key: "t1", name: "Nickelodeon" }],
    films: [
      { db_id: 20, key: "m1", title: "Anora" },
      { db_id: 21, key: "m2", title: "Bugonia" },
    ],
    promos: [],
    theatre_films: [{ theatre_key: "t1", film_key: "m1", ticket_link: "https://example.com/anora" }],
    showings: [
      { theatre_key: "t1", film_key: "m1", show_date: "2026-10-28", show_time: "19:00" },
      { theatre_key: "t1", film_key: "m1", show_date: "2026-10-28", show_time: "21:30" },
      { theatre_key: "t1", film_key: "m2", show_date: "2026-10-29", show_time: "17:00" },
    ],
  };
}

test("identical payloads have no changes", () => {
  assert.equal(buildChangesPayload(makePayload(), makePayload()), null);
  assert.deepEqual(describeChanges(null), []);
});

test("an edit undone by hand leaves no changes", () => {
  const after = makePayload();
  after.showings.splice(1, 1);
  after.showings.splice(1, 0, { theatre_key: "t1", film_key: "m1", show_date: "2026-10-28", show_time: "21:30" });
  assert.equal(buildChangesPayload(makePayload(), after), null);
});

test("describes changed and removed showtime days", () => {
  const after = makePayload();
  after.showings = after.showings.filter((row) => row.show_time !== "21:30" && row.film_key !== "m2");
  const changes = buildChangesPayload(makePayload(), after);
  assert.deepEqual(describeChanges(changes), ["1 showtime day changed", "1 showtime day removed"]);
});

test("describes ticket links and new, edited and removed rows", () => {
  const after = makePayload();
  after.theatre_films[0].ticket_link = "https://example.com/anora-2";
  after.films[1] = { ...after.films[1], title: "Bugonia (2025)" };
  after.films.push({ db_id: null, key: "m3", title: "Hamnet" }, { db_id: null, key: "m4", title: "Sirat" });
  after.festivals = [];
  const changes = buildChangesPayload(makePayload(), after);
  assert.deepEqual(describeChanges(changes), [
    "1 ticket link changed",
    "2 new films",
    "1 film edited",
    "1 festival removed",
  ]);
  assert.equal(changesAddRows(changes), true);
});

test("a removed ticket link is described", () => {
  const after = makePayload();
  after.theatre_films = [];
  const changes = buildChangesPayload(makePayload(), after);
  assert.deepEqual(describeChanges(changes), ["1 ticket link removed"]);
  assert.equal(changesAddRows(changes), false);
});
