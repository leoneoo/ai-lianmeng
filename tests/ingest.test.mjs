import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  SECTIONS,
  SITE_ORIGIN,
  commitMessage,
  editionRelPath,
  groupEditions,
  nowInPlus08,
  itemFragment,
  parseEditionId,
  parseItemFragment,
  weekday,
} from "../js/format.js";
import { applyEdition, parseIssueBody, validateEdition } from "../scripts/edition.mjs";
import { isEditionIssue, isRepoOwner } from "../scripts/ingest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samplePath = path.join(repoRoot, "examples", "sample-edition.json");
const sample = JSON.parse(readFileSync(samplePath, "utf8"));

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
}

test("section names and edition id rules", () => {
  assert.deepEqual(SECTIONS.map((section) => section.key), [
    "x_daily",
    "zh_topics",
    "en_topics",
    "oss_agent",
    "tech",
    "iot",
  ]);
  assert.deepEqual(SECTIONS.filter((section) => section.nav).map((section) => section.nav), [
    "AI 日报",
    "中文博主",
    "开源与 Agent",
    "科技数码",
    "万物互联",
  ]);
  const retired = SECTIONS.find((section) => section.key === "en_topics");
  assert.equal(retired.required, false);
  assert.equal(retired.deprecated, true);
  assert.equal(retired.nav, null);
  assert.equal(SECTIONS.find((section) => section.key === "zh_topics").label, "中文博主");
  assert.equal(SECTIONS.find((section) => section.key === "x_daily").label, "AI 日报");
  assert.equal(parseEditionId("2026-10-21-2200").published_at, "2026-10-21T22:00:00+08:00");
  assert.equal(weekday("2026-10-21"), "周三");
  assert.equal(commitMessage("2026-10-21-0600"), "edition: 2026-10-21 06:00");
  assert.equal(editionRelPath("2026-10-21-2200"), "data/2026/10/2026-10-21-2200.json");
  assert.equal(parseEditionId("2026-02-29-0600"), null);
  assert.equal(parseEditionId("2026-10-21-2300"), null);
  assert.equal(editionRelPath("../secret"), null);
  assert.equal(nowInPlus08(new Date("2026-10-21T14:00:00Z")), "2026-10-21T22:00:00+08:00");
});

test("sample edition validates and is labelled as a sample", () => {
  const result = validateEdition(sample);
  assert.equal(result.ok, true, (result.errors || []).join("\n"));
  assert.match(result.edition.headline, /示例/);
  assert.equal(result.edition.sections.x_daily[0].tag, "自报");
  assert.match(result.edition.sections.x_daily[0].impact, /影响/);
  assert.deepEqual(result.edition.sections.x_daily[0].points, [
    "摄取脚本会保留影响、要点和标签",
    "没有这些字段的旧条目仍然有效",
  ]);
  assert.equal(Object.hasOwn(result.edition.sections.zh_topics[0], "impact"), false);
  assert.equal(Object.hasOwn(result.edition.sections.zh_topics[0], "points"), false);
  assert.equal(Object.hasOwn(result.edition.sections.zh_topics[0], "tag"), false);
  assert.equal(result.edition.sections.en_topics[0].handle, undefined);
  assert.equal(itemFragment("x_daily", 0), "item-x_daily-0");
  assert.deepEqual(parseItemFragment("item-en_topics-0"), { key: "en_topics", index: 0 });
  assert.equal(parseItemFragment("item-notes-0"), null);
  assert.equal(result.edition.sections.oss_agent[0].handle, "@example_oss");
  assert.equal(result.edition.sections.tech.length, 1);
  assert.equal(result.edition.sections.iot.length, 1);
});

test("published editions validate without the optional sections", () => {
  for (const name of ["2026-10-21-1800.json", "2026-10-21-2200.json"]) {
    const doc = JSON.parse(readFileSync(path.join(repoRoot, "data/2026/10", name), "utf8"));
    const result = validateEdition(doc);
    assert.equal(result.ok, true, (result.errors || []).join("\n"));
    assert.equal(Object.hasOwn(doc.sections, "oss_agent"), false);
    assert.equal(Object.hasOwn(doc.sections, "tech"), false);
    assert.equal(Object.hasOwn(doc.sections, "iot"), false);
    assert.equal(Object.hasOwn(doc.sections, "en_topics"), true);
    assert.equal(result.edition.sections.en_topics.length > 0, true);
    for (const list of Object.values(doc.sections)) {
      for (const item of list) {
        assert.equal(Object.hasOwn(item, "impact"), false);
        assert.equal(Object.hasOwn(item, "points"), false);
        assert.equal(Object.hasOwn(item, "tag"), false);
      }
    }
  }
});

test("editions without the optional sections still validate", () => {
  const legacy = structuredClone(sample);
  delete legacy.sections.oss_agent;
  delete legacy.sections.tech;
  delete legacy.sections.iot;
  const result = validateEdition(legacy);
  assert.equal(result.ok, true, (result.errors || []).join("\n"));
  assert.equal(Object.hasOwn(result.edition.sections, "oss_agent"), false);
  assert.equal(Object.hasOwn(result.edition.sections, "tech"), false);
  assert.equal(Object.hasOwn(result.edition.sections, "iot"), false);
  assert.equal(result.edition.sections.x_daily.length, 1);

  const root = mkdtempSync(path.join(tmpdir(), "ailm-legacy-"));
  try {
    const applied = applyEdition(root, legacy, new Date("2026-10-21T14:00:00Z"));
    assert.equal(applied.counts.x_daily, 1);
    assert.equal(applied.counts.oss_agent, 0);
    assert.equal(applied.counts.tech, 0);
    assert.equal(applied.counts.iot, 0);
    const written = JSON.parse(readFileSync(path.join(root, applied.path), "utf8"));
    assert.equal(Object.hasOwn(written.sections, "oss_agent"), false);
    const index = JSON.parse(readFileSync(path.join(root, "data/index.json"), "utf8"));
    assert.equal(index.editions[0].counts.tech, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  const extra = structuredClone(sample);
  extra.sections.notes = [];
  assert.equal(validateEdition(extra).ok, false);

  const withoutEnglish = structuredClone(sample);
  delete withoutEnglish.sections.en_topics;
  const dropped = validateEdition(withoutEnglish);
  assert.equal(dropped.ok, true, (dropped.errors || []).join("\n"));
  assert.equal(Object.hasOwn(dropped.edition.sections, "en_topics"), false);
  const droppedRoot = mkdtempSync(path.join(tmpdir(), "ailm-no-en-"));
  try {
    const applied = applyEdition(droppedRoot, withoutEnglish, new Date("2026-10-21T14:00:00Z"));
    assert.equal(applied.counts.en_topics, 0);
    assert.equal(applied.counts.x_daily, 1);
  } finally {
    rmSync(droppedRoot, { recursive: true, force: true });
  }
});

test("rejects malformed editions", () => {
  const mismatch = validateEdition({ ...sample, published_at: "2026-10-21T18:00:00+08:00" });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.errors.join("\n"), /published_at/);

  const http = structuredClone(sample);
  http.sections.x_daily[0].source_url = "http://example.com/a";
  assert.equal(validateEdition(http).ok, false);

  const handle = structuredClone(sample);
  handle.sections.x_daily[0].handle = "AnthropicAI";
  assert.equal(validateEdition(handle).ok, false);

  const badPoints = structuredClone(sample);
  badPoints.sections.x_daily[0].points = "不是数组";
  assert.equal(validateEdition(badPoints).ok, false);

  const emptyTag = structuredClone(sample);
  emptyTag.sections.zh_topics[0].tag = "";
  assert.equal(validateEdition(emptyTag).ok, false);

  const bare = structuredClone(sample);
  delete bare.sections.x_daily[0].impact;
  delete bare.sections.x_daily[0].points;
  delete bare.sections.x_daily[0].tag;
  const bareResult = validateEdition(bare);
  assert.equal(bareResult.ok, true, (bareResult.errors || []).join("\n"));
  assert.equal(Object.hasOwn(bareResult.edition.sections.x_daily[0], "impact"), false);

  const extra = { ...sample, note: "nope" };
  assert.equal(validateEdition(extra).ok, false);

  const clock = structuredClone(sample);
  clock.sections.x_daily[0].time = "2026-10-21T21:12:00Z";
  assert.equal(validateEdition(clock).ok, false);
});

test("issue body parser reads the json fence", () => {
  const body = `说明文字\n\n\`\`\`json\n${JSON.stringify(sample)}\n\`\`\`\n谢谢`;
  const parsed = parseIssueBody(body);
  assert.equal(validateEdition(parsed).ok, true);
  assert.throws(() => parseIssueBody("没有代码块"), /json 代码块/);
});

test("owner filter ignores other authors", () => {
  const edition = { title: "[edition] 2026-10-21 22:00", user: { login: "Leoneoo", type: "User" }, labels: [] };
  const labeled = { title: "请看", user: { login: "leoneoo", type: "User" }, labels: [{ name: "edition" }] };
  const stranger = { title: "[edition] hi", user: { login: "someone", type: "User" }, labels: [{ name: "edition" }] };
  const bot = { title: "[edition] hi", user: { login: "leoneoo", type: "Bot" }, labels: [] };
  assert.equal(isEditionIssue(edition), true);
  assert.equal(isEditionIssue(labeled), true);
  assert.equal(isEditionIssue({ title: "你好", labels: [] }), false);
  assert.equal(isRepoOwner(edition, "leoneoo"), true);
  assert.equal(isRepoOwner(stranger, "leoneoo"), false);
  assert.equal(isRepoOwner(bot, "leoneoo"), false);
});

test("applyEdition writes archive order and treats identical input as unchanged", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ailm-apply-"));
  try {
    const older = structuredClone(sample);
    older.id = "2026-10-21-1800";
    older.published_at = "2026-10-21T18:00:00+08:00";
    older.headline = "【示例】较早";
    const first = applyEdition(root, older, new Date("2026-10-21T10:00:00Z"));
    const second = applyEdition(root, sample, new Date("2026-10-21T14:05:00Z"));
    assert.equal(first.status, "created");
    assert.equal(second.path, "data/2026/10/2026-10-21-2200.json");
    const index = JSON.parse(readFileSync(path.join(root, "data", "index.json"), "utf8"));
    assert.deepEqual(index.editions.map((entry) => entry.id), ["2026-10-21-2200", "2026-10-21-1800"]);
    assert.equal(index.editions[0].counts.x_daily, 1);
    assert.equal(index.editions[0].counts.en_topics, 1);
    assert.equal(index.editions[0].counts.oss_agent, 1);
    assert.equal(index.editions[0].counts.tech, 1);
    assert.equal(index.editions[0].counts.iot, 1);
    assert.equal(index.updated_at, "2026-10-21T22:05:00+08:00");
    const again = applyEdition(root, sample, new Date("2026-10-21T16:00:00Z"));
    assert.equal(again.status, "unchanged");
    assert.deepEqual(again.files, []);
    const grouped = groupEditions(index.editions);
    assert.equal(grouped[0].days[0].slots.map((slot) => slot.parsed.timeLabel).join(","), "18:00,22:00");
    assert.throws(() => applyEdition(root, { id: "nope" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ingestion script writes the sample outside the repo", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ailm-cli-"));
  const bodyFile = path.join(root, "issue.md");
  writeFileSync(bodyFile, ["请收录这期示例。", "", "```json", readFileSync(samplePath, "utf8").trim(), "```", ""].join("\n"));
  const before = readFileSync(path.join(repoRoot, "data/index.json"), "utf8");
  try {
    const result = runNode(["scripts/ingest.mjs", "--body-file", bodyFile, "--root", root]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const written = JSON.parse(readFileSync(path.join(root, "data/2026/10/2026-10-21-2200.json"), "utf8"));
    assert.match(written.headline, /示例/);
    const index = JSON.parse(readFileSync(path.join(root, "data/index.json"), "utf8"));
    assert.equal(index.editions.length, 1);
    const published = readFileSync(path.join(repoRoot, "data/index.json"), "utf8");
    assert.equal(published, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ingestion script commits one edition with the archive message", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ailm-git-"));
  try {
    execFileSync("git", ["init", "-b", "main"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    const first = runNode([
      "scripts/ingest.mjs",
      "--file",
      samplePath,
      "--root",
      root,
      "--commit",
    ]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const subject = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(subject, "edition: 2026-10-21 22:00");
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), "");
    const second = runNode(["scripts/ingest.mjs", "--file", samplePath, "--root", root, "--commit"]);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const count = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(count, "1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid file does not create an edition", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ailm-bad-"));
  const file = path.join(root, "bad.json");
  writeFileSync(file, "{}\n");
  try {
    const result = runNode(["scripts/ingest.mjs", "--file", file, "--root", root]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /id/);
    assert.equal(existsSync(path.join(root, "data")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("build publishes the site without the sample", () => {
  const out = mkdtempSync(path.join(tmpdir(), "ailm-site-"));
  try {
    const result = runNode(["scripts/build.mjs", "--out", out]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(path.join(out, "index.html")), true);
    assert.equal(existsSync(path.join(out, "css/site.css")), true);
    assert.equal(existsSync(path.join(out, "js/site.js")), true);
    assert.equal(existsSync(path.join(out, "examples")), false);
    assert.equal(existsSync(path.join(out, "data/2026/10/2026-10-21-2200.json")), true);
    const index = JSON.parse(readFileSync(path.join(out, "data/index.json"), "utf8"));
    const sourceIndex = JSON.parse(readFileSync(path.join(repoRoot, "data/index.json"), "utf8"));
    const ids = index.editions.map((entry) => entry.id);
    assert.deepEqual(ids, sourceIndex.editions.map((entry) => entry.id));
    assert.deepEqual(ids, [...ids].sort().reverse());
    assert.deepEqual(ids.slice(-2), ["2026-10-21-2200", "2026-10-21-1800"]);
    assert.equal(index.editions.some((entry) => /示例/.test(entry.headline || "")), false);
    for (const entry of index.editions) {
      assert.equal(existsSync(path.join(out, entry.path)), true, entry.path);
    }
    const html = readFileSync(path.join(out, "index.html"), "utf8");
    assert.match(html, /AI联盟/);
    assert.match(html, /免费中文 AI 新闻站/);
    assert.doesNotMatch(html, /【示例】/);
    const sitemap = readFileSync(path.join(out, "sitemap.xml"), "utf8");
    assert.match(sitemap, new RegExp(SITE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("workflow deploys with the two Beijing slots", () => {
  const workflow = readFileSync(path.join(repoRoot, ".github/workflows/site.yml"), "utf8");
  const crons = [...workflow.matchAll(/- cron: "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(crons, ["0 22,10 * * *"]);
  assert.match(workflow, /types: \[opened, edited, reopened\]/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /actions\/configure-pages@v6/);
  assert.match(workflow, /actions\/upload-pages-artifact@v5/);
  assert.match(workflow, /actions\/deploy-pages@v5/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /cancel-in-progress: false|cancel-in-progress: \$\{/);
});

test("README example matches the schema", () => {
  const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
  assert.match(readme, new RegExp(SITE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const parsed = parseIssueBody(readme);
  const result = validateEdition(parsed);
  assert.equal(result.ok, true, (result.errors || []).join("\n"));
  assert.match(result.edition.headline, /示例/);
  const schema = JSON.parse(readFileSync(path.join(repoRoot, "schema/edition.schema.json"), "utf8"));
  assert.deepEqual(schema.properties.sections.required, ["x_daily", "zh_topics"]);
  for (const key of ["oss_agent", "tech", "iot", "en_topics"]) {
    assert.equal(schema.properties.sections.properties[key].$ref, "#/$defs/itemList");
    assert.equal(schema.properties.sections.required.includes(key), false);
  }
  assert.equal(schema.properties.sections.properties.en_topics.deprecated, true);
  const itemSchema = schema.$defs.item;
  assert.equal(itemSchema.required.includes("impact"), false);
  assert.equal(itemSchema.required.includes("points"), false);
  assert.equal(itemSchema.required.includes("tag"), false);
  assert.equal(itemSchema.properties.impact.type, "string");
  assert.equal(itemSchema.properties.points.type, "array");
  assert.equal(itemSchema.properties.tag.maxLength, 16);
  const indexSchema = JSON.parse(readFileSync(path.join(repoRoot, "schema/index.schema.json"), "utf8"));
  const counts = indexSchema.properties.editions.items.properties.counts;
  assert.deepEqual(counts.required, ["x_daily", "zh_topics"]);
  for (const key of ["oss_agent", "tech", "iot", "en_topics"]) {
    assert.equal(counts.properties[key].type, "integer");
    assert.equal(counts.required.includes(key), false);
  }
  assert.equal(counts.properties.en_topics.deprecated, true);
});
