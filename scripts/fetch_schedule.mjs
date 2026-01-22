import ical from "node-ical";
import fs from "node:fs";

const ICS_URL = process.env.CALENDAR_ICS_URL;
const TZ = process.env.SCHEDULE_TZ || "Asia/Tokyo";
const DAYS_AHEAD = Number(process.env.SCHEDULE_DAYS_AHEAD || "14");
const DAYS_BACK = Number(process.env.SCHEDULE_DAYS_BACK || "0");
const OUT = process.env.SCHEDULE_OUT || "schedule.json";

if (!ICS_URL) {
  console.error("CALENDAR_ICS_URL is not set.");
  process.exit(1);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatJST(dt) {
  // dt は Date。TZを厳密に扱うのは重いので、ここは「これは推論だよ」：GitHub Actions環境でも
  // toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) が安定して使える前提でJST表示にしてる。
  const s = dt.toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T");
  // "YYYY-MM-DDTHH:mm:ss" から "YYYY/MM/DD HH:mm" に
  const [d, t] = s.split("T");
  const [Y, M, D] = d.split("-");
  const [hh, mm] = t.split(":");
  return `${Y}/${M}/${D} ${hh}:${mm}`;
}

function formatHM(dt) {
  const s = dt.toLocaleString("sv-SE", { timeZone: TZ }).replace(" ", "T");
  const [, t] = s.split("T");
  const [hh, mm] = t.split(":");
  return `${hh}:${mm}`;
}

function parseTitle(summary) {
  // 期待フォーマット: [twitch]{ルンルン}VALOソロ
  const m = /^\[(.+?)\]\{(.+?)\}(.*)$/.exec(summary || "");
  if (!m) {
    return {
      platform: "",
      streamer: "",
      title: (summary || "").trim()
    };
  }
  return {
    platform: (m[1] || "").trim(),
    streamer: (m[2] || "").trim(),
    title: (m[3] || "").trim()
  };
}

(async () => {
  const data = await ical.async.fromURL(ICS_URL, {
    followRedirect: true,
    headers: { "User-Agent": "fiverose-schedule-bot" }
  });

  const now = new Date();
  const startMin = new Date(now.getTime() - DAYS_BACK * 24 * 60 * 60 * 1000);
  const startMax = new Date(now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);

  const items = [];

  for (const k of Object.keys(data)) {
    const ev = data[k];
    if (!ev || ev.type !== "VEVENT") continue;

    // 終日イベント等の除外（必要ならここを調整）
    if (!(ev.start instanceof Date) || !(ev.end instanceof Date)) continue;

    const s = ev.start;
    const e = ev.end;

    // 範囲フィルタ：過去DAYS_BACK日〜未来DAYS_AHEAD日
    // 「少し過去」表示は、終わった配信でも範囲内なら出す
    if (e < startMin) continue;
    if (s > startMax) continue;

    const { platform, streamer, title } = parseTitle(ev.summary);

    items.push({
      start: s.toISOString(),
      end: e.toISOString(),
      start_hm: formatHM(s),
      end_hm: formatHM(e),
      start_jst: formatJST(s),
      end_jst: formatJST(e),
      platform,
      streamer,
      title,
      is_past: e < now
    });
  }

  // 表示順：開始時刻でソート（過去も混じる）
  items.sort((a, b) => new Date(a.start) - new Date(b.start));

  const out = {
    generated_at: formatJST(now),
    items
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf-8");
  console.log(`Wrote ${OUT}: ${items.length} item(s)`);
})();
