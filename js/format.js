export const SITE_ORIGIN = "https://leoneoo.github.io/ai-lianmeng/";

export const SECTIONS = [
  { key: "x_daily", label: "AI 日报", nav: "AI 日报", required: true },
  { key: "zh_topics", label: "中文博主", nav: "中文博主", required: true },
  { key: "en_topics", label: "英文选题", nav: null, required: false, deprecated: true },
  { key: "oss_agent", label: "开源与 Agent 技术", nav: "开源与 Agent", required: false },
  { key: "tech", label: "科技与数码", nav: "科技数码", required: false },
  { key: "iot", label: "万物互联", nav: "万物互联", required: false },
];

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const ID_RE = /^(\d{4})-(\d{2})-(\d{2})-(0600|1200|1800|2200)$/;
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/;

export function itemFragment(sectionKey, index) {
  if (!SECTIONS.some((section) => section.key === sectionKey)) return null;
  if (!Number.isInteger(index) || index < 0 || index > 39) return null;
  return `item-${sectionKey}-${index}`;
}

export function parseItemFragment(value) {
  if (typeof value !== "string") return null;
  const match = /^item-([a-z_]+)-(\d+)$/.exec(value.trim());
  if (!match) return null;
  const index = Number(match[2]);
  const fragment = itemFragment(match[1], index);
  if (fragment !== `item-${match[1]}-${index}`) return null;
  return { key: match[1], index };
}

export function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseEditionId(id) {
  if (typeof id !== "string") return null;
  const match = ID_RE.exec(id);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealDate(year, month, day)) return null;
  const slot = match[4];
  const timeLabel = `${slot.slice(0, 2)}:${slot.slice(2)}`;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return {
    id,
    year,
    month,
    day,
    slot,
    date,
    timeLabel,
    published_at: `${date}T${timeLabel}:00+08:00`,
    label: `${year}年${month}月${day}日 ${timeLabel}`,
  };
}

export function editionRelPath(id) {
  const parsed = parseEditionId(id);
  if (!parsed) return null;
  return `data/${parsed.id.slice(0, 4)}/${parsed.id.slice(5, 7)}/${parsed.id}.json`;
}

export function commitMessage(id) {
  const parsed = parseEditionId(id);
  if (!parsed) throw new Error("无效期号");
  return `edition: ${parsed.date} ${parsed.timeLabel}`;
}

export function isOffsetTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = TIME_RE.exec(value);
  if (!match) return false;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  return isRealDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function isSafeDataPath(value) {
  return typeof value === "string"
    && /^data\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}-(0600|1200|1800|2200)\.json$/.test(value);
}


/** Homepage hero: primary = edition out-time; secondary = item post time. */
export function heroMetaTimes(edition, item) {
  const out = typeof edition?.published_at === "string" ? edition.published_at : "";
  const posted = typeof item?.time === "string" ? item.time : "";
  return { out, posted };
}

/** Sidebar section stamp: always the edition out-time. */
export function sectionStampIso(edition) {
  return typeof edition?.published_at === "string" ? edition.published_at : "";
}

export function formatZhTime(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || "");
  if (!match) return iso || "";
  return `${Number(match[2])}月${Number(match[3])}日 ${match[4]}:${match[5]}`;
}

export function weekday(date) {
  const [year, month, day] = String(date).split("-").map(Number);
  if (!isRealDate(year, month, day)) return "";
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function totalCount(counts = {}) {
  return SECTIONS.reduce((sum, section) => sum + (Number(counts?.[section.key]) || 0), 0);
}

export function nowInPlus08(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return [
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}+08:00`,
  ].join("");
}

export function groupEditions(editions) {
  const months = [];
  const byMonth = new Map();
  const daysByMonth = new Map();
  for (const entry of editions || []) {
    const parsed = parseEditionId(entry?.id);
    if (!parsed) continue;
    const monthKey = parsed.date.slice(0, 7);
    let month = byMonth.get(monthKey);
    if (!month) {
      month = { key: monthKey, year: parsed.year, month: parsed.month, days: [] };
      byMonth.set(monthKey, month);
      daysByMonth.set(month, new Map());
      months.push(month);
    }
    const dayMap = daysByMonth.get(month);
    let day = dayMap.get(parsed.date);
    if (!day) {
      day = {
        date: parsed.date,
        label: `${parsed.month}月${parsed.day}日 ${weekday(parsed.date)}`,
        slots: [],
      };
      dayMap.set(parsed.date, day);
      month.days.push(day);
    }
    day.slots.push({ entry, parsed });
  }
  for (const month of months) {
    for (const day of month.days) {
      day.slots.sort((a, b) => a.parsed.timeLabel.localeCompare(b.parsed.timeLabel));
    }
  }
  return months;
}
