import assert from "node:assert/strict";
import { test } from "node:test";
import { addMeridiems, formatShowtimesCsv } from "../scripts/lib/scraper-utils.mjs";

test("noon through 8:59 are PM", () => {
  assert.deepEqual(addMeridiems(["12:45", "4:00", "7:15"]), ["12:45 PM", "4:00 PM", "7:15 PM"]);
});

test("9:00 through 11:59 are AM before an afternoon time and PM after one", () => {
  assert.deepEqual(addMeridiems(["10:00", "11:30", "1:00"]), ["10:00 AM", "11:30 AM", "1:00 PM"]);
  assert.deepEqual(addMeridiems(["6:45", "9:30"]), ["6:45 PM", "9:30 PM"]);
});

test("times that can't be told apart come back null", () => {
  assert.deepEqual(addMeridiems(["10:00"]), [null]);
  assert.deepEqual(addMeridiems(["10:00", "11:30"]), [null, null]);
  assert.deepEqual(addMeridiems(["soon", "7:00"]), [null, "7:00 PM"]);
});

test("formatShowtimesCsv puts each showing's note on its own time", () => {
  const csv = formatShowtimesCsv([
    { title: 'Film', date: '2026-11-10', time: '1:55 PM', note: 'Open Captions' },
    { title: 'Film', date: '2026-11-10', time: '5:20 PM' },
    { title: 'Film', date: '2026-11-10', time: '7:00 PM', premium: 'IMAX', note: 'Open Captions' },
  ], 'Theatre', 'Town');
  const row = csv.split('\n')[1];
  assert.equal(row, 'Theatre,Town,Film,2026-11-10,1:55 PM|5:20 PM,7:00 PM,,7:00 PM: IMAX; 1:55 PM: Open Captions; 7:00 PM: Open Captions,,,,');
});
