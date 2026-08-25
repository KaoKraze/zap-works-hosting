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
const CACHE_TTL = 45 * 1000; // refresh at most every 45s (keeps under rate limits)

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

async function resolveUniverse(placeId) {
  if (placeId in universeCache) return universeCache[placeId];
  try {
    const d = await fetchJson(
      `https://apis.roblox.com/universes/v1/places/${placeId}/universe`
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
  // 1) resolve each placeId to a universeId (cached)
  const resolved = await mapLimit(games, 5, async (g) => ({
    ...g,
    universeId: await resolveUniverse(g.placeId)
  }));

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

  // 3) batch-fetch real thumbnails by placeId (up to 100 per call)
  const thumbByPlace = {};
  const placeIds = games.map((g) => g.placeId);
  for (let i = 0; i < placeIds.length; i += 100) {
    try {
      const data = await fetchJson(
        `https://thumbnails.roblox.com/v1/places/gameicons?placeIds=${placeIds
          .slice(i, i + 100)
          .join(",")}&size=512x512&format=Png&isCircular=false`
      );
      for (const d of (data && data.data) || []) {
        if (d && d.targetId != null && d.state === "Completed" && d.imageUrl) {
          thumbByPlace[d.targetId] = d.imageUrl;
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
      thumbnail: thumbByPlace[g.placeId] || null,
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
const GROUP_TTL = 60 * 60 * 1000;

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
        const d = await fetchJson(`https://groups.roblox.com/v1/groups/${g.groupId}`);
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
      await sleep(250);
    }
  }
  await Promise.all(Array(Math.min(3, stale.length || 1)).fill(null).map(worker));

  return results;
}

async function getDiscord() {
  return mapLimit(discord, 6, async (s) => {
    const invite = `https://discord.gg/${s.code}`;
    try {
      const d = await fetchJson(
        `https://discord.com/api/v9/invites/${s.code}?with_counts=true`
      );
      return {
        code: s.code,
        name: s.name,
        live: true,
        members: d.approximate_member_count ?? null,
        online: d.approximate_presence_count ?? null,
        invite,
        icon: d.guild && d.guild.icon
          ? `https://cdn.discordapp.com/icons/${d.guild.id}/${d.guild.icon}.png?size=64`
          : null
      };
    } catch (err) {
      return { code: s.code, name: s.name, live: false, members: null, invite };
    }
  });
}

// ---- aggregator ----------------------------------------------

async function buildStats() {
  const [gameList, groupList, discordList] = await Promise.all([
    getGames(),
    getGroups(),
    getDiscord()
  ]);

  gameList.sort((a, b) => (b.playing || 0) - (a.playing || 0));
  groupList.sort((a, b) => (b.members || 0) - (a.members || 0));
  discordList.sort((a, b) => (b.members || 0) - (a.members || 0));

  const totalPlaying = gameList.reduce((s, g) => s + (g.playing || 0), 0);
  const totalVisits = gameList.reduce((s, g) => s + (g.visits || 0), 0);
  const totalMembers = groupList.reduce((s, g) => s + (g.members || 0), 0);
  const peakPlaying = Math.max(0, ...gameList.map((g) => g.playing || 0));

  sampleHistory(totalPlaying);

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
    discord: discordList
  };
}

async function statsHandler(res) {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) return json(res, 200, cache);
  try {
    const stats = await buildStats();
    cache = stats;
    cacheTime = now;
    return json(res, 200, stats);
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
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
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

server.listen(PORT, () => {
  console.log(`[ZapWorks] Live stats server running at http://localhost:${PORT}`);
  console.log(`[ZapWorks] Tracking ${games.length} games, ${groups.length} groups, ${discord.length} Discord servers`);
});

// Keep the activity graph advancing even between refreshes (sample last known total).
setInterval(() => {
  if (cache && cache.meta) sampleHistory(cache.meta.totalPlaying);
}, 30000);
