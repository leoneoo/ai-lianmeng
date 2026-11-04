import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const banned = [/内容整理自/, /公开帖子/, /skyfeed\.clouds\.wiki/i];
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === ".git" || n === "node_modules" || n === "tests") continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(html|js|mjs|json|webmanifest|md|css)$/.test(n)) out.push(p);
  }
  return out;
}
test("no X public-posts attribution text in site sources/templates/data", () => {
  for (const f of walk(root)) {
    const s = readFileSync(f, "utf8");
    for (const re of banned) assert.ok(!re.test(s), `${f} contains ${re}`);
  }
});
