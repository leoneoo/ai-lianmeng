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
const DISPLAY = ["zh_topics", "en_topics", "x_daily"].map((key) => SECTIONS.find((section) => section.key === key));

let indexPromise = null;
const editionCache = new Map();
let viewGen = 0;
let searchTimer = 0;

function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

function text(value) {
  return document.createTextNode(value == null ? "" : String(value));
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
  const node = h("a", {
    class: className,
    href,
    rel: "noopener noreferrer",
    target: "_blank",
    referrerpolicy: "no-referrer",
  });
  node.append(label instanceof Node ? label : text(label));
  return node;
}

function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetchJson(INDEX_URL).then((index) => ({
      editions: Array.isArray(index?.editions)
        ? index.editions.filter((entry) => parseEditionId(entry?.id) && isSafeDataPath(entry?.path))
        : [],
    })).catch((error) => {
      indexPromise = null;
      throw error;
    });
  }
  return indexPromise;
}

function loadEdition(entry) {
  const cached = editionCache.get(entry.id);
  if (cached) return cached;
  const pending = fetchJson(new URL(entry.path, document.baseURI)).catch((error) => {
    editionCache.delete(entry.id);
    throw error;
  });
  editionCache.set(entry.id, pending);
  return pending;
}

function sectionItems(edition, key) {
  const list = edition?.sections?.[key];
  if (!Array.isArray(list)) return [];
  return list.filter((item) => item && typeof item === "object");
}

function sectionByKey(key) {
  return SECTIONS.find((section) => section.key === key) || DISPLAY[0];
}

function shortDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!match) return "";
  return `${Number(match[2])}/${Number(match[3])}`;
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function heroModel(edition) {
  let source = null;
  const daily = sectionItems(edition, "x_daily");
  if (daily[0]) source = { item: daily[0], section: sectionByKey("x_daily") };
  else {
    for (const section of DISPLAY) {
      const first = sectionItems(edition, section.key)[0];
      if (first) {
        source = { item: first, section };
        break;
      }
    }
  }
  const headline = asString(edition?.headline);
  if (headline) {
    return {
      title: headline,
      summary: asString(source?.item.summary),
      source_url: source?.item.source_url,
      time: source?.item.time || edition.published_at,
      handle: asString(source?.item.handle),
      section: source?.section || sectionByKey("x_daily"),
      skipItem: source?.item || null,
      skipKey: source?.section?.key || "",
    };
  }
  if (!source) return null;
  return {
    title: asString(source.item.title) || "未命名",
    summary: asString(source.item.summary),
    source_url: source.item.source_url,
    time: source.item.time,
    handle: asString(source.item.handle),
    section: source.section,
    skipItem: source.item,
    skipKey: source.section.key,
  };
}

function leadParts(edition) {
  const hero = heroModel(edition);
  const pair = [];
  for (const section of DISPLAY) {
    if (hero && section.key === hero.skipKey) continue;
    const first = sectionItems(edition, section.key)[0];
    if (first) pair.push({ item: first, section });
  }
  const rest = [];
  if (hero?.skipKey) {
    for (const item of sectionItems(edition, hero.skipKey)) {
      if (item === hero.skipItem) continue;
      rest.push({ item, section: hero.section });
    }
  }
  return { hero, pair, rest };
}

function flatten(edition) {
  const rows = [];
  for (const section of DISPLAY) {
    for (const item of sectionItems(edition, section.key)) rows.push({ item, section });
  }
  return rows;
}

function tokensOf(query) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matches(item, tokens) {
  const hay = `${asString(item.title)}\n${asString(item.summary)}\n${asString(item.handle)}`.toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

function highlight(value, tokens) {
  const source = String(value || "");
  const frag = document.createDocumentFragment();
  if (!source || !tokens?.length) {
    frag.append(text(source));
    return frag;
  }
  const lower = source.toLowerCase();
  let index = 0;
  while (index < source.length) {
    let best = -1;
    let length = 0;
    for (const token of tokens) {
      const found = lower.indexOf(token, index);
      if (found !== -1 && (best === -1 || found < best)) {
        best = found;
        length = token.length;
      }
    }
    if (best === -1) {
      frag.append(text(source.slice(index)));
      break;
    }
    if (best > index) frag.append(text(source.slice(index, best)));
    frag.append(h("mark", {}, [text(source.slice(best, best + length))]));
    index = best + length;
  }
  return frag;
}

function rich(value, tokens) {
  return tokens?.length ? highlight(value, tokens) : text(value);
}

function handleNode(handle, tokens) {
  const value = asString(handle);
  if (!value) return null;
  const content = rich(value, tokens);
  if (/^@[A-Za-z0-9_]{1,15}$/.test(value)) {
    return externalAnchor(`https://x.com/${value.slice(1)}`, "handle", content);
  }
  return h("span", { class: "handle" }, [content]);
}

function metaRow(section, time, extra) {
  return h("div", { class: "card-meta" }, [
    h("span", { class: `badge badge-${section.key}` }, [text(section.label)]),
    time ? h("time", { datetime: time }, [text(formatZhTime(time))]) : null,
    extra ? h("span", {}, [text(extra)]) : null,
  ]);
}

function foot(item, tokens) {
  const children = [];
  const handle = handleNode(item.handle, tokens);
  if (handle) children.push(handle);
  if (isHttpsUrl(item.source_url)) children.push(externalAnchor(item.source_url, "source", "原文"));
  if (!children.length) return null;
  return h("div", { class: "card-foot" }, children);
}

function titleBlock(tag, className, title, href, tokens) {
  const content = rich(title, tokens);
  const inner = isHttpsUrl(href) ? externalAnchor(href, "title-link", content) : content;
  return h(tag, { class: className }, [inner]);
}

function renderCard(item, section, tokens, heading = "h3", extra = "") {
  const title = asString(item.title) || "未命名";
  const summary = asString(item.summary);
  return h("article", { class: "card rise", "data-section": section.key }, [
    metaRow(section, item.time, extra),
    titleBlock(heading, "card-title", title, item.source_url, tokens),
    summary ? h("p", { class: "summary clamp" }, [rich(summary, tokens)]) : null,
    foot(item, tokens),
  ]);
}

function renderHero(hero) {
  return h("article", { class: "card hero rise" }, [
    metaRow(hero.section, hero.time),
    titleBlock("h1", "hero-title", hero.title, hero.source_url, null),
    hero.summary ? h("p", { class: "summary clamp" }, [text(hero.summary)]) : null,
    foot(hero, null),
  ]);
}

function moreList(rows) {
  return h("section", { class: "more rise" }, [
    h("h2", { class: "more-title" }, [text("本期还有")]),
    h("ul", { class: "more-list" }, rows.map((row) => {
      const title = asString(row.item.title) || "未命名";
      const label = isHttpsUrl(row.item.source_url)
        ? externalAnchor(row.item.source_url, "more-link", title)
        : h("span", { class: "more-link" }, [text(title)]);
      return h("li", {}, [label]);
    })),
  ]);
}

function sectionStamp(edition, key) {
  const item = sectionItems(edition, key)[0];
  return shortDate(item?.time || edition?.published_at);
}

function sidebar(editions, latest) {
  const intro = h("section", { class: "side-card rise" }, [
    h("h2", { class: "side-title" }, [text("AI联盟")]),
    h("p", {}, [text("免费中文 AI 新闻站。每期整理 X 上的公开动态，连同中文选题和英文选题，并为每条保留原文链接。")]),
  ]);
  const sections = h("section", { class: "side-card rise" }, [
    h("h2", { class: "side-title" }, [text("栏目")]),
    h("div", { class: "side-list" }, DISPLAY.map((section) => h("a", {
      class: "side-link",
      href: `index.html?section=${section.key}`,
    }, [
      h("span", { class: `badge badge-${section.key}` }, [text(section.label)]),
      h("span", { class: "side-date" }, [text(latest ? sectionStamp(latest, section.key) : "")]),
    ]))),
  ]);
  const recentLinks = editions.slice(0, 6).map((entry) => {
    const parsed = parseEditionId(entry.id);
    return h("a", {
      class: "side-link",
      href: `edition.html?id=${encodeURIComponent(entry.id)}`,
    }, [
      h("span", { class: "side-label" }, [text(asString(entry.headline) || parsed?.label || entry.id)]),
      h("span", { class: "side-date" }, [text(parsed?.timeLabel || "")]),
    ]);
  });
  const recent = h("section", { class: "side-card rise" }, [
    h("h2", { class: "side-title" }, [text("最近各期")]),
    recentLinks.length
      ? h("div", { class: "side-list" }, recentLinks)
      : h("p", {}, [text("还没有期刊")]),
  ]);
  let fresh = null;
  if (latest) {
    const rows = flatten(latest).slice(0, 6);
    fresh = h("section", { class: "side-card rise" }, [
      h("h2", { class: "side-title" }, [text("最新")]),
      rows.length
        ? h("div", { class: "side-list" }, rows.map((row) => {
          const label = h("span", { class: "side-label" }, [text(asString(row.item.title) || "未命名")]);
          if (!isHttpsUrl(row.item.source_url)) return h("div", { class: "side-link" }, [label]);
          return externalAnchor(row.item.source_url, "side-link", label);
        }))
        : h("p", {}, [text("本期暂无")]),
    ]);
  }
  return h("aside", { class: "sidebar" }, [intro, sections, recent, fresh]);
}

function latestBand(edition) {
  return h("section", { class: "band" }, [
    h("h2", { class: "band-title rise" }, [text("最新报道")]),
    ...DISPLAY.map((section) => {
      const items = sectionItems(edition, section.key);
      return h("section", { class: "band-section" }, [
        h("h3", { class: "band-sub" }, [
          text(section.label),
          h("span", { class: "count" }, [text(`${items.length} 条`)]),
        ]),
        items.length
          ? h("div", { class: "card-grid" }, items.map((item) => renderCard(item, section)))
          : h("p", { class: "empty-section" }, [text("本期暂无")]),
      ]);
    }),
  ]);
}

function layoutShell(lead, aside) {
  return h("div", { class: "shell page" }, [
    h("div", { class: "layout" }, [lead, aside]),
  ]);
}

function emptyLead(kicker) {
  return h("div", { class: "lead" }, [
    h("p", { class: "kicker rise" }, [text(kicker)]),
    h("h1", { class: "page-title rise" }, [text("还没有期刊")]),
    h("p", { class: "summary" }, [text("每天 06:00、12:00、18:00、22:00（新加坡时间）收录一期。内容整理自 X 上的公开帖子，第一期发布后会出现在这里。")]),
  ]);
}

function stampRise(root) {
  root.querySelectorAll(".rise").forEach((node, index) => {
    node.style.animationDelay = `${Math.min(index, 10) * 35}ms`;
  });
}

function paint(gen, node) {
  if (gen !== viewGen) return;
  const app = document.querySelector("#app");
  if (!app) return;
  clear(app);
  setStatus("");
  app.append(node);
  stampRise(app);
}

function showFatal(message) {
  setStatus("");
  const app = document.querySelector("#app");
  if (!app) return;
  clear(app);
  app.append(h("div", { class: "shell page" }, [
    h("h1", { class: "page-title" }, [text("没有读到期刊")]),
    h("p", { class: "summary" }, [text(message)]),
    h("p", {}, [h("a", { class: "text-link", href: "index.html" }, [text("回首页")])]),
  ]));
}

function syncTabs(key) {
  document.querySelectorAll(".tabs [data-tab]").forEach((tab) => {
    const on = key != null && tab.dataset.tab === key;
    tab.setAttribute("aria-selected", on ? "true" : "false");
    tab.tabIndex = key == null || on ? 0 : -1;
  });
}

function syncIndicator() {
  const nav = document.querySelector(".tabs");
  const indicator = nav?.querySelector(".tab-indicator");
  if (!nav || !indicator) return;
  const current = nav.querySelector('[aria-selected="true"]');
  if (!current) {
    indicator.style.opacity = "0";
    return;
  }
  indicator.style.opacity = "1";
  indicator.style.width = `${current.offsetWidth}px`;
  indicator.style.transform = `translateX(${current.offsetLeft}px)`;
}

function syncChrome() {
  const topbar = document.querySelector("[data-topbar]");
  if (!topbar) return;
  document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
  syncIndicator();
}

function homeTabKey() {
  const params = new URLSearchParams(location.search);
  if ((params.get("q") || "").trim()) return null;
  const section = params.get("section");
  if (DISPLAY.some((item) => item.key === section)) return section;
  return section ? null : "home";
}

function siblingsFor(editions, id) {
  const index = editions.findIndex((entry) => entry.id === id);
  if (index < 0) return {};
  return {
    newer: editions[index - 1] || null,
    older: editions[index + 1] || null,
  };
}

async function renderFront(gen, editions) {
  document.title = "AI联盟";
  setCanonical(SITE_ORIGIN);
  syncTabs("home");
  if (!editions.length) {
    paint(gen, layoutShell(emptyLead("今日头条"), sidebar(editions, null)));
    return;
  }
  const latest = await loadEdition(editions[0]);
  if (gen !== viewGen) return;
  const parsed = parseEditionId(latest.id || editions[0].id);
  const { hero, pair, rest } = leadParts(latest);
  const lead = h("div", { class: "lead" }, [
    h("p", { class: "kicker rise" }, [text("今日头条")]),
    hero
      ? renderHero(hero)
      : h("article", { class: "card hero rise" }, [
        h("h1", { class: "hero-title" }, [text(parsed?.label || "本期")]),
        h("p", { class: "summary" }, [text("本期暂无")]),
      ]),
    pair.length ? h("div", { class: "pair" }, pair.map((row) => renderCard(row.item, row.section, null, "h2"))) : null,
    rest.length ? moreList(rest) : null,
  ]);
  paint(gen, h("div", { class: "shell page" }, [
    h("div", { class: "layout" }, [lead, sidebar(editions, latest)]),
    latestBand(latest),
  ]));
}

async function renderSection(gen, key, editions) {
  const section = sectionByKey(key);
  document.title = `${section.label} · AI联盟`;
  setCanonical(`${SITE_ORIGIN}index.html?section=${encodeURIComponent(key)}`);
  syncTabs(key);
  if (!editions.length) {
    paint(gen, layoutShell(emptyLead(section.label), sidebar(editions, null)));
    return;
  }
  const subset = editions.slice(0, 8);
  const loaded = await Promise.all(subset.map((entry) => loadEdition(entry).catch(() => null)));
  if (gen !== viewGen) return;
  const cards = [];
  subset.forEach((entry, index) => {
    const edition = loaded[index];
    if (!edition) return;
    const parsed = parseEditionId(entry.id);
    for (const item of sectionItems(edition, key)) {
      cards.push(renderCard(item, section, null, "h3", parsed?.timeLabel || ""));
    }
  });
  const lead = h("div", { class: "lead" }, [
    h("p", { class: "kicker rise" }, [text("栏目")]),
    h("h1", { class: "page-title rise" }, [text(section.label)]),
    h("p", { class: "lede" }, [text(`最近 ${subset.length} 期里的${section.label}。`)]),
    cards.length
      ? h("div", { class: "card-grid" }, cards)
      : h("p", { class: "summary" }, [text("这一栏还没有条目。")]),
  ]);
  paint(gen, layoutShell(lead, sidebar(editions, loaded[0])));
}

async function renderSearch(gen, query, editions) {
  const tokens = tokensOf(query);
  document.title = `搜索 ${query.slice(0, 40)} · AI联盟`;
  setCanonical(`${SITE_ORIGIN}index.html?q=${encodeURIComponent(query)}`);
  syncTabs(null);
  let latest = null;
  if (editions[0]) {
    try { latest = await loadEdition(editions[0]); } catch { latest = null; }
  }
  if (gen !== viewGen) return;
  const heading = h("h1", { class: "page-title rise", "aria-live": "polite" }, [text("正在查找…")]);
  const list = h("div", { class: "card-grid results" });
  const lead = h("div", { class: "lead" }, [
    h("p", { class: "kicker rise" }, [text("搜索")]),
    heading,
    list,
  ]);
  paint(gen, layoutShell(lead, sidebar(editions, latest)));
  if (!tokens.length || !list.isConnected) {
    heading.textContent = "没有匹配的条目。";
    return;
  }
  let count = 0;
  for (const entry of editions) {
    if (gen !== viewGen || !list.isConnected) return;
    let edition;
    try {
      edition = await loadEdition(entry);
    } catch {
      continue;
    }
    if (gen !== viewGen || !list.isConnected) return;
    const parsed = parseEditionId(entry.id);
    for (const section of DISPLAY) {
      for (const item of sectionItems(edition, section.key)) {
        if (!matches(item, tokens)) continue;
        count += 1;
        const card = renderCard(item, section, tokens, "h3", parsed?.timeLabel || "");
        card.style.animationDelay = `${Math.min(count, 10) * 35}ms`;
        list.append(card);
      }
    }
  }
  if (gen !== viewGen) return;
  heading.textContent = count ? `找到 ${count} 条` : "没有匹配的条目。";
}

async function renderHome(gen) {
  const params = new URLSearchParams(location.search);
  const query = (params.get("q") || "").trim();
  const section = params.get("section");
  syncTabs(homeTabKey());
  syncIndicator();
  const index = await loadIndex();
  if (gen !== viewGen) return;
  if (query) return renderSearch(gen, query, index.editions);
  if (DISPLAY.some((item) => item.key === section)) return renderSection(gen, section, index.editions);
  return renderFront(gen, index.editions);
}

async function renderArchive(gen) {
  document.title = "往期归档 · AI联盟";
  setCanonical(`${SITE_ORIGIN}archive.html`);
  syncTabs(null);
  const index = await loadIndex();
  if (gen !== viewGen) return;
  if (!index.editions.length) {
    paint(gen, h("div", { class: "shell page" }, [emptyLead("往期归档")]));
    return;
  }
  const page = h("div", { class: "shell page" }, [
    h("p", { class: "kicker rise" }, [text("归档")]),
    h("h1", { class: "page-title rise" }, [text("往期归档")]),
    h("p", { class: "lede" }, [text("按日期回看已收录的期刊。时间都是新加坡时间。")]),
  ]);
  for (const month of groupEditions(index.editions)) {
    const grid = h("div", { class: "card-grid" });
    for (const day of month.days) {
      for (const slot of day.slots) {
        const count = totalCount(slot.entry.counts);
        const title = asString(slot.entry.headline) || `${day.label} ${slot.parsed.timeLabel}`;
        grid.append(h("a", {
          class: "card edition-card rise",
          href: `edition.html?id=${encodeURIComponent(slot.entry.id)}`,
        }, [
          h("div", { class: "card-meta" }, [
            h("time", { datetime: slot.entry.published_at || slot.parsed.published_at }, [text(day.label)]),
            h("span", { class: "slot-pill" }, [text(slot.parsed.timeLabel)]),
          ]),
          h("h3", { class: "card-title" }, [text(title)]),
          h("p", { class: "summary" }, [text(`${count} 条`)]),
        ]));
      }
    }
    page.append(h("section", { class: "month" }, [
      h("h2", { class: "band-title rise" }, [text(`${month.year}年${month.month}月`)]),
      grid,
    ]));
  }
  paint(gen, page);
}

async function renderEditionPage(gen) {
  syncTabs(null);
  const id = new URLSearchParams(location.search).get("id") || "";
  if (!parseEditionId(id)) {
    showFatal("链接里的期号无效。");
    return;
  }
  const index = await loadIndex();
  if (gen !== viewGen) return;
  const entry = index.editions.find((item) => item.id === id);
  if (!entry) {
    showFatal("没有找到这一期。");
    return;
  }
  const edition = await loadEdition(entry);
  if (gen !== viewGen) return;
  const parsed = parseEditionId(edition.id) || parseEditionId(id);
  const headline = asString(edition.headline) || parsed?.label || id;
  document.title = `${headline} · AI联盟`;
  setCanonical(`${SITE_ORIGIN}edition.html?id=${encodeURIComponent(id)}`);
  const siblings = siblingsFor(index.editions, id);
  const tools = [];
  if (siblings.newer) {
    tools.push(h("a", { class: "text-link", href: `edition.html?id=${encodeURIComponent(siblings.newer.id)}` }, [text("较新一期")]));
  }
  if (siblings.older) {
    tools.push(h("a", { class: "text-link", href: `edition.html?id=${encodeURIComponent(siblings.older.id)}` }, [text("更早一期")]));
  }
  tools.push(h("a", { class: "text-link", href: "archive.html" }, [text("全部往期")]));
  const counts = DISPLAY.map((section) => `${section.label} ${sectionItems(edition, section.key).length}`).join(" · ");
  const lead = h("div", { class: "lead" }, [
    h("article", { class: "card hero rise" }, [
      h("p", { class: "kicker" }, [text(asString(edition.headline) ? (parsed?.label || "本期") : "本期")]),
      h("h1", { class: "hero-title" }, [text(headline)]),
      h("p", { class: "summary" }, [text(counts)]),
      h("div", { class: "edition-tools" }, tools),
    ]),
    ...DISPLAY.map((section) => {
      const items = sectionItems(edition, section.key);
      return h("section", { class: "band-section" }, [
        h("h2", { class: "band-sub" }, [
          text(section.label),
          h("span", { class: "count" }, [text(`${items.length} 条`)]),
        ]),
        items.length
          ? h("div", { class: "card-grid" }, items.map((item) => renderCard(item, section)))
          : h("p", { class: "empty-section" }, [text("本期暂无")]),
      ]);
    }),
  ]);
  paint(gen, layoutShell(lead, sidebar(index.editions, edition)));
}

async function render() {
  const gen = ++viewGen;
  const page = document.body.dataset.page;
  try {
    if (page === "home") await renderHome(gen);
    else if (page === "archive") await renderArchive(gen);
    else if (page === "edition") await renderEditionPage(gen);
  } catch (error) {
    console.error(error);
    if (gen !== viewGen) return;
    showFatal("期刊暂时没有加载成功，请稍后再试。");
  }
  if (gen !== viewGen) return;
  syncChrome();
  requestAnimationFrame(syncChrome);
}

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const light = theme === "light";
  const button = document.querySelector("[data-theme-toggle]");
  if (button) {
    const name = light ? "深色" : "浅色";
    const action = light ? "切换到深色" : "切换到浅色";
    button.setAttribute("aria-pressed", light ? "true" : "false");
    button.setAttribute("aria-label", action);
    button.title = action;
    const hidden = button.querySelector(".sr-only");
    if (hidden) hidden.textContent = name;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", light ? "#f4f6f8" : "#0c0e12");
}

function isIndexPath(url) {
  if (url.origin !== location.origin) return false;
  const strip = (pathname) => pathname.replace(/index\.html$/, "");
  return strip(url.pathname) === strip(location.pathname);
}

function syncQueryInput() {
  const input = document.querySelector("#q");
  if (!input || document.activeElement === input) return;
  input.value = new URLSearchParams(location.search).get("q") || "";
}

function navigateHome(query, mode) {
  const url = new URL(location.href);
  if (query) {
    url.searchParams.set("q", query);
    url.searchParams.delete("section");
  } else {
    url.searchParams.delete("q");
  }
  const next = `${url.pathname}${url.search}`;
  const current = `${location.pathname}${location.search}`;
  if (next !== current) {
    if (mode === "push") history.pushState({}, "", next);
    else history.replaceState({}, "", next);
  }
  render();
}

function wireChrome() {
  applyTheme(currentTheme());
  const topbar = document.querySelector("[data-topbar]");
  const onScroll = () => topbar?.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", syncChrome);
  if (topbar && "ResizeObserver" in window) new ResizeObserver(() => syncChrome()).observe(topbar);
  document.fonts?.ready?.then(() => syncChrome()).catch(() => {});

  document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("ai-lianmeng-theme", next);
    } catch {
      /* 隐私模式可能拒绝写入 */
    }
  });

  const input = document.querySelector("#q");
  const form = document.querySelector(".search");
  input?.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    if (document.body.dataset.page !== "home") {
      searchTimer = window.setTimeout(() => {
        const query = input.value.trim();
        if (!query) return;
        location.href = new URL(`index.html?q=${encodeURIComponent(query)}`, document.baseURI).href;
      }, 180);
      return;
    }
    searchTimer = window.setTimeout(() => navigateHome(input.value.trim(), "replace"), 180);
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !input.value) return;
    input.value = "";
    if (document.body.dataset.page === "home") navigateHome("", "replace");
  });
  form?.addEventListener("submit", (event) => {
    if (document.body.dataset.page !== "home") return;
    event.preventDefault();
    window.clearTimeout(searchTimer);
    navigateHome(input?.value.trim() || "", "push");
  });

  document.addEventListener("click", (event) => {
    if (document.body.dataset.page !== "home") return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a");
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (!isIndexPath(url)) return;
    event.preventDefault();
    const next = `${url.pathname}${url.search}`;
    if (next !== `${location.pathname}${location.search}`) {
      if (input) input.value = url.searchParams.get("q") || "";
      history.pushState({}, "", next);
      render();
    }
  });

  document.querySelector(".tabs")?.addEventListener("keydown", (event) => {
    const tabs = [...document.querySelectorAll(".tabs [data-tab]")];
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    if (current < 0) return;
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].focus();
    if (document.body.dataset.page === "home") tabs[next].click();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
    event.preventDefault();
    input?.focus();
  });

  window.addEventListener("popstate", () => {
    syncQueryInput();
    if (document.body.dataset.page === "home" || document.body.dataset.page === "edition") render();
  });
}

async function main() {
  wireChrome();
  syncQueryInput();
  const page = document.body.dataset.page;
  if (page === "home" || page === "archive" || page === "edition") await render();
  else {
    syncTabs(null);
    syncChrome();
  }
}

main();
