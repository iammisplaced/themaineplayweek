import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findTimesMissingFromCsv,
  importShowtimesCsv,
  removeCsvMissingTimes,
  summarizeCsvDays,
} from "../js/admin-csv.js";

const HEADER = "theatre_name,theatre_city,film_title,show_date,show_times,premium_show_times,room,notes,ticket_link";
const NOW = new Date(2026, 9, 27, 12, 0);

function makeData() {
  return {
    festivals: [],
    theatreGroups: [
      {
        name: "Nickelodeon",
        city: "Portland",
        films: [
          {
            title: "Anora",
            ticketLink: "",
            showings: [
              { date: "2026-10-28", times: ["7:00 PM", "9:30 PM"], premiumTimes: [] },
              { date: "2026-10-30", times: ["5:00 PM"], premiumTimes: [] },
            ],
          },
          {
            title: "Bugonia",
            ticketLink: "",
            showings: [{ date: "2026-10-28", times: ["6:00 PM"], premiumTimes: ["8:00 PM"] }],
          },
        ],
      },
      {
        name: "Railroad Square",
        city: "Waterville",
        films: [{ title: "Anora", ticketLink: "", showings: [{ date: "2026-10-28", times: ["4:00 PM"], premiumTimes: [] }] }],
      },
    ],
  };
}

function csv(...rows) {
  return [HEADER, ...rows].join("\n");
}

const film = (data, theatreIndex, title) => data.theatreGroups[theatreIndex].films.find((f) => f.title === title);

test("a moved time is added, and the old one is listed as missing but kept", () => {
  const data = makeData();
  const result = importShowtimesCsv(data, csv("Nickelodeon,Portland,Anora,2026-10-28,7:15 PM|9:30 PM,,,,"));
  const anora = film(data, 0, "Anora");
  assert.deepEqual(anora.showings[0].times, ["7:00 PM", "7:15 PM", "9:30 PM"]);

  const added = summarizeCsvDays(result.days);
  assert.equal(added.length, 1);
  assert.deepEqual(added[0].times, ["7:15 PM"]);
  assert.equal(added[0].newDay, false);

  const missing = findTimesMissingFromCsv(data, result, NOW);
  const anoraMissing = missing.find((entry) => entry.film === anora);
  assert.deepEqual(anoraMissing.times, ["7:00 PM"]);
});

test("a film the CSV leaves out on a covered day is listed as missing, times and premium", () => {
  const data = makeData();
  const result = importShowtimesCsv(data, csv("Nickelodeon,Portland,Anora,2026-10-28,7:00 PM|9:30 PM,,,,"));
  const missing = findTimesMissingFromCsv(data, result, NOW);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].film, film(data, 0, "Bugonia"));
  assert.deepEqual(missing[0].times, ["6:00 PM"]);
  assert.deepEqual(missing[0].premiumTimes, ["8:00 PM"]);
  assert.equal(summarizeCsvDays(result.days).length, 0);
});

test("theatres and dates the CSV doesn't cover are never listed", () => {
  const data = makeData();
  const result = importShowtimesCsv(data, csv("Nickelodeon,Portland,Anora,2026-10-28,7:00 PM|9:30 PM,,,,"));
  const missing = findTimesMissingFromCsv(data, result, NOW);
  assert.ok(missing.every((entry) => entry.date === "2026-10-28"));
  assert.ok(missing.every((entry) => entry.theatre.name === "Nickelodeon"));
});

test("times that already started are not listed", () => {
  const data = makeData();
  data.theatreGroups[0].films[1].showings[0].date = "2026-10-27";
  data.theatreGroups[0].films[1].showings[0].times = ["11:00 AM", "6:00 PM"];
  data.theatreGroups[0].films[1].showings[0].premiumTimes = [];
  const result = importShowtimesCsv(data, csv("Nickelodeon,Portland,Anora,2026-10-27,3:00 PM,,,,"));
  const missing = findTimesMissingFromCsv(data, result, NOW);
  assert.deepEqual(missing.map((entry) => entry.times), [["6:00 PM"]]);
});

test("rows for the same film and day are combined before comparing", () => {
  const data = makeData();
  const result = importShowtimesCsv(
    data,
    csv("Nickelodeon,Portland,Anora,2026-10-28,7:00 PM,,,,", "Nickelodeon,Portland,Anora,2026-10-28,9:30 PM,,,,")
  );
  assert.equal(result.days.length, 1);
  const missing = findTimesMissingFromCsv(data, result, NOW);
  assert.ok(!missing.some((entry) => entry.film === film(data, 0, "Anora")));
});

test("times match across spelling differences", () => {
  const data = makeData();
  const result = importShowtimesCsv(data, csv("Nickelodeon,Portland,Anora,2026-10-28,7:00 pm|9:30PM,,,,"));
  const missing = findTimesMissingFromCsv(data, result, NOW);
  assert.ok(!missing.some((entry) => entry.film === film(data, 0, "Anora")));
  assert.equal(summarizeCsvDays(result.days).length, 0);
  assert.deepEqual(film(data, 0, "Anora").showings[0].times, ["7:00 PM", "9:30 PM"]);
});

test("new films and new days are reported as added", () => {
  const data = makeData();
  const result = importShowtimesCsv(
    data,
    csv("Nickelodeon,Portland,Hamnet,2026-10-29,1:00 PM,,,,", "Nickelodeon,Portland,Anora,2026-10-29,2:00 PM,,,,")
  );
  assert.equal(result.filmsCreated, 1);
  const added = summarizeCsvDays(result.days);
  assert.deepEqual(
    added.map((day) => [day.film.title, day.newFilm, day.newDay, day.times]),
    [
      ["Hamnet", true, true, ["1:00 PM"]],
      ["Anora", false, true, ["2:00 PM"]],
    ]
  );
});

test("detail changes are counted only when the value changes", () => {
  const data = makeData();
  data.theatreGroups[0].films[0].ticketLink = "https://tickets.example.com/anora";
  data.theatreGroups[0].films[0].showings[0].room = "Screen 1";
  const result = importShowtimesCsv(
    data,
    csv(
      "Nickelodeon,Portland,Anora,2026-10-28,7:00 PM,,Screen 1,,https://tickets.example.com/anora",
      "Nickelodeon,Portland,Bugonia,2026-10-28,6:00 PM,,Screen 2,Q&A,https://tickets.example.com/bugonia"
    )
  );
  assert.equal(result.ticketLinksChanged, 1);
  assert.equal(result.roomsChanged, 1);
  assert.equal(result.notesChanged, 1);
});

test("removing picked times takes out only those, and drops a day left empty", () => {
  const data = makeData();
  const result = importShowtimesCsv(data, csv("Nickelodeon,Portland,Anora,2026-10-28,7:15 PM|9:30 PM,,,,"));
  const missing = findTimesMissingFromCsv(data, result, NOW);
  const anora = film(data, 0, "Anora");
  const bugonia = film(data, 0, "Bugonia");
  removeCsvMissingTimes([
    { film: anora, date: "2026-10-28", time: "7:00 PM", premium: false },
    { film: bugonia, date: "2026-10-28", time: "6:00 PM", premium: false },
  ]);
  assert.equal(missing.length, 2);
  assert.deepEqual(anora.showings[0].times, ["7:15 PM", "9:30 PM"]);
  assert.deepEqual(bugonia.showings[0].times, []);
  assert.deepEqual(bugonia.showings[0].premiumTimes, ["8:00 PM"]);

  removeCsvMissingTimes([{ film: bugonia, date: "2026-10-28", time: "8:00 PM", premium: true }]);
  assert.equal(bugonia.showings.length, 0);
});
