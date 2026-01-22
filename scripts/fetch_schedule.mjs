import fs from "node:fs/promises";
import https from "node:https";
import ical from "node-ical";

const ICS_URL = process.env.CALENDAR_ICS_URL;
const TZ = process.env.SCHEDULE_TZ || "Asia/Tokyo";
const DAYS_AHEAD = Number(process.env.SCHEDULE_DAYS_AHEAD || "14");
const DAYS_BACK = Number(process.env.SCHEDULE_DAYS_BACK || "0");
const OUT_FILE = process.env.SCHEDULE_OUT || "schedule.json";

function fetchText(url){
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if(res.statusCode && res.statusCode >= 400){
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.setEncoding("utf8");
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function toISO(date){
  return new Date(date).toISOString();
}

function parseSummary(summary){
  // Expected: [twitch]{御狗丸てち}VALOソロ
  const s = String(summary || "").trim();
  const m = s.match(/^\s*\[([^\]]+)\]\s*\{([^}]+)\}\s*(.+)\s*$/);
  if(!m) return null;
  return {
    platform: m[1].trim().toLowerCase(),
    streamer: m[2].trim(),
    title: m[3].trim()
  };
}

function formatGeneratedAt(){
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  return fmt.format(d).replace(",", "");
}

async function main(){
  if(!ICS_URL){
    throw new Error("CALENDAR_ICS_URL is not set.");
  }

  const icsText = await fetchText(ICS_URL);
  const parsed = ical.sync.parseICS(icsText);

  const now = new Date();
  const rangeStart = new Date(now.getTime() - DAYS_BACK * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(now.getTime() + DAYS_AHEAD * 24 * 60 * 60 * 1000);

  const items = [];

  for(const key of Object.keys(parsed)){
    const ev = parsed[key];
    if(!ev || ev.type !== "VEVENT") continue;

    const info = parseSummary(ev.summary);
    if(!info) continue;

    // 繰り返し予定（次回分だけ）
    if(ev.rrule){
      try{
        const next = ev.rrule.after(rangeStart, true);
        if(next && next <= rangeEnd){
          const durationMs = new Date(ev.end).getTime() - new Date(ev.start).getTime();
          const nextEnd = new Date(next.getTime() + durationMs);
          items.push({
            streamer: info.streamer,
            platform: info.platform,
            title: info.title,
            start: toISO(next),
            end: toISO(nextEnd),
            is_past: nextEnd < now
          });
        }
      }catch(_){}
      continue;
    }

    if(!ev.start || !ev.end) continue;

    // 範囲外だけ捨てる
    if(ev.end < rangeStart) continue;
    if(ev.start > rangeEnd) continue;

    items.push({
      streamer: info.streamer,
      platform: info.platform,
      title: info.title,
      start: toISO(ev.start),
      end: toISO(ev.end),
      is_past: ev.end < now
    });
  }

  items.sort((a,b) => new Date(a.start) - new Date(b.start));

  const out = {
    generated_at: formatGeneratedAt(),
    items
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_FILE} with ${items.length} items`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
