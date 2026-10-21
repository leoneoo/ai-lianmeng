import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SITE_ORIGIN } from "../js/format.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FILES = [
  "index.html",
  "archive.html",
  "edition.html",
  "404.html",
  "robots.txt",
  "favicon.svg",
  "site.webmanifest",
  "css/site.css",
  "js/format.js",
  "js/site.js",
  "schema/edition.schema.json",
  "schema/index.schema.json",
];

function parseArgs(argv) {
  let out = path.join(ROOT, "_site");
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--out") out = path.resolve(argv[++index]);
    else throw new Error(`未知参数 ${argv[index]}`);
  }
  if (!out) throw new Error("--out 需要路径");
  return { out };
}

function assertSafeOut(out) {
  const resolved = path.resolve(out);
  if (resolved === path.parse(resolved).root) throw new Error("拒绝输出到文件系统根目录");
  const site = path.join(ROOT, "_site");
  const insideRepo = resolved === ROOT || resolved.startsWith(`${ROOT}${path.sep}`);
  if (insideRepo && resolved !== site && !resolved.startsWith(`${site}${path.sep}`)) {
    throw new Error("仓库内的输出目录只能是 _site");
  }
}

function copyFile(rel, out) {
  const dest = path.join(out, rel);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(path.join(ROOT, rel), dest);
}

function copyJsonTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name.startsWith(".")) continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (statSync(from).isDirectory()) copyJsonTree(from, to);
    else if (name.endsWith(".json")) cpSync(from, to);
  }
}

function xml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function writeSitemap(out) {
  const index = JSON.parse(readFileSync(path.join(out, "data", "index.json"), "utf8"));
  const newest = index.editions?.[0]?.published_at?.slice(0, 10) || "";
  const urls = [
    { loc: SITE_ORIGIN, lastmod: newest },
    { loc: `${SITE_ORIGIN}archive.html`, lastmod: newest },
  ];
  for (const edition of index.editions || []) {
    if (!edition?.id) continue;
    urls.push({
      loc: `${SITE_ORIGIN}edition.html?id=${encodeURIComponent(edition.id)}`,
      lastmod: typeof edition.published_at === "string" ? edition.published_at.slice(0, 10) : "",
    });
  }
  const body = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls.map((url) => {
      const lastmod = url.lastmod ? `<lastmod>${xml(url.lastmod)}</lastmod>` : "";
      return `  <url><loc>${xml(url.loc)}</loc>${lastmod}</url>`;
    }),
    `</urlset>`,
    ``,
  ].join("\n");
  writeFileSync(path.join(out, "sitemap.xml"), body);
}

function build(out) {
  assertSafeOut(out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const file of FILES) copyFile(file, out);
  copyJsonTree(path.join(ROOT, "data"), path.join(out, "data"));
  writeSitemap(out);
  return out;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  try {
    const { out } = parseArgs(process.argv);
    build(out);
    console.log(out);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

export { build, FILES };
