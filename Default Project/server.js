// =========================================================
// Zap Works — tiny live stats server
// Serves the static site AND /api/stats which pulls live
// data from Roblox (games + groups) and Discord.
//
//   Run:  npm start   (or: node server.js)
//   Sites at: http://localhost:3000
// =========================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const { games, groups, discord } = require("./data.js");

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const CACHE_TTL = 15 * 1000; // refresh at most every 15s (keeps under rate limits)

let cache = null;
let cacheTime = 0;

// ---- live graph history ------------------------------------
// We sample the total live-player count on each refresh and keep a
// running series so the front-end can draw a real (growing) graph
// like Roblox's activity chart. Persisted so it survives restarts.
const HISTORY_FILE = path.join(ROOT, "data", "history.json");
const HISTORY_MAX = 160; // ~2.5 hours at 1 sample/minute
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

function sampleHistory(value) {
  const now = Date.now();
  if (history.length && now - history[history.length - 1].t < 20000) {
    // update the most recent point in-place (keeps points from piling up
    // during rapid refreshes) instead of always adding a new one
    history[history.length - 1].v = value;
  } else {
    history.push({ t: now, v: value });
    // seed a baseline point so the graph is never blank on first load
    if (history.length === 1) history.unshift({ t: now - 60000, v: value });
    if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
  }
  saveHistory();
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
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};

// ---- helpers -------------------------------------------------

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
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
          "User-Agent": "ZapWorks/1.0 (+https://zap.example)",
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
const CACHE_UNIVERSES = path.join(ROOT, "data", "universes.json");
const CACHE_GROUPS = path.join(ROOT, "data", "groups.json");
const CACHE_GAMES = path.join(ROOT, "data", "games.json");

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
          .join(",")}&size=512x512&format=Png&isCircular=false`
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
      creatorLink: owner
        ? (d.creator.type === "Group"
            ? `https://www.roblox.com/communities/${d.creator.id}`
            : `https://www.roblox.com/users/${d.creator.id}/profile`)
        : null,
      thumbnail: thumbCache[g.placeId] || null,
      link: `https://www.roblox.com/games/${g.placeId}`
    };
    // remember last good values so a failed refresh never zeroes the board
    if (now.live) {
      gameStatsCache[g.placeId] = {
        playing: now.playing,
        visits: now.visits,
        favorited: now.favorited,
        creator: now.creator,
        creatorLink: now.creatorLink,
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

async function getGroupIcons() {
  const ids = groups.map((g) => g.groupId).filter((id) => !groupIconCache[id]);
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const data = await fetchJson(
        `https://thumbnails.roblox.com/v1/groups/icons?groupIds=${ids
          .slice(i, i + 100)
          .join(",")}&size=150x150&format=Png&isCircular=false`
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

async function getGroups() {
  const now = Date.now();
  const results = [];
  const stale = [];

  for (const g of groups) {
    const c = groupCache[g.groupId];
    const link = `https://www.roblox.com/communities/${g.groupId}`;
    if (c && now - c.at < GROUP_TTL) {
      results.push({
        groupId: g.groupId,
        name: c.name || g.name,
        live: true,
        members: c.members,
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
        groupCache[g.groupId] = { members, name: d.name || g.name, at: now };
        results.push({ groupId: g.groupId, name: d.name || g.name, live: true, members, link });
      } catch (err) {
        const c = groupCache[g.groupId];
        results.push({
          groupId: g.groupId,
          name: (c && c.name) || g.name,
          live: !!c,
          members: c ? c.members : null,
          link
        });
      }
      await sleep(150);
    }
  }
  await Promise.all(Array(Math.min(4, stale.length || 1)).fill(null).map(worker));

  // attach real group icons (cached)
  const icons = await getGroupIcons();
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
  const [gameList, groupList] = await Promise.all([getGames(), getGroups()]);

  gameList.sort((a, b) => (b.playing || 0) - (a.playing || 0));
  groupList.sort((a, b) => (b.members || 0) - (a.members || 0));

  const totalPlaying = gameList.reduce((s, g) => s + (g.playing || 0), 0);
  const totalVisits = gameList.reduce((s, g) => s + (g.visits || 0), 0);
  const totalMembers = groupList.reduce((s, g) => s + (g.members || 0), 0);
  const peakPlaying = Math.max(0, ...gameList.map((g) => g.playing || 0));

  sampleHistory(totalPlaying);

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
    history,
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

// ---- static file serving -------------------------------------

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);

  // clean URLs: / -> index, /games -> games.html, etc.
  const ROUTES = {
    "/": "/index.html",
    "/games": "/games.html",
    "/about": "/about.html",
    "/contact": "/contact.html"
  };
  if (Object.prototype.hasOwnProperty.call(ROUTES, rel)) {
    rel = ROUTES[rel];
  }

  if (rel === "/" || rel === "") rel = "/index.html";

  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache, must-revalidate"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---- server ---------------------------------------------------

const server = http.createServer((req, res) => {
  const urlPath = req.url || "/";

  if (req.method === "GET" && urlPath.startsWith("/api/stats")) {
    return statsHandler(res);
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
  console.log(`[ZapWorks] Tracking ${games.length} games, ${groups.length} groups, ${discord.length} Discord servers`);
});

// Hydrate warm caches from disk on startup for instant restarts.
Object.assign(universeCache, loadJson(CACHE_UNIVERSES, {}));
Object.assign(groupCache, loadJson(CACHE_GROUPS, {}));
Object.assign(gameStatsCache, loadJson(CACHE_GAMES, {}));

// Coalesced build-warm-up: many concurrent requests share one fetch.
let warming = null;
function warm() {
  if (warming) return warming;
  warming = buildStats()
    .then((s) => {
      cache = s;
      cacheTime = Date.now();
      warming = null;
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

// Keep the activity graph advancing even between refreshes (sample last known total).
setInterval(() => {
  if (cache && cache.meta) sampleHistory(cache.meta.totalPlaying);
}, 30000);
