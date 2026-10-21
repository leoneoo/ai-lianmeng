import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SECTIONS, commitMessage, parseEditionId } from "../js/format.js";
import { applyEdition, parseIssueBody, validateEdition } from "./edition.mjs";

const MAX_PER_RUN = 20;

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

export function isEditionIssue(issue) {
  const title = issue?.title || "";
  const labeled = (issue?.labels || []).some((label) => {
    const name = typeof label === "string" ? label : label?.name;
    return name === "edition";
  });
  return /^\s*\[edition\]/i.test(title) || labeled;
}

export function isRepoOwner(issue, owner) {
  const login = issue?.user?.login || "";
  return issue?.user?.type === "User" && login.toLowerCase() === String(owner || "").toLowerCase();
}

function parseArgs(argv) {
  const args = {
    commit: false,
    push: false,
    fromGithub: false,
    file: null,
    bodyFile: null,
    root: process.cwd(),
    help: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--commit") args.commit = true;
    else if (arg === "--push") args.push = true;
    else if (arg === "--from-github") args.fromGithub = true;
    else if (arg === "--file") args.file = argv[++index];
    else if (arg === "--body-file") args.bodyFile = argv[++index];
    else if (arg === "--root") args.root = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`未知参数 ${arg}`);
  }
  if (args.file === undefined || args.bodyFile === undefined || args.root === undefined) {
    throw new Error("参数缺少取值");
  }
  return args;
}

function helpText() {
  return [
    "用法：",
    "  node scripts/ingest.mjs --file examples/sample-edition.json --root <目录>",
    "  node scripts/ingest.mjs --body-file issue.md --root <目录>",
    "  node scripts/ingest.mjs --from-github --commit --push",
    "",
    "只处理仓库所有者名下、标题以 [edition] 开头或带 edition 标签的未关闭 Issue。",
  ].join("\n");
}

function git(root, args, { inherit = false } = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

function commitFiles(root, files, message) {
  git(root, ["config", "core.autocrlf", "false"]);
  git(root, ["add", "--", ...files], { inherit: true });
  const staged = git(root, ["diff", "--cached", "--name-only"]).trim();
  if (!staged) return null;
  git(root, ["-c", "commit.gpgsign=false", "commit", "-m", message], { inherit: true });
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function pushMain(root) {
  git(root, ["push", "origin", "HEAD:main"], { inherit: true });
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, `${key}=${String(value).replace(/\n/g, "")}\n`);
}

function writeSummary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, `${lines.join("\n")}\n`);
}

async function gh(token, method, apiPath, body) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "ai-lianmeng-ingest",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && data.message ? data.message : response.statusText;
    throw new Error(`GitHub API ${method} ${apiPath} 失败：${response.status} ${message}`);
  }
  return { data, headers: response.headers };
}

async function listOpenIssues(token, owner, repo) {
  const issues = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, headers } = await gh(
      token,
      "GET",
      `/repos/${owner}/${repo}/issues?state=open&per_page=100&page=${page}`,
    );
    if (!Array.isArray(data) || data.length === 0) break;
    issues.push(...data);
    if (!(headers.get("link") || "").includes('rel="next"')) break;
  }
  return issues;
}

async function listComments(token, owner, repo, number) {
  const comments = [];
  for (let page = 1; page <= 3; page += 1) {
    const { data, headers } = await gh(
      token,
      "GET",
      `/repos/${owner}/${repo}/issues/${number}/comments?per_page=100&page=${page}`,
    );
    if (!Array.isArray(data) || data.length === 0) break;
    comments.push(...data);
    if (!(headers.get("link") || "").includes('rel="next"')) break;
  }
  return comments;
}

function markerFor(text) {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return `<!-- ailm:${hash} -->`;
}

function slotLabel(id) {
  const parsed = parseEditionId(id);
  return parsed ? `${parsed.date} ${parsed.timeLabel}` : id;
}

function successComment(result) {
  const parts = SECTIONS.filter((section) => section.nav).map((section) => `${section.label} ${result.counts?.[section.key] || 0}`);
  const folded = result.counts?.en_topics || 0;
  if (folded) parts.push(`英文选题已并入 AI 日报 ${folded}`);
  const countLine = parts.join(" · ");
  if (result.status === "unchanged") {
    return [
      "本期与已归档内容相同，没有新的提交。本 Issue 已关闭。",
      "",
      `- 期号：${slotLabel(result.id)}`,
      `- 文件：\`${result.path}\``,
    ].join("\n");
  }
  const verb = result.status === "updated" ? "已更新本期归档。" : "已收录本期。";
  return [
    verb,
    "",
    `- 期号：${slotLabel(result.id)}`,
    `- 文件：\`${result.path}\``,
    `- 条目：${countLine}`,
    `- 提交：\`${result.message || commitMessage(result.id)}\``,
    "",
    "站点会在同一次工作流里部署到 GitHub Pages。",
  ].join("\n");
}

function invalidComment(errors) {
  return [
    "本期 JSON 未通过校验，Issue 保持打开。请直接修改正文里的 json 代码块后保存，工作流会再次检查。",
    "",
    ...errors.slice(0, 30).map((error) => `- ${error}`),
  ].join("\n");
}

async function postResult(token, owner, repo, result) {
  const marker = markerFor(result.comment);
  const full = `${result.comment}\n\n${marker}`;
  const comments = await listComments(token, owner, repo, result.issue);
  if (!comments.some((comment) => (comment.body || "").includes(marker))) {
    await gh(token, "POST", `/repos/${owner}/${repo}/issues/${result.issue}/comments`, { body: full });
  }
  if (result.close) {
    await gh(token, "PATCH", `/repos/${owner}/${repo}/issues/${result.issue}`, {
      state: "closed",
      state_reason: "completed",
    });
  }
}

function applyOne(root, edition) {
  return applyEdition(root, edition);
}

function ingestDocument(root, input) {
  const validated = validateEdition(input);
  if (!validated.ok) {
    const error = new Error(validated.errors.join("\n"));
    error.errors = validated.errors;
    throw error;
  }
  return applyOne(root, validated.edition);
}

async function ingestLocal(args) {
  const root = path.resolve(args.root);
  let input;
  if (args.file) input = JSON.parse(readFileSync(args.file, "utf8"));
  else input = parseIssueBody(readFileSync(args.bodyFile, "utf8"));
  const applied = ingestDocument(root, input);
  console.log(`${applied.status} ${applied.path}`);
  if (args.commit && applied.status !== "unchanged") {
    const sha = commitFiles(root, applied.files, applied.message);
    if (!sha) throw new Error(`未能提交 ${applied.path}`);
    console.log(applied.message);
    console.log(sha);
  } else if (applied.message) {
    console.log(applied.message);
  }
  if (args.push) pushMain(root);
}

async function ingestFromGithub(args) {
  const token = process.env.GITHUB_TOKEN || "";
  const repository = process.env.GITHUB_REPOSITORY || "";
  const [owner, repo] = repository.split("/");
  if (!token || !owner || !repo) throw new Error("缺少 GITHUB_TOKEN 或 GITHUB_REPOSITORY");
  const root = path.resolve(args.root);
  const issues = await listOpenIssues(token, owner, repo);
  const summary = ["# 期刊收录", ""];
  const comments = [];
  const valid = [];

  for (const issue of issues) {
    if (issue.pull_request || !isEditionIssue(issue)) continue;
    if (issue.locked) {
      summary.push(`- #${issue.number} 已锁定，跳过`);
      continue;
    }
    if (!isRepoOwner(issue, owner)) {
      console.log(`跳过 #${issue.number}：作者不是仓库所有者`);
      summary.push(`- #${issue.number} 作者不是仓库所有者，已忽略`);
      continue;
    }
    let input;
    try {
      input = parseIssueBody(issue.body || "");
    } catch (error) {
      comments.push({
        issue: issue.number,
        close: false,
        comment: invalidComment([error.message]),
      });
      summary.push(`- #${issue.number} 无效：${error.message}`);
      continue;
    }
    const validated = validateEdition(input);
    if (!validated.ok) {
      comments.push({
        issue: issue.number,
        close: false,
        comment: invalidComment(validated.errors),
      });
      summary.push(`- #${issue.number} 无效：${validated.errors[0]}`);
      continue;
    }
    valid.push({ issue, edition: validated.edition });
  }

  valid.sort((a, b) => a.edition.published_at.localeCompare(b.edition.published_at) || a.issue.number - b.issue.number);
  const batch = valid.slice(0, MAX_PER_RUN);
  if (valid.length > batch.length) {
    summary.push(`- 另有 ${valid.length - batch.length} 期留到下次运行`);
  }

  let changed = false;
  for (const item of batch) {
    const applied = applyOne(root, item.edition);
    if (applied.status !== "unchanged" && !args.commit) {
      throw new Error("缺少 --commit，拒绝在未提交的情况下关闭 Issue");
    }
    if (args.commit && applied.status !== "unchanged") {
      const sha = commitFiles(root, applied.files, applied.message);
      if (!sha) throw new Error(`未能提交 ${applied.path}`);
      changed = true;
      console.log(`${applied.message} ${sha}`);
    }
    comments.push({
      issue: item.issue.number,
      close: true,
      comment: successComment(applied),
    });
    summary.push(`- #${item.issue.number} ${applied.status} ${applied.path}`);
  }

  if (args.push && changed) pushMain(root);

  let sha = "";
  try {
    sha = git(root, ["rev-parse", "HEAD"]).trim();
  } catch {
    sha = "";
  }
  setOutput("changed", changed ? "true" : "false");
  setOutput("sha", sha);

  let commentErrors = 0;
  for (const result of comments) {
    try {
      await postResult(token, owner, repo, result);
    } catch (error) {
      commentErrors += 1;
      console.error(`评论或关闭 #${result.issue} 失败：${error.message}`);
      summary.push(`- #${result.issue} 评论或关闭失败`);
    }
  }
  if (!summary.some((line) => line.startsWith("- "))) summary.push("没有待处理的期刊 Issue。");
  writeSummary(summary);
  if (commentErrors && !changed) {
    throw new Error(`${commentErrors} 条 Issue 未能评论或关闭`);
  }
  if (commentErrors) console.error(`${commentErrors} 条 Issue 未能评论或关闭，下次运行会重试`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(helpText());
    return;
  }
  if (args.fromGithub && (args.file || args.bodyFile)) throw new Error("--from-github 不能同时指定本地文件");
  if (!args.fromGithub && !args.file && !args.bodyFile) {
    console.log(helpText());
    throw new Error("请指定 --file、--body-file 或 --from-github");
  }
  if (args.file && args.bodyFile) throw new Error("--file 与 --body-file 只能选一个");
  if (args.fromGithub) await ingestFromGithub(args);
  else await ingestLocal(args);
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
