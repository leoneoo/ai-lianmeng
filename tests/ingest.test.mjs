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
  parseEditionId,
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
  assert.deepEqual(SECTIONS.map((section) => section.label), [
    "X AI 日报",
    "中文选题",
    "英文选题",
    "开源与 Agent 技术",
    "科技与数码",
    "万物互联",
  ]);
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
  assert.equal(result.edition.sections.en_topics[0].handle, undefined);
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
    assert.deepEqual(index.editions.map((entry) => entry.id), ["2026-10-21-2200", "2026-10-21-1800"]);
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

test("workflow deploys with the four Singapore slots", () => {
  const workflow = readFileSync(path.join(repoRoot, ".github/workflows/site.yml"), "utf8");
  assert.match(workflow, /0 22,4,10,14 \* \* \*/);
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
  assert.deepEqual(schema.properties.sections.required, ["x_daily", "zh_topics", "en_topics"]);
  for (const key of ["oss_agent", "tech", "iot"]) {
    assert.equal(schema.properties.sections.properties[key].$ref, "#/$defs/itemList");
    assert.equal(schema.properties.sections.required.includes(key), false);
  }
  const indexSchema = JSON.parse(readFileSync(path.join(repoRoot, "schema/index.schema.json"), "utf8"));
  const counts = indexSchema.properties.editions.items.properties.counts;
  assert.deepEqual(counts.required, ["x_daily", "zh_topics", "en_topics"]);
  for (const key of ["oss_agent", "tech", "iot"]) {
    assert.equal(counts.properties[key].type, "integer");
  }
});
