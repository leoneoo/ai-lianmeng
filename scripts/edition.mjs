import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  SECTIONS,
  commitMessage,
  editionRelPath,
  isOffsetTimestamp,
  nowInPlus08,
  parseEditionId,
} from "../js/format.js";

const SECTION_KEYS = SECTIONS.map((section) => section.key);
const EDITION_KEYS = new Set(["id", "published_at", "headline", "sections"]);
const ITEM_KEYS = new Set(["title", "summary", "source_url", "time", "handle"]);
const MAX_ERRORS = 50;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pushError(errors, message) {
  if (errors.length < MAX_ERRORS) errors.push(message);
}

function hasControlChar(value) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
}

function readLine(value, label, errors, max) {
  if (typeof value !== "string") {
    pushError(errors, `${label} 必须是字符串`);
    return null;
  }
  const text = value.trim();
  if (!text || text.length > max || /[\r\n]/.test(text) || hasControlChar(text)) {
    pushError(errors, `${label} 必须是 1 到 ${max} 个字符的单行文本`);
    return null;
  }
  return text;
}

function readSummary(value, label, errors) {
  if (typeof value !== "string") {
    pushError(errors, `${label} 必须是字符串`);
    return null;
  }
  const text = value.trim();
  if (!text || text.length > 2000 || hasControlChar(text)) {
    pushError(errors, `${label} 必须是 1 到 2000 个字符`);
    return null;
  }
  return text;
}

function readUrl(value, label, errors) {
  if (typeof value !== "string") {
    pushError(errors, `${label} 必须是 https 链接`);
    return null;
  }
  const text = value.trim();
  let url = null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== "https:" || url.username || url.password || text.length > 2000) {
    pushError(errors, `${label} 必须是 https 链接，且不能包含账号或密码`);
    return null;
  }
  return text;
}

function normalizeItem(item, label, errors) {
  if (!isObject(item)) {
    pushError(errors, `${label} 必须是对象`);
    return null;
  }
  for (const key of Object.keys(item)) {
    if (!ITEM_KEYS.has(key)) pushError(errors, `${label} 不允许的字段 ${key}`);
  }
  const title = readLine(item.title, `${label}.title`, errors, 200);
  const summary = readSummary(item.summary, `${label}.summary`, errors);
  const sourceUrl = readUrl(item.source_url, `${label}.source_url`, errors);
  let time = null;
  if (typeof item.time !== "string" || !isOffsetTimestamp(item.time.trim())) {
    pushError(errors, `${label}.time 必须是带 +08:00 的 ISO 8601，例如 2026-10-21T21:30:00+08:00`);
  } else {
    time = item.time.trim();
  }
  let handle;
  if (Object.prototype.hasOwnProperty.call(item, "handle")) {
    if (typeof item.handle !== "string" || !/^@[A-Za-z0-9_]{1,15}$/.test(item.handle.trim())) {
      pushError(errors, `${label}.handle 必须形如 @name（1 到 15 位字母、数字或下划线），不需要时请省略`);
    } else {
      handle = item.handle.trim();
    }
  }
  if (!title || !summary || !sourceUrl || !time) return null;
  const normalized = { title, summary, source_url: sourceUrl, time };
  if (handle) normalized.handle = handle;
  return normalized;
}

export function validateEdition(input) {
  const errors = [];
  if (!isObject(input)) return { ok: false, errors: ["根节点必须是 JSON 对象"] };

  for (const key of Object.keys(input)) {
    if (!EDITION_KEYS.has(key)) pushError(errors, `不允许的字段 ${key}`);
  }

  const parsed = typeof input.id === "string" ? parseEditionId(input.id.trim()) : null;
  if (typeof input.id !== "string" || !input.id.trim()) pushError(errors, "缺少 id");
  else if (!parsed) {
    pushError(errors, "id 必须形如 2026-10-21-2200，日期必须真实，时段只能是 0600、1200、1800 或 2200");
  }

  if (typeof input.published_at !== "string") pushError(errors, "缺少 published_at");
  else if (!parsed || input.published_at.trim() !== parsed.published_at) {
    pushError(errors, `published_at 必须与 id 一致并使用 +08:00${parsed ? `，应为 ${parsed.published_at}` : ""}`);
  }

  let headline;
  if (Object.prototype.hasOwnProperty.call(input, "headline")) {
    headline = readLine(input.headline, "headline", errors, 120);
  }

  const sections = {};
  if (!isObject(input.sections)) {
    pushError(errors, "缺少 sections，且必须包含 x_daily、zh_topics");
  } else {
    for (const key of Object.keys(input.sections)) {
      if (!SECTION_KEYS.includes(key)) pushError(errors, `sections 不允许的字段 ${key}`);
    }
    for (const section of SECTIONS) {
      const key = section.key;
      const label = `sections.${key}`;
      const present = Object.prototype.hasOwnProperty.call(input.sections, key);
      if (!present) {
        if (section.required) {
          pushError(errors, `缺少 ${label}`);
          sections[key] = [];
        }
        continue;
      }
      const list = input.sections[key];
      if (!Array.isArray(list)) {
        pushError(errors, `${label} 必须是数组`);
        sections[key] = [];
        continue;
      }
      if (list.length > 40) pushError(errors, `${label} 最多 40 条`);
      sections[key] = [];
      for (let index = 0; index < Math.min(list.length, 40); index += 1) {
        const item = normalizeItem(list[index], `${label}[${index}]`, errors);
        if (item) sections[key].push(item);
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  const edition = {
    id: parsed.id,
    published_at: parsed.published_at,
  };
  if (headline) edition.headline = headline;
  edition.sections = sections;
  return { ok: true, errors: [], edition };
}

export function parseIssueBody(body) {
  if (typeof body !== "string" || !body.trim()) throw new Error("正文中没有 ```json 代码块");
  if (body.length > 200_000) throw new Error("Issue 正文过长");
  const match = body.match(/```[ \t]*json[ \t]*\r?\n([\s\S]*?)```/i);
  if (!match) throw new Error("正文中没有 ```json 代码块");
  const text = match[1].replace(/^\uFEFF/, "").trim();
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法解析";
    throw new Error(`JSON 无法解析：${message.replace(/`/g, "'").split("\n")[0].slice(0, 180)}`);
  }
}

function resolveData(root, rel) {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, rel);
  const dataRoot = path.join(rootAbs, "data");
  if (abs !== dataRoot && !abs.startsWith(dataRoot + path.sep)) {
    throw new Error("拒绝写入 data 目录之外的路径");
  }
  return abs;
}

export function readIndex(root) {
  const indexPath = path.join(root, "data", "index.json");
  if (!existsSync(indexPath)) {
    return { schema_version: 1, updated_at: null, editions: [] };
  }
  let json;
  try {
    json = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    throw new Error("data/index.json 无法解析，已停止写入以免覆盖归档");
  }
  if (!json || typeof json !== "object" || !Array.isArray(json.editions)) {
    throw new Error("data/index.json 缺少 editions 数组，已停止写入以免覆盖归档");
  }
  return json;
}

function countsFor(edition) {
  const counts = {};
  for (const section of SECTIONS) {
    counts[section.key] = edition.sections[section.key]?.length || 0;
  }
  return counts;
}

function indexEntry(edition, rel) {
  const entry = {
    id: edition.id,
    published_at: edition.published_at,
    path: rel,
    counts: countsFor(edition),
  };
  if (edition.headline) entry.headline = edition.headline;
  return entry;
}

function sameEntry(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function applyEdition(root, edition, now = new Date()) {
  const validated = validateEdition(edition);
  if (!validated.ok) throw new Error(validated.errors.join("\n"));
  const normalized = validated.edition;
  const rel = editionRelPath(normalized.id);
  if (!rel) throw new Error("无效期号");
  const filePath = resolveData(root, rel);
  const indexPath = resolveData(root, "data/index.json");
  const nextText = `${JSON.stringify(normalized, null, 2)}\n`;
  const existed = existsSync(filePath);
  const sameFile = existed && readFileSync(filePath, "utf8") === nextText;
  const index = readIndex(root);
  const entry = indexEntry(normalized, rel);
  const previous = index.editions.find((item) => item && item.id === normalized.id);
  if (sameFile && previous && sameEntry(previous, entry)) {
    return {
      status: "unchanged",
      id: normalized.id,
      path: rel,
      files: [],
      message: commitMessage(normalized.id),
      counts: entry.counts,
    };
  }

  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, nextText);
  const editions = index.editions.filter((item) => item && item.id !== normalized.id);
  editions.push(entry);
  editions.sort((a, b) => {
    const left = typeof a.published_at === "string" ? a.published_at : "";
    const right = typeof b.published_at === "string" ? b.published_at : "";
    if (left !== right) return right.localeCompare(left);
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
  const nextIndex = {
    schema_version: 1,
    updated_at: nowInPlus08(now),
    editions,
  };
  mkdirSync(path.dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);
  return {
    status: existed ? "updated" : "created",
    id: normalized.id,
    path: rel,
    files: [rel, "data/index.json"],
    message: commitMessage(normalized.id),
    counts: entry.counts,
  };
}
