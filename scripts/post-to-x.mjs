import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { TwitterApi } from "twitter-api-v2";

const STATE_DIR = ".bot_state";
const STATE_FILE = path.join(STATE_DIR, "last_posted.json");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function jstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function toJstDate(iso) {
  const d = new Date(iso);
  const j = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return j;
}

function fmtJst(iso) {
  const d = toJstDate(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

function safeText(s) {
  return (s ?? "").toString().replace(/\s+/g, " ").trim();
}

function truncateForX(text, max = 280) {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + "…";
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { lastKey: null, lastTweetId: null, updatedAt: null };
  }
}

function saveState(state) {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "user-agent": "x-autopost-bot" } });
  if (!res.ok) throw new Error(`Failed to fetch schedule: ${res.status} ${res.statusText}`);
  return await res.json();
}

function normalizeItems(scheduleJson) {
  if (!scheduleJson) return [];
  if (Array.isArray(scheduleJson.items)) return scheduleJson.items;
  if (Array.isArray(scheduleJson.events)) return scheduleJson.events;
  if (Array.isArray(scheduleJson)) return scheduleJson;
  return [];
}

function pickNextEvent(items) {
  const now = new Date();

  const normalized = items
    .map((it) => {
      const start = it.start;
      const end = it.end;
      const title = it.title || "";
      const streamer = it.streamer || "";
      const platform = it.platform || "";
      const isPast = typeof it.is_past === "boolean" ? it.is_past : null;

      if (!start) return null;

      const sd = new Date(start);
      if (Number.isNaN(sd.getTime())) return null;

      return {
        start,
        end,
        startDate: sd,
        title: safeText(title),
        streamer: safeText(streamer),
        platform: safeText(platform),
        isPast,
        raw: it
      };
    })
    .filter(Boolean)
    // is_past があるならそれを優先して未来だけに絞る（ズレに強い）
    .filter((e) => (e.isPast === null ? e.startDate >= now : e.isPast === false))
    .sort((a, b) => a.startDate - b.startDate);

  return normalized[0] || null;
}

function buildTweet(event, hpScheduleUrl) {
  const startJst = fmtJst(event.start);
  const streamer = event.streamer ? `🌹 ${event.streamer}\n` : "";
  const title = event.title ? `📺 ${event.title}\n` : "";
  const platform = event.platform ? `🧩 ${event.platform}\n` : "";

  const body =
`【配信予定のお知らせ📣】

🕗 ${startJst}
${streamer}${platform}${title}
🔗 ${hpScheduleUrl}

初見さんも大歓迎！ぜひ遊びにきてね✨`;

  return truncateForX(body, 280);
}

async function main() {
  const xApiKey = requireEnv("X_API_KEY");
  const xApiSecret = requireEnv("X_API_SECRET");
  const xAccessToken = requireEnv("X_ACCESS_TOKEN");
  const xAccessTokenSecret = requireEnv("X_ACCESS_TOKEN_SECRET");
  const scheduleUrl = requireEnv("SCHEDULE_JSON_URL");
  const hpScheduleUrl = requireEnv("HP_SCHEDULE_URL");

  const state = loadState();

  const schedule = await fetchJson(scheduleUrl);
  const items = normalizeItems(schedule);
  const next = pickNextEvent(items);

  if (!next) {
    console.log("No future event. Skip.");
    return;
  }

  // 二重投稿防止キー（start + streamer + title で固定）
  const key = `${next.start}|${next.streamer}|${next.title}`;
  if (state.lastKey === key) {
    console.log("Already posted for this event key. Skip.");
    return;
  }

  const tweetText = buildTweet(next, hpScheduleUrl);
  console.log("Tweet text:\n" + tweetText);

  const client = new TwitterApi({
    appKey: xApiKey,
    appSecret: xApiSecret,
    accessToken: xAccessToken,
    accessSecret: xAccessTokenSecret
  });

  const result = await client.v2.tweet(tweetText);
  console.log("Tweeted:", result?.data?.id);

  state.lastKey = key;
  state.lastTweetId = result?.data?.id || null;
  state.updatedAt = jstNow().toISOString();
  saveState(state);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
