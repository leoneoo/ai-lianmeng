import assert from "node:assert/strict";
import { test } from "node:test";
import { formatZhTime, heroMetaTimes, sectionStampIso } from "../js/format.js";

test("hero meta prefers edition out-time; section stamp uses edition", () => {
  const edition = { published_at: "2026-10-30T06:00:00+08:00" };
  const item = { time: "2026-10-29T22:21:24+08:00" };
  assert.deepEqual(heroMetaTimes(edition, item), {
    out: "2026-10-30T06:00:00+08:00",
    posted: "2026-10-29T22:21:24+08:00",
  });
  assert.deepEqual(heroMetaTimes(edition, null), {
    out: "2026-10-30T06:00:00+08:00",
    posted: "",
  });
  assert.equal(sectionStampIso(edition), "2026-10-30T06:00:00+08:00");
  assert.equal(sectionStampIso({}), "");
  assert.equal(formatZhTime(edition.published_at), "10月30日 06:00");
  assert.equal(formatZhTime(item.time), "10月29日 22:21");
});
