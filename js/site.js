import {
  SECTIONS,
  SITE_ORIGIN,
  formatZhTime,
  groupEditions,
  isSafeDataPath,
  parseEditionId,
  totalCount,
} from "./format.js";

const INDEX_URL = new URL("data/index.json", document.baseURI);

function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

function text(value) {
  return document.createTextNode(value);
}

function clear(node) {
  node.replaceChildren();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function setStatus(message) {
  const status = document.querySelector("#status");
  if (!status) return;
  status.textContent = message || "";
  status.hidden = !message;
}

function setCanonical(url) {
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.append(link);
  }
  link.href = url;
}

function externalAnchor(href, className, label) {
  return h("a", {
    class: className,
    href,
    rel: "noopener noreferrer",
    target: "_blank",
    referrerpolicy: "no-referrer",
  }, [text(label)]);
}

function renderItem(item) {
  const meta = [h("time", { datetime: item.time || "" }, [text(formatZhTime(item.time))])];
  if (item.handle) {
    const handle = String(item.handle);
    if (/^@[A-Za-z0-9_]{1,15}$/.test(handle)) {
      meta.push(externalAnchor(`https://x.com/${handle.slice(1)}`, "handle", handle));
    } else {
      meta.push(h("span", { class: "handle" }, [text(handle)]));
    }
  }
  const children = [
    h("div", { class: "item-meta" }, meta),
    h("h3", {}, [text(item.title || "未命名")]),
    h("p", { class: "summary" }, [text(item.summary || "")]),
  ];
  if (isHttpsUrl(item.source_url)) children.push(externalAnchor(item.source_url, "source", "原文"));
  return h("article", { class: "item" }, children);
}

function renderPanels(edition) {
  return h("div", { class: "columns" }, SECTIONS.map((section, index) => {
    const items = Array.isArray(edition.sections?.[section.key]) ? edition.sections[section.key] : [];
    const body = items.length
      ? items.map(renderItem)
      : [h("p", { class: "empty-section" }, [text("本期暂无")])];
    return h("section", {
      class: index === 0 ? "panel is-active" : "panel",
      id: `panel-${section.key}`,
      role: "tabpanel",
      "aria-labelledby": `tab-${section.key}`,
    }, [
      h("div", { class: "panel-head" }, [
        h("h2", {}, [text(section.label)]),
        h("span", { class: "count" }, [text(`${items.length} 条`)]),
      ]),
      h("div", { class: "item-list" }, body),
    ]);
  }));
}

function renderTabs() {
  const list = h("div", { class: "tabs", role: "tablist", "aria-label": "栏目" });
  SECTIONS.forEach((section, index) => {
    list.append(h("button", {
      type: "button",
      role: "tab",
      id: `tab-${section.key}`,
      "aria-controls": `panel-${section.key}`,
      "aria-selected": index === 0 ? "true" : "false",
      tabindex: index === 0 ? "0" : "-1",
      "data-section": section.key,
    }, [text(section.label)]));
  });
  return h("div", { class: "tabs-bar" }, [list]);
}

function bindTabs(root) {
  const tabs = [...root.querySelectorAll("[role='tab']")];
  const panels = [...root.querySelectorAll("[role='tabpanel']")];
  const select = (key) => {
    for (const tab of tabs) {
      const on = tab.dataset.section === key;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    }
    for (const panel of panels) panel.classList.toggle("is-active", panel.id === `panel-${key}`);
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      select(tab.dataset.section);
    });
  }
  root.querySelector("[role='tablist']")?.addEventListener("keydown", (event) => {
    const current = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    if (current < 0) return;
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].focus();
    select(tabs[next].dataset.section);
  });
}

function editionTools(entry, siblings) {
  const counts = entry.counts || {};
  const countText = SECTIONS.map((section) => `${section.label} ${counts[section.key] || 0}`).join(" · ");
  const tools = [h("span", {}, [text(countText)])];
  if (siblings.newer) {
    tools.push(h("a", { href: `edition.html?id=${encodeURIComponent(siblings.newer.id)}` }, [text("较新一期")]));
  }
  if (siblings.older) {
    tools.push(h("a", { href: `edition.html?id=${encodeURIComponent(siblings.older.id)}` }, [text("更早一期")]));
  }
  tools.push(h("a", { href: "archive.html" }, [text("全部往期")]));
  return h("div", { class: "edition-tools" }, tools);
}

function renderEdition(edition, entry, siblings, kickerOverride) {
  const parsed = parseEditionId(edition.id);
  const headline = edition.headline || parsed?.label || edition.id;
  const kicker = edition.headline ? (parsed?.label || "本期") : (kickerOverride || "本期");
  return h("article", { class: "edition" }, [
    h("header", { class: "edition-head" }, [
      h("p", { class: "kicker" }, [text(kicker)]),
      h("h1", { class: "edition-title" }, [text(headline)]),
      editionTools(entry, siblings),
    ]),
    renderPanels(edition),
  ]);
}

function emptyState() {
  return h("div", { class: "empty" }, [
    h("p", { class: "kicker" }, [text("AI联盟")]),
    h("h1", {}, [text("还没有期刊")]),
    h("p", {}, [text("每天 06:00、12:00、18:00、22:00（新加坡时间）收录一期。内容整理自 X 上的公开帖子，第一期发布后会出现在这里。")]),
  ]);
}

function showFatal(message) {
  setStatus("");
  const app = document.querySelector("#app");
  clear(app);
  app.append(h("div", { class: "wrap" }, [
    h("div", { class: "empty" }, [
      h("h1", {}, [text("没有读到期刊")]),
      h("p", {}, [text(message)]),
      h("p", {}, [h("a", { href: "index.html" }, [text("回首页")])]),
    ]),
  ]));
}

function siblingsFor(editions, id) {
  const index = editions.findIndex((entry) => entry.id === id);
  if (index < 0) return {};
  return {
    newer: editions[index - 1] || null,
    older: editions[index + 1] || null,
  };
}

async function loadIndex() {
  const index = await fetchJson(INDEX_URL);
  const editions = Array.isArray(index.editions)
    ? index.editions.filter((entry) => parseEditionId(entry?.id) && isSafeDataPath(entry?.path))
    : [];
  return { editions };
}

async function loadEdition(entry) {
  return fetchJson(new URL(entry.path, document.baseURI));
}

function mountEdition(edition, entry, siblings, options = {}) {
  const parsed = parseEditionId(entry.id);
  document.title = `${edition.headline || parsed?.label || entry.id} · AI联盟`;
  setCanonical(`${SITE_ORIGIN}edition.html?id=${encodeURIComponent(entry.id)}`);
  const app = document.querySelector("#app");
  clear(app);
  setStatus("");
  const tabs = renderTabs();
  const shell = h("div", { class: "wrap edition-shell" }, [
    renderEdition(edition, entry, siblings, options.kicker),
  ]);
  app.append(tabs, shell);
  bindTabs(app);
}

async function bootHome() {
  const index = await loadIndex();
  setCanonical(SITE_ORIGIN);
  if (!index.editions.length) {
    setStatus("");
    document.title = "AI联盟";
    document.querySelector("#app").append(h("div", { class: "wrap" }, [emptyState()]));
    return;
  }
  const latest = index.editions[0];
  mountEdition(await loadEdition(latest), latest, siblingsFor(index.editions, latest.id), { kicker: "最新一期" });
}

async function bootArchive() {
  const index = await loadIndex();
  document.title = "往期 · AI联盟";
  setCanonical(`${SITE_ORIGIN}archive.html`);
  setStatus("");
  const app = document.querySelector("#app");
  clear(app);
  if (!index.editions.length) {
    app.append(h("div", { class: "wrap" }, [emptyState()]));
    return;
  }
  const page = h("div", { class: "wrap page" }, [
    h("h1", { class: "page-title" }, [text("往期")]),
    h("p", { class: "lede" }, [text("按日期回看已收录的期刊。时间都是新加坡时间。")]),
  ]);
  for (const month of groupEditions(index.editions)) {
    const section = h("section", { class: "month" }, [
      h("h2", { class: "month-label" }, [text(`${month.year}年${month.month}月`)]),
    ]);
    for (const day of month.days) {
      const slots = h("div", { class: "slots" });
      for (const slot of day.slots) {
        const count = totalCount(slot.entry.counts);
        const link = h("a", {
          class: "slot",
          href: `edition.html?id=${encodeURIComponent(slot.entry.id)}`,
        }, [text(slot.parsed.timeLabel), h("small", {}, [text(`${count} 条`)])]);
        if (slot.entry.headline) link.title = slot.entry.headline;
        slots.append(link);
      }
      section.append(h("div", { class: "day" }, [
        h("h3", { class: "day-label" }, [text(day.label)]),
        slots,
      ]));
    }
    page.append(section);
  }
  app.append(page);
}

async function bootEdition() {
  const id = new URLSearchParams(location.search).get("id") || "";
  if (!parseEditionId(id)) {
    showFatal("链接里的期号无效。");
    return;
  }
  const index = await loadIndex();
  const entry = index.editions.find((item) => item.id === id);
  if (!entry) {
    showFatal("没有找到这一期。");
    return;
  }
  mountEdition(await loadEdition(entry), entry, siblingsFor(index.editions, id));
}

function syncMastHeight() {
  const mast = document.querySelector(".mast");
  if (!mast) return;
  document.documentElement.style.setProperty("--mast-h", `${mast.offsetHeight}px`);
}

function wireTheme() {
  const button = document.querySelector("[data-theme-toggle]");
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const paint = () => {
    if (!button) return;
    const stored = document.documentElement.dataset.theme;
    const dark = stored ? stored === "dark" : media.matches;
    button.textContent = dark ? "浅色" : "深色";
    button.setAttribute("aria-pressed", dark ? "true" : "false");
    button.setAttribute("aria-label", dark ? "切换到浅色" : "切换到深色");
  };
  paint();
  media.addEventListener("change", paint);
  button?.addEventListener("click", () => {
    const stored = document.documentElement.dataset.theme;
    const dark = stored ? stored === "dark" : media.matches;
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("ai-lianmeng-theme", next);
    } catch {
      /* 隐私模式可能拒绝写入 */
    }
    paint();
  });
}

async function main() {
  wireTheme();
  syncMastHeight();
  window.addEventListener("resize", syncMastHeight);
  window.addEventListener("load", syncMastHeight);
  const page = document.body.dataset.page;
  try {
    if (page === "home") await bootHome();
    else if (page === "archive") await bootArchive();
    else if (page === "edition") await bootEdition();
  } catch (error) {
    console.error(error);
    showFatal("期刊暂时没有加载成功，请稍后再试。");
  }
}

main();
