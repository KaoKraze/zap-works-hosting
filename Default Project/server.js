// =========================================================
// Zap Works — tiny live stats server
// Serves the static site AND /api/stats which pulls live
// data from Roblox (games + groups) and Discord.
//
//   Run:  npm start   (or: node server.js)
//   Sites at: http://localhost:3000
// =========================================================

const http = require("http");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const { games, groups, discord } = require("./data.js");

const ROOT = __dirname;
// Where the server keeps its caches and the live-player history.
// On Railway, attach a Volume to this service and it is used automatically
// (Railway sets RAILWAY_VOLUME_MOUNT_PATH), so history survives restarts and redeploys.
// DATA_DIR can override it; locally it falls back to ./data.
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
const PORT = process.env.PORT || 3000;
const CACHE_TTL = 15 * 1000; // refresh at most every 15s (keeps under rate limits)

let cache = null;
let cacheTime = 0;

// ---- live graph history ------------------------------------
// We sample the total live-player count and keep a running series so the
// front-end can draw a real (growing) graph. Persisted so it survives restarts
// and accumulates a longer "past" window over time.
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const HISTORY_MAX = 8640; // up to 30 days at 1 sample / 5 min
const SAMPLE_MS = 5 * 60 * 1000; // add a new history point at most every 5 minutes
let history = loadHistory();

function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    return [];
  }
}

function saveHistory() {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  } catch (err) {
    // non-fatal
  }
}

// ---- fixed chart colours -----------------------------------
// Each game that makes the chart's top lines keeps the same colour slot for good,
// so a game doesn't change colour when it moves rank or when you switch 24H/7D/30D.
// A slot is only reused once its game has been off the chart for 30 days.
const CHART_LINES = 6;
const COLOR_SLOTS = 12;
const COLOR_FILE = path.join(DATA_DIR, "chart-colors.json");
const COLOR_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
let colorSlots = (() => {
  try {
    const o = JSON.parse(fs.readFileSync(COLOR_FILE, "utf8"));
    return o && typeof o === "object" ? o : {};
  } catch (err) {
    return {};
  }
})();
let colorsDirty = false;
function colorFor(placeId, now) {
  const id = String(placeId);
  const active = {};
  for (const k in colorSlots) {
    if (k !== id && now - colorSlots[k].at < COLOR_KEEP_MS) active[colorSlots[k].s] = k;
  }
  const mine = colorSlots[id];
  if (mine && active[mine.s] === undefined) {
    if (now - mine.at > 60 * 60 * 1000) colorsDirty = true;
    mine.at = now;
    return mine.s;
  }
  let slot = -1;
  for (let i = 0; i < COLOR_SLOTS; i++) if (active[i] === undefined) { slot = i; break; }
  if (slot < 0) {
    // every slot in use: take the one whose game was on the chart longest ago
    let oldest = Infinity;
    for (const k in colorSlots) if (colorSlots[k].at < oldest && k !== id) { oldest = colorSlots[k].at; slot = colorSlots[k].s; }
  }
  colorSlots[id] = { s: slot, at: now };
  colorsDirty = true;
  return slot;
}
function saveColors() {
  if (!colorsDirty) return;
  colorsDirty = false;
  try {
    fs.mkdirSync(path.dirname(COLOR_FILE), { recursive: true });
    fs.writeFileSync(COLOR_FILE, JSON.stringify(colorSlots));
  } catch (err) {
    // non-fatal
  }
}

// perGame: { placeId: playing } for games with players (zeros are left out to keep the file small)
let lastHistorySave = 0;
function sampleHistory(value, perGame) {
  const now = Date.now();
  const g = perGame && Object.keys(perGame).length ? perGame : undefined;
  let appended = false;
  if (history.length && now - history[history.length - 1].t < SAMPLE_MS) {
    // update the most recent point in-place (keeps points from piling up)
    history[history.length - 1].v = value;
    if (g) history[history.length - 1].g = g;
  } else {
    history.push(g ? { t: now, v: value, g } : { t: now, v: value });
    appended = true;
    // seed a baseline point so the graph is never blank on first load
    if (history.length === 1) history.unshift(g ? { t: now - 60000, v: value, g } : { t: now - 60000, v: value });
    if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  }
  if (appended || now - lastHistorySave > 2 * 60 * 1000) {
    lastHistorySave = now;
    saveHistory();
  }
}

function perGamePlaying(gameList) {
  const out = {};
  for (const g of gameList || []) if (g.playing > 0) out[g.placeId] = g.playing;
  return out;
}

// Averaged series for the chart: total + one line per game that had players in the window.
const HISTORY_BUCKETS = 240;
const historyResponseCache = {};
function historySeries(days) {
  const span = days * 24 * 3600 * 1000;
  const to = Date.now();
  const from = to - span;
  const key = days;
  const hit = historyResponseCache[key];
  if (hit && to - hit.at < 30000) return hit.body;

  const pts = history.filter((p) => p && p.t >= from);
  const size = span / HISTORY_BUCKETS;
  const buckets = [];
  for (const p of pts) {
    const i = Math.min(HISTORY_BUCKETS - 1, Math.floor((p.t - from) / size));
    (buckets[i] = buckets[i] || []).push(p);
  }
  const names = {};
  for (const g of (cache && cache.games) || []) names[g.placeId] = g.name;
  for (const g of games) if (!names[g.placeId]) names[g.placeId] = g.name;

  const t = [];
  const total = [];
  const perGame = {}; // placeId -> values[]
  const seenAt = []; // bucket indexes that carry per-game data
  buckets.forEach((b, i) => {
    if (!b || !b.length) return;
    const idx = t.length;
    t.push(Math.round(b.reduce((a, p) => a + p.t, 0) / b.length));
    total.push(Math.round(b.reduce((a, p) => a + (p.v || 0), 0) / b.length));
    const withGames = b.filter((p) => p.g);
    if (!withGames.length) return;
    seenAt.push(idx);
    const sums = {};
    for (const p of withGames) for (const id in p.g) sums[id] = (sums[id] || 0) + p.g[id];
    for (const id in sums) {
      (perGame[id] = perGame[id] || [])[idx] = Math.round(sums[id] / withGames.length);
    }
  });
  // games with no entry in a bucket that has per-game data had 0 players there
  const out = Object.keys(perGame).map((id) => {
    const values = new Array(t.length).fill(null);
    for (const i of seenAt) values[i] = perGame[id][i] || 0;
    const avg = values.reduce((a, v) => a + (v || 0), 0) / Math.max(1, seenAt.length);
    return { placeId: Number(id), name: names[id] || "Game " + id, avg: Math.round(avg), values };
  });
  out.sort((a, b) => b.avg - a.avg);
  // Total = the sum of the game lines wherever per-game data exists, so it carries
  // exactly the same detail as the games (and always equals what the lines add up to).
  for (const i of seenAt) total[i] = out.reduce((a, g) => a + (g.values[i] || 0), 0);
  out.slice(0, CHART_LINES).forEach((g) => { g.color = colorFor(g.placeId, to); });
  saveColors();

  const body = JSON.stringify({
    days,
    from,
    to,
    firstSample: history.length ? history[0].t : null,
    t,
    total,
    lines: CHART_LINES,
    games: out
  });
  historyResponseCache[key] = { at: to, body };
  return body;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2"
};

// Security headers sent with every response.
// NOTE: script-src allows the one small inline <script> in each page's <head> by its SHA-256 hash.
// If you edit that inline script, recompute the hash (or the motion class simply won't be set;
// the site still works, just without animations).
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: https://*.rbxcdn.com; font-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; script-src 'self' 'sha256-3ZVB5gGkqqft3oRsSFkYwyQZ0gZ8JTOOusCSdEmxp7k='; connect-src 'self'; " +
    "frame-ancestors 'self'; base-uri 'self'; form-action 'self' mailto:; object-src 'none'"
};

// ---- helpers -------------------------------------------------

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...SECURITY_HEADERS
  });
  res.end(body);
}

async function fetchJson(url, timeoutMs = 12000, tries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "ZapWorks/1.0 (+https://zap-works.com)",
          "Accept": "application/json"
        }
      });
      if (r.status === 429 || r.status >= 500) {
        lastErr = new Error(`HTTP ${r.status} (retry) for ${url}`);
        await sleep(600 * Math.pow(2, attempt));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.json();
    } catch (err) {
      if (err && err.name === "AbortError") lastErr = new Error("timeout");
      else lastErr = err;
      if (attempt < tries - 1) await sleep(500 * Math.pow(2, attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run an async fn over items with limited concurrency.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (err) {
        out[idx] = { __err: err && err.message };
      }
    }
  }
  const workers = Array(Math.min(limit, items.length || 1)).fill(null).map(worker);
  await Promise.all(workers);
  return out;
}

// ---- data sources --------------------------------------------

// Cache: placeId -> universeId (resolved once, reused across refreshes)
const universeCache = {};

// ---- persistent cache (fast restarts / warm-up) ------------------
const CACHE_UNIVERSES = path.join(DATA_DIR, "universes.json");
const CACHE_GROUPS = path.join(DATA_DIR, "groups.json");
const CACHE_GAMES = path.join(DATA_DIR, "games.json");
const CACHE_STATS = path.join(DATA_DIR, "stats.json");

function loadJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : fallback;
  } catch (err) {
    return fallback;
  }
}

function saveJson(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj));
  } catch (err) {
    // non-fatal
  }
}

async function resolveUniverse(placeId) {
  if (placeId in universeCache) return universeCache[placeId];
  try {
    const d = await fetchJson(
      `https://apis.roblox.com/universes/v1/places/${placeId}/universe`,
      8000,
      3
    );
    const uid = d && d.universeId;
    universeCache[placeId] = uid;
    return uid;
  } catch (err) {
    universeCache[placeId] = undefined;
    return undefined;
  }
}

// Cache: universeId -> { url, at } for 768x432 game screenshots
const bannerCache = {};
const BANNER_TTL = 6 * 60 * 60 * 1000;
const CACHE_BANNERS = path.join(DATA_DIR, "banners.json");

async function getBanners(univIds) {
  const now = Date.now();
  const need = univIds.filter((u) => !bannerCache[u] || now - bannerCache[u].at > BANNER_TTL);
  for (let i = 0; i < need.length; i += 50) {
    try {
      const data = await fetchJson(
        `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${need
          .slice(i, i + 50)
          .join(",")}&countPerUniverse=1&defaults=true&size=768x432&format=Webp&isCircular=false`
      );
      for (const d of (data && data.data) || []) {
        const t = d && Array.isArray(d.thumbnails) ? d.thumbnails[0] : null;
        if (t && t.state === "Completed" && t.imageUrl) bannerCache[d.universeId] = { url: t.imageUrl, at: now };
      }
    } catch (err) {
      // banners are optional; the site falls back to the square icon
    }
  }
  if (need.length) saveJson(CACHE_BANNERS, bannerCache);
}

// Cache: placeId -> last known play/visit stats (fallback on a failed refresh)
const gameStatsCache = {};

async function getGames() {
  // 1) resolve each placeId to a universeId (cached + persisted)
  const resolved = await mapLimit(games, 10, async (g) => ({
    ...g,
    universeId: await resolveUniverse(g.placeId)
  }));
  saveJson(CACHE_UNIVERSES, universeCache);

  // 2) batch-fetch play stats + visits + owner by universeId (up to 100 per call)
  const statsByUniverse = {};
  const univIds = resolved.filter((g) => g.universeId).map((g) => g.universeId);
  for (let i = 0; i < univIds.length; i += 100) {
    const chunk = univIds.slice(i, i + 100).join(",");
    try {
      const data = await fetchJson(
        `https://games.roblox.com/v1/games?universeIds=${chunk}`
      );
      for (const d of (data && data.data) || []) {
        if (d && d.id != null) statsByUniverse[d.id] = d;
      }
    } catch (err) {
      // keep going; individual games will fall back to name-only / last-known
    }
  }

  // 3) batch-fetch real thumbnails by placeId (cached for an hour)
  const thumbCache = {};
  for (const g of games) {
    if (gameStatsCache[g.placeId] && gameStatsCache[g.placeId].thumbnail) {
      thumbCache[g.placeId] = gameStatsCache[g.placeId].thumbnail;
    }
  }
  const missing = games
    .map((g) => g.placeId)
    .filter((id) => !thumbCache[id]);
  for (let i = 0; i < missing.length; i += 100) {
    try {
      const data = await fetchJson(
        `https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${missing
          .slice(i, i + 100)
          .join(",")}&size=512x512&format=Webp&isCircular=false`
      );
      for (const d of (data && data.data) || []) {
        if (d && d.targetId != null && d.state === "Completed" && d.imageUrl) {
          thumbCache[d.targetId] = d.imageUrl;
        }
      }
    } catch (err) {
      // thumbnails are optional; fall back to gradient art
    }
  }

  // 4) wide 16:9 game screenshots for the portfolio (cached for a few hours)
  await getBanners(univIds);

  return games.map((g) => {
    const uid = universeCache[g.placeId];
    const d = uid != null ? statsByUniverse[uid] : null;
    const owner = d && d.creator ? d.creator.name : null;
    const now = {
      placeId: g.placeId,
      name: g.name,
      live: !!d,
      playing: d ? d.playing || 0 : null,
      visits: d ? d.visits || 0 : null,
      favorited: d ? d.favoritedCount || null : null,
      creator: owner,
      creatorVerified: d && d.creator ? !!d.creator.hasVerifiedBadge : false,
      creatorGroupId: d && d.creator && d.creator.type === "Group" ? d.creator.id : null,
      creatorLink: owner
        ? (d.creator.type === "Group"
            ? `https://www.roblox.com/communities/${d.creator.id}`
            : `https://www.roblox.com/users/${d.creator.id}/profile`)
        : null,
      thumbnail: thumbCache[g.placeId] || null,
      banner: uid != null && bannerCache[uid] ? bannerCache[uid].url : null,
      universeId: uid != null ? uid : null,
      link: `https://www.roblox.com/games/${g.placeId}`
    };
    // remember last good values so a failed refresh never zeroes the board
    if (now.live) {
      gameStatsCache[g.placeId] = {
        playing: now.playing,
        visits: now.visits,
        favorited: now.favorited,
        creator: now.creator,
        creatorVerified: now.creatorVerified,
        creatorLink: now.creatorLink,
        creatorGroupId: now.creatorGroupId,
        thumbnail: now.thumbnail
      };
    } else if (gameStatsCache[g.placeId]) {
      Object.assign(now, gameStatsCache[g.placeId], { live: true });
    }
    return now;
  });
}

// Cache: groupId -> { members, name, at } (member counts change slowly; refresh hourly)
const groupCache = {};
const GROUP_TTL = 5 * 60 * 1000; // refresh member counts every 5 minutes
const groupIconCache = {};

// Every group in data.js, plus every group that owns one of the tracked games
// (so adding a game automatically counts its group). Duplicates are removed.
function trackedGroups(gameList) {
  const list = groups.map((g) => ({ groupId: Number(g.groupId), name: g.name }));
  const seen = new Set(list.map((g) => g.groupId));
  for (const game of gameList || []) {
    const id = Number(game.creatorGroupId);
    if (id && !seen.has(id)) {
      seen.add(id);
      list.push({ groupId: id, name: game.creator || "Roblox group", fromGame: true });
    }
  }
  return list;
}

async function getGroupIcons(list) {
  const ids = list.map((g) => g.groupId).filter((id) => !groupIconCache[id]);
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const data = await fetchJson(
        `https://thumbnails.roblox.com/v1/groups/icons?groupIds=${ids
          .slice(i, i + 100)
          .join(",")}&size=150x150&format=Webp&isCircular=false`
      );
      for (const d of (data && data.data) || []) {
        if (d && d.targetId != null && d.state === "Completed" && d.imageUrl) {
          groupIconCache[d.targetId] = d.imageUrl;
        }
      }
    } catch (err) {
      // icons are optional; fall back to gradient badge
    }
  }
  return groupIconCache;
}

async function getGroups(gameList) {
  const now = Date.now();
  const results = [];
  const stale = [];
  const list = trackedGroups(gameList);

  for (const g of list) {
    const c = groupCache[g.groupId];
    const link = `https://www.roblox.com/communities/${g.groupId}`;
    if (c && now - c.at < GROUP_TTL) {
      results.push({
        groupId: g.groupId,
        name: c.name || g.name,
        live: true,
        members: c.members,
        verified: !!c.verified,
        link
      });
    } else {
      stale.push(g);
    }
  }

  // fetch stale groups slowly (low concurrency + stagger) to dodge rate limits
  let p = 0;
  async function worker() {
    while (p < stale.length) {
      const g = stale[p++];
      const link = `https://www.roblox.com/communities/${g.groupId}`;
      try {
        const d = await fetchJson(`https://groups.roblox.com/v1/groups/${g.groupId}`, 8000, 3);
        const members = d.memberCount || 0;
        groupCache[g.groupId] = { members, name: d.name || g.name, verified: !!d.hasVerifiedBadge, at: now };
        results.push({ groupId: g.groupId, name: d.name || g.name, live: true, members, verified: !!d.hasVerifiedBadge, link });
      } catch (err) {
        const c = groupCache[g.groupId];
        results.push({
          groupId: g.groupId,
          name: (c && c.name) || g.name,
          live: !!c,
          members: c ? c.members : null,
          verified: !!(c && c.verified),
          link
        });
      }
      await sleep(150);
    }
  }
  await Promise.all(Array(Math.min(4, stale.length || 1)).fill(null).map(worker));

  // attach real group icons (cached)
  const icons = await getGroupIcons(list);
  for (const r of results) r.icon = icons[r.groupId] || null;

  return results;
}

async function getDiscord() {
  return mapLimit(discord, 6, async (s, i) => {
    const invite = `https://discord.gg/${s.code}`;
    try {
      const d = await fetchJson(
        `https://discord.com/api/v9/invites/${s.code}?with_counts=true`
      );
      const guild = d && d.guild;
      return {
        code: s.code,
        name: (guild && guild.name) || s.name,
        live: true,
        members: d.approximate_member_count ?? null,
        online: d.approximate_presence_count ?? null,
        invite,
        icon: guild && guild.icon
          ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`
          : null
      };
    } catch (err) {
      return { code: s.code, name: s.name, live: false, members: null, invite };
    }
  });
}

// ---- aggregator ----------------------------------------------

async function buildStats() {
  const gameList = await getGames();
  const groupList = await getGroups(gameList);

  gameList.sort((a, b) => (b.playing || 0) - (a.playing || 0));
  groupList.sort((a, b) => (b.members || 0) - (a.members || 0));

  const totalPlaying = gameList.reduce((s, g) => s + (g.playing || 0), 0);
  const totalVisits = gameList.reduce((s, g) => s + (g.visits || 0), 0);
  const totalMembers = groupList.reduce((s, g) => s + (g.members || 0), 0);
  const peakPlaying = Math.max(0, ...gameList.map((g) => g.playing || 0));

  sampleHistory(totalPlaying, perGamePlaying(gameList));

  // persist warm caches so restarts + future loads are instant
  saveJson(CACHE_UNIVERSES, universeCache);
  saveJson(CACHE_GROUPS, groupCache);
  saveJson(CACHE_GAMES, gameStatsCache);

  return {
    meta: {
      fetchedAt: Date.now(),
      totalPlaying,
      totalVisits,
      totalMembers,
      peakPlaying,
      gameCount: gameList.length,
      groupCount: groupList.length
    },
    games: gameList,
    groups: groupList,
    discord: []
  };
}

async function statsHandler(res) {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) return json(res, 200, cache);
  try {
    const stats = await warm();
    return json(res, 200, stats || cache);
  } catch (err) {
    // serve the last good copy if we have one, else a clean error
    if (cache) return json(res, 200, cache);
    return json(res, 500, { error: err && err.message });
  }
}


// ---- contact form -> Discord webhook --------------------------------
// Set DISCORD_WEBHOOK_URL in Railway (Variables). Without it the endpoint answers 503
// and the site falls back to opening the visitor's email app.
const CONTACT_SUBJECTS = new Set([
  "General inquiry",
  "Business / Sponsorship",
  "Partnership",
  "Selling a game or group",
  "Join the team"
]);
const CONTACT_LIMIT = { perIp: 5, global: 40, windowMs: 10 * 60 * 1000 };
const contactHits = new Map(); // ip -> [timestamps]
let contactGlobal = [];

function webhookUrl() {
  const u = (process.env.DISCORD_WEBHOOK_URL || "").trim();
  return /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(u) ? u : "";
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "unknown";
}

function rateLimited(ip) {
  const now = Date.now();
  const cutoff = now - CONTACT_LIMIT.windowMs;
  contactGlobal = contactGlobal.filter((t) => t > cutoff);
  const mine = (contactHits.get(ip) || []).filter((t) => t > cutoff);
  if (mine.length >= CONTACT_LIMIT.perIp || contactGlobal.length >= CONTACT_LIMIT.global) {
    contactHits.set(ip, mine);
    return true;
  }
  mine.push(now);
  contactHits.set(ip, mine);
  contactGlobal.push(now);
  if (contactHits.size > 5000) contactHits.clear(); // memory guard
  return false;
}

// strip control characters and defuse @everyone / @here
function clean(str, max) {
  return String(str == null ? "" : str)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/@(everyone|here)/gi, "@\u200b$1")
    .trim()
    .slice(0, max);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        req.removeAllListeners("data");
        req.resume(); // drain the rest without storing it
        reject(new Error("too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function contactHandler(req, res) {
  const url = webhookUrl();
  if (!url) return json(res, 503, { ok: false, error: "not_configured" });
  if (!/application\/json/i.test(req.headers["content-type"] || "")) {
    return json(res, 415, { ok: false, error: "bad_type" });
  }

  let data;
  try {
    data = JSON.parse(await readBody(req, 16 * 1024));
  } catch (err) {
    if (err.message === "too_large") return json(res, 413, { ok: false, error: "too_large" });
    return json(res, 400, { ok: false, error: "bad_request" });
  }
  if (!data || typeof data !== "object") return json(res, 400, { ok: false, error: "bad_request" });

  // honeypot: real visitors never fill this hidden field; pretend success for bots
  if (data.website) return json(res, 200, { ok: true });

  const name = clean(data.name, 120);
  const email = clean(data.email, 200);
  const subject = CONTACT_SUBJECTS.has(data.subject) ? data.subject : "General inquiry";
  const message = clean(data.message, 3800);
  const page = clean(data.page, 60);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || message.length < 10 || data.age13 !== true) {
    return json(res, 422, { ok: false, error: "invalid" });
  }
  if (rateLimited(clientIp(req))) return json(res, 429, { ok: false, error: "rate_limited" });

  const payload = {
    username: "zap-works.com",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: subject,
        description: message,
        color: 0x5b6cff,
        fields: [
          { name: "Name", value: name, inline: true },
          { name: "Email", value: email, inline: true },
          { name: "Sent from", value: page || "/contact", inline: true },
          { name: "Age", value: "Confirmed 13+", inline: true }
        ],
        timestamp: new Date().toISOString(),
        footer: { text: "Website contact form" }
      }
    ]
  };

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url + "?wait=true", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "ZapWorks/1.0 (+https://zap-works.com)" },
      body: JSON.stringify(payload),
      signal: ctl.signal
    });
    clearTimeout(timer);
    if (!r.ok) {
      console.warn(`[ZapWorks] Discord webhook answered ${r.status}`);
      return json(res, 502, { ok: false, error: "upstream" });
    }
    return json(res, 200, { ok: true });
  } catch (err) {
    console.warn(`[ZapWorks] Discord webhook failed: ${err.message}`);
    return json(res, 502, { ok: false, error: "upstream" });
  }
}

// ---- static file serving -------------------------------------

// clean URLs: / -> index, /games -> games.html, etc.
const ROUTES = {
  "/": "/index.html",
  "/games": "/games.html",
  "/groups": "/groups.html",
  "/partner": "/partner.html",
  "/careers": "/careers.html",
  "/contact": "/contact.html",
  "/privacy": "/privacy.html",
  "/terms": "/terms.html"
};
// old .html addresses permanently redirect to the clean URL (keeps links + SEO consistent)
const LEGACY = {
  "/index.html": "/",
  "/games.html": "/games",
  "/groups.html": "/groups",
  "/partner.html": "/partner",
  "/careers.html": "/careers",
  "/contact.html": "/contact",
  "/privacy.html": "/privacy",
  "/terms.html": "/terms",
  // the old About page became the Partner page
  "/about": "/partner",
  "/about.html": "/partner"
};
// never serve server internals, cached API data or dotfiles
const BLOCKED = /^\/(server\.js|data\.js|package(-lock)?\.json|data\/|node_modules\/|\.)/i;
const ROOT_PREFIX = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".txt", ".xml", ".webmanifest"]);

function cacheControlFor(rel, ext) {
  if (ext === ".html") return "no-cache";
  if (rel.startsWith("/fonts/") || rel.startsWith("/js/vendor/") || rel.startsWith("/images/")) {
    return "public, max-age=2592000"; // 30 days
  }
  return "public, max-age=3600, must-revalidate"; // css/js are versioned with ?v= in the HTML
}

function sendFile(req, res, filePath, status, rel) {
  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": cacheControlFor(rel, ext),
    ...SECURITY_HEADERS
  };
  const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (gzip) {
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
  }
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => res.end());
  if (gzip) stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
  else stream.pipe(res);
}

function notFound(req, res) {
  const page = path.join(ROOT, "404.html");
  fs.stat(page, (err, stat) => {
    if (!err && stat.isFile()) return sendFile(req, res, page, 404, "/404.html");
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
    res.end("Not found");
  });
}

function serveStatic(req, res, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch (err) {
    res.writeHead(400, SECURITY_HEADERS);
    return res.end("Bad request");
  }

  if (Object.prototype.hasOwnProperty.call(LEGACY, rel)) {
    const qs = urlPath.includes("?") ? urlPath.slice(urlPath.indexOf("?")) : "";
    res.writeHead(301, { Location: LEGACY[rel] + qs, ...SECURITY_HEADERS });
    return res.end();
  }
  // trailing slash on a clean route: /games/ -> /games
  if (rel.length > 1 && rel.endsWith("/") && ROUTES[rel.slice(0, -1)]) {
    res.writeHead(301, { Location: rel.slice(0, -1), ...SECURITY_HEADERS });
    return res.end();
  }
  if (Object.prototype.hasOwnProperty.call(ROUTES, rel)) rel = ROUTES[rel];
  if (rel === "/404.html" || BLOCKED.test(rel) || rel.includes("\0")) return notFound(req, res);

  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT_PREFIX)) return notFound(req, res);

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return notFound(req, res);
    sendFile(req, res, filePath, 200, rel);
  });
}

// ---- server ---------------------------------------------------

const server = http.createServer((req, res) => {
  const urlPath = req.url || "/";

  if (req.method === "GET" && urlPath.split("?")[0] === "/api/history") {
    const m = /[?&]days=(\d+)/.exec(urlPath);
    const days = [1, 7, 30].includes(Number(m && m[1])) ? Number(m[1]) : 1;
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS
    });
    return res.end(historySeries(days));
  }
  if (req.method === "GET" && urlPath.startsWith("/api/stats")) {
    return statsHandler(res);
  }
  if (urlPath.split("?")[0] === "/api/contact") {
    if (req.method !== "POST") {
      res.writeHead(405, { Allow: "POST", ...SECURITY_HEADERS });
      return res.end();
    }
    return contactHandler(req, res).catch(() => json(res, 500, { ok: false, error: "server" }));
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", ...SECURITY_HEADERS });
    return res.end();
  }

  return serveStatic(req, res, urlPath);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`[ZapWorks] Port ${PORT} is in use. Try: PORT=4000 npm start`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[ZapWorks] Live stats server running on ${PORT}`);
  console.log(`[ZapWorks] Data folder: ${DATA_DIR}${process.env.RAILWAY_VOLUME_MOUNT_PATH ? " (Railway volume)" : ""} · ${history.length} history points loaded`);
  console.log(`[ZapWorks] Contact form → Discord: ${webhookUrl() ? "on" : "off (set DISCORD_WEBHOOK_URL)"}`);
  console.log(`[ZapWorks] Tracking ${games.length} games, ${groups.length} listed groups + every group that owns a tracked game, ${discord.length} Discord servers`);
});

// Hydrate warm caches from disk on startup for instant restarts.
Object.assign(universeCache, loadJson(CACHE_UNIVERSES, {}));
Object.assign(groupCache, loadJson(CACHE_GROUPS, {}));
Object.assign(gameStatsCache, loadJson(CACHE_GAMES, {}));
Object.assign(bannerCache, loadJson(CACHE_BANNERS, {}));

// Serve the last saved stats immediately (so there is no "Loading..." on cold start).
const persistedStats = loadJson(CACHE_STATS, null);
if (persistedStats && persistedStats.games) {
  cache = persistedStats;
  cacheTime = Date.now();
  console.log("[ZapWorks] Serving last saved stats while refreshing...");
}

// Coalesced build-warm-up: many concurrent requests share one fetch.
let warming = null;
function warm() {
  if (warming) return warming;
  warming = buildStats()
    .then((s) => {
      cache = s;
      cacheTime = Date.now();
      warming = null;
      saveJson(CACHE_STATS, s);
      console.log(`[ZapWorks] Cache warmed (${s.games.length} games, ${s.groups.length} groups)`);
      return s;
    })
    .catch((e) => {
      warming = null;
      throw e;
    });
  return warming;
}

// Start warming in the background right after boot.
warm().catch(() => {});

// 24/7 tracking: refresh from Roblox on a fixed timer so history is recorded
// even when nobody is on the site (the cache + history stay up to date always).
setInterval(() => {
  warm().catch(() => {});
}, SAMPLE_MS);

// Also nudge the latest history point between refreshes.
setInterval(() => {
  if (cache && cache.meta) sampleHistory(cache.meta.totalPlaying, perGamePlaying(cache.games));
}, 30000);
