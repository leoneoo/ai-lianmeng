import assert from "node:assert/strict";
import { test } from "node:test";
import { formatZhTime, heroMetaTimes, sectionStampIso } from "../js/format.js";

test("header uses edition out-time; item time is separate posted stamp", () => {
  const edition = { published_at: "2026-10-30T06:00:00+08:00" };
  const item = { time: "2026-10-29T22:21:24+08:00" };
  assert.deepEqual(heroMetaTimes(edition, item), {
    out: "2026-10-30T06:00:00+08:00",
    posted: "2026-10-29T22:21:24+08:00",
  });
  assert.equal(formatZhTime(heroMetaTimes(edition, item).out), "10月30日 06:00");
  assert.equal(formatZhTime(item.time), "10月29日 22:21");
  assert.notEqual(formatZhTime(edition.published_at), "06:00");
  assert.equal(sectionStampIso(edition), "2026-10-30T06:00:00+08:00");
  assert.equal(sectionStampIso({}), "");
});
