// =========================================================
// Zap Works — live stats consumer + renderer
// Pulls /api/stats from the Node server and fills the page.
// Falls back to window.ZAP_DATA (names only, no numbers).
// =========================================================

(function () {
  const ART = ["art-a", "art-b", "art-c", "art-d", "art-e", "art-f"];
  const GRADS = [
    "linear-gradient(135deg,#2f6bff,#7a4bff)",
    "linear-gradient(135deg,#ff5f6d,#ffc371)",
    "linear-gradient(135deg,#11998e,#38ef7d)",
    "linear-gradient(135deg,#f7971e,#ffd200)",
    "linear-gradient(135deg,#8e2de2,#4a00e0)",
    "linear-gradient(135deg,#43cea2,#185a9d)"
  ];
  const CHECK =
    '<span class="check"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2l2.4 2.4 3.4-.4.9 3.3 3 1.6-1.3 3.1 1.3 3.1-3 1.6-.9 3.3-3.4-.4L12 22l-2.4-2.4-3.4.4-.9-3.3-3-1.6 1.3-3.1-1.3-3.1 3-1.6.9-3.3 3.4.4z"/></svg></span>';

  function fmt(n) {
    if (n == null) return "--";
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function fmtFull(n) {
    return n == null ? "--" : n.toLocaleString();
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function initials(name) {
    return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  }

  function sortGames(games, mode) {
    const arr = games.slice();
    if (mode === "least") arr.sort((a, b) => (a.playing || 0) - (b.playing || 0));
    else arr.sort((a, b) => (b.playing || 0) - (a.playing || 0));
    return arr;
  }

  function gameCardHTML(g, i) {
    const art = g.thumbnail
      ? '<div class="game-card__art game-card__art--img" style="background-image:url(' + "'" + esc(g.thumbnail) + "'" + ')"></div>'
      : '<div class="game-card__art ' + ART[i % ART.length] + '"></div>';
    return (
      '<a class="game-card" href="' + esc(g.link) + '" target="_blank" rel="noopener" data-players="' + (g.playing || 0) + '">' +
        art +
        '<div class="game-card__players"><span class="live"></span>' + fmt(g.playing) + "</div>" +
        '<div class="game-card__body">' +
          '<div class="game-card__title">' + esc(g.name) + "</div>" +
          '<div class="game-card__by">By ' + esc(g.creator || "Zap Works") + " " + CHECK + "</div>" +
          '<div class="game-card__visits">' + fmt(g.visits) + " visits</div>" +
        "</div>" +
      "</a>"
    );
  }

  function groupCardHTML(g, i) {
    return (
      '<a class="group-card" href="' + esc(g.link) + '" target="_blank" rel="noopener">' +
        '<span class="group-card__badge" style="background:' + GRADS[i % GRADS.length] + '">' + esc(initials(g.name)) + "</span>" +
        '<span class="group-card__info">' +
          '<span class="group-card__name">' + esc(g.name) + "</span>" +
          '<span class="group-card__members">' + fmt(g.members) + " members</span>" +
        "</span>" +
        '<span class="group-card__chev">›</span>' +
      "</a>"
    );
  }

  function discordCardHTML(s, i) {
    const badge = s.icon
      ? '<span class="discord-card__badge" style="background-image:url(' + esc(s.icon) + ')"></span>'
      : '<span class="discord-card__badge" style="background:' + GRADS[i % GRADS.length] + '">' + esc(initials(s.name)) + "</span>";
    return (
      '<a class="group-card" href="' + esc(s.invite) + '" target="_blank" rel="noopener">' +
        badge +
        '<span class="group-card__info">' +
          '<span class="group-card__name">' + esc(s.name) + "</span>" +
          '<span class="group-card__members">' + fmt(s.members) + " members · " + fmt(s.online) + " online</span>" +
        "</span>" +
        '<span class="group-card__chev">›</span>' +
      "</a>"
    );
  }

  function renderGrid(el, items, cardHTML) {
    if (!el) return;
    el.innerHTML = items.map(cardHTML).join("");
  }

  function renderGroups(el, groups) {
    if (!el) return;
    el.innerHTML = groups.map(groupCardHTML).join("");
  }

  function renderStats(meta) {
    set("statMembers", fmtFull(meta.totalMembers));
    set("statPlaying", fmtFull(meta.totalPlaying));
    set("statVisits", fmtFull(meta.totalVisits));
    set("statGames", String(meta.gameCount));
    set("liveCurrent", fmtFull(meta.totalPlaying));
    set("livePeak", fmtFull(meta.peakPlaying));
    set("liveVisits", fmt(meta.totalVisits));
    set("liveCount", fmt(meta.gameCount));
  }

  function set(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function allDiscordEmpty(d) {
    return !Array.isArray(d) || d.length === 0;
  }

  // ---- real activity graph (time on x-axis, players on left) ----
  function niceStep(raw, ticks) {
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag;
    let step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    return step * mag;
  }

  function smoothPath(pts) {
    if (pts.length < 2) return "";
    let d = "M " + pts[0][0] + " " + pts[0][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += " C " + c1x.toFixed(2) + " " + c1y.toFixed(2) + ", " + c2x.toFixed(2) + " " + c2y.toFixed(2) + ", " + p2[0].toFixed(2) + " " + p2[1].toFixed(2);
    }
    return d;
  }

  function renderGraph(history) {
    const el = document.getElementById("liveChart");
    if (!el) return;
    const chart = el.closest(".live-chart");
    const ylabels = chart ? chart.querySelector(".live-chart__ylabels") : null;
    const axis = chart ? chart.querySelector(".live-chart__axis") : null;
    const NS = "http://www.w3.org/2000/svg";

    const points = (history || []).filter((p) => p && typeof p.v === "number");
    if (points.length < 2) {
      el.innerHTML = '<div class="grid-empty">Collecting live data…</div>';
      if (ylabels) ylabels.innerHTML = "";
      if (axis) axis.innerHTML = "";
      return;
    }

    const W = 800;
    const H = 260;
    const PAD = 12;
    const ticks = 5;

    const maxV = Math.max(1, ...points.map((p) => p.v));
    const step = niceStep(maxV / (ticks - 1), ticks);
    const top = Math.max(step * (ticks - 1), maxV);

    const minT = points[0].t;
    const maxT = points[points.length - 1].t;
    const rangeT = Math.max(1, maxT - minT);

    const pts = points.map((p) => {
      const x = ((p.t - minT) / rangeT) * W;
      const y = H - PAD - (p.v / top) * (H - PAD * 2);
      return [x, y];
    });

    const lineD = smoothPath(pts);
    const areaD = lineD + " L " + W + " " + H + " L 0 " + H + " Z";

    el.innerHTML = "";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");

    const defs = document.createElementNS(NS, "defs");
    defs.innerHTML =
      '<linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#2f6bff" stop-opacity="0.35"/>' +
        '<stop offset="100%" stop-color="#2f6bff" stop-opacity="0"/>' +
      "</linearGradient>" +
      '<linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0%" stop-color="#2f6bff"/>' +
        '<stop offset="100%" stop-color="#35e0ff"/>' +
      "</linearGradient>";
    svg.appendChild(defs);

    const grid = document.createElementNS(NS, "g");
    grid.setAttribute("class", "live-chart__grid");
    grid.setAttribute("vector-effect", "non-scaling-stroke");
    for (let v = step; v <= top; v += step) {
      const y = H - PAD - (v / top) * (H - PAD * 2);
      const line = document.createElementNS(NS, "line");
      line.setAttribute("x1", 0);
      line.setAttribute("x2", W);
      line.setAttribute("y1", y);
      line.setAttribute("y2", y);
      grid.appendChild(line);
    }
    svg.appendChild(grid);

    const area = document.createElementNS(NS, "path");
    area.setAttribute("d", areaD);
    area.setAttribute("class", "live-chart__area");
    svg.appendChild(area);

    const line = document.createElementNS(NS, "path");
    line.setAttribute("d", lineD);
    line.setAttribute("class", "live-chart__line");
    svg.appendChild(line);

    const last = pts[pts.length - 1];
    const halo = document.createElementNS(NS, "circle");
    halo.setAttribute("class", "live-chart__halo");
    halo.setAttribute("cx", last[0]);
    halo.setAttribute("cy", last[1]);
    halo.setAttribute("r", 14);
    svg.appendChild(halo);

    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("class", "live-chart__dot");
    dot.setAttribute("cx", last[0]);
    dot.setAttribute("cy", last[1]);
    dot.setAttribute("r", 5);
    svg.appendChild(dot);

    el.appendChild(svg);

    // y-axis labels (players, 0 on the bottom up to top)
    if (ylabels) {
      ylabels.innerHTML = "";
      for (let v = top; v >= -1e-9; v -= step) {
        const span = document.createElement("div");
        span.textContent = fmt(Math.round(v));
        ylabels.appendChild(span);
      }
    }

    // x-axis labels (time, oldest -> newest)
    if (axis) {
      axis.innerHTML = "";
      const n = Math.min(6, points.length);
      for (let i = 0; i < n; i++) {
        const idx = Math.round((i / (n - 1)) * (points.length - 1));
        const d = new Date(points[idx].t);
        axis.innerHTML += "<span>" + esc(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) + "</span>";
      }
    }
  }

  function apply(stats) {
    const games = (stats && stats.games) || window.ZAP_DATA.games;
    const groups = (stats && stats.groups) || window.ZAP_DATA.groups;
    const discord = (stats && stats.discord) || window.ZAP_DATA.discord;
    const meta = (stats && stats.meta) || null;

    renderGraph(stats ? stats.history : []);

    // Order big -> small (or Honor the active sort button on the games page)
    const sortMode = (document.querySelector(".sort-btn.active") || {}).dataset?.sort || "most";

    const fullGames = games.map((g) => ({
      placeId: g.placeId,
      name: g.name,
      playing: g.playing,
      visits: g.visits,
      creator: g.creator,
      thumbnail: g.thumbnail,
      link: g.link || "https://www.roblox.com/games/" + g.placeId
    }));

    renderGrid(document.getElementById("experiencesGrid"), sortGames(fullGames, sortMode), gameCardHTML);
    renderGrid(document.getElementById("featuredGrid"), sortGames(fullGames, "most").slice(0, 4), gameCardHTML);
    renderGroups(document.getElementById("groupsGrid"), groups);

    const dEl = document.getElementById("discordGrid");
    if (dEl) {
      if (allDiscordEmpty(discord)) {
        dEl.closest("[data-source]")?.style.setProperty("display", "none");
      } else {
        dEl.closest("[data-source]")?.style.setProperty("display", "");
        renderGrid(dEl, discord, discordCardHTML);
      }
    }

    if (meta) renderStats(meta);
  }

  async function load() {
    let stats = null;
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (res.ok) stats = await res.json();
    } catch (err) {
      stats = null; // offline / no server -> fallback names only
    }
    apply(stats);

    // refresh periodically
    setInterval(async () => {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (res.ok) apply(await res.json());
      } catch (err) {
        /* keep current */
      }
    }, 60000);
  }

  document.addEventListener("DOMContentLoaded", load);
})();
