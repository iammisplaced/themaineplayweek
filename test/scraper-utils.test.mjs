import assert from "node:assert/strict";
import { test } from "node:test";
import { addMeridiems } from "../scripts/lib/scraper-utils.mjs";

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
