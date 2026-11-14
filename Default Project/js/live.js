// =========================================================================
// Zap Works — live stats consumer + renderers
// Pulls /api/stats from the Node server (server.js) and fills the page.
// Falls back to window.ZAP_DATA (names only) when the API is unavailable.
// =========================================================================
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var POLL_MS = 15000;
  var STATS_KEY = "zap:stats:v2";

  var VERIFIED =
    '<svg class="rbx-verified" viewBox="0 0 24 24" role="img" aria-label="Verified creator"><rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#3d7bff"/><path d="M7.2 12.6l3.4 3.4L16.8 9" stroke="#ffffff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ARROW_UR =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>';

  // ------------------------------------------------------------ formatting
  function fmt(n) {
    if (n == null || isNaN(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(0) + "K";
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(Math.round(n));
  }
  function fmtFull(n) { return n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("en-US"); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) {
    // only allow http(s) image/links coming from the API
    return /^https?:\/\//i.test(u || "") ? u : "";
  }
  function byPlaying(a, b) { return (b.playing || 0) - (a.playing || 0); }
  function byVisits(a, b) { return (b.visits || 0) - (a.visits || 0); }
  function byName(a, b) { return String(a.name).localeCompare(String(b.name)); }

  function normalise(g) {
    return {
      placeId: g.placeId,
      name: g.name,
      playing: g.playing,
      visits: g.visits,
      creator: g.creator,
      creatorVerified: !!g.creatorVerified,
      thumbnail: safeUrl(g.thumbnail),
      banner: safeUrl(g.banner),
      link: safeUrl(g.link) || "https://www.roblox.com/games/" + g.placeId
    };
  }

  // -------------------------------------------------------- number tweens
  var shown = {}; // key -> last displayed value
  function tween(el, to, formatter, key) {
    var from = shown[key];
    shown[key] = to;
    if (to == null) { el.textContent = "—"; return; }
    // count up only the headline figures, not inline labels like "All 43 games"
    if (from == null && !reduceMotion && el.dataset.counted !== "1" && el.classList.contains("stat__value")) {
      el.dataset.counted = "1";
      var start = null;
      var dur = 1600;
      var startVal = 0;
      var run = function (t) {
        if (shown[key] !== to) { el.textContent = formatter(shown[key]); return; } // newer data arrived
        if (start == null) start = t;
        var p = Math.min(1, (t - start) / dur);
        var e = 1 - Math.pow(2, -10 * p); // easeOutExpo
        el.textContent = formatter(startVal + (to - startVal) * (p === 1 ? 1 : e));
        if (p < 1) requestAnimationFrame(run);
      };
      // count up when the number scrolls into view
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (ents) {
          if (ents[0].isIntersecting) { io.disconnect(); requestAnimationFrame(run); }
        }, { threshold: 0.4 });
        el.textContent = formatter(0);
        io.observe(el);
      } else {
        el.textContent = formatter(to);
      }
      return;
    }
    el.textContent = formatter(to);
    if (from != null && to !== from) {
      el.classList.remove("num-up", "num-down");
      void el.offsetWidth;
      el.classList.add(to > from ? "num-up" : "num-down");
      clearTimeout(el.__t);
      el.__t = setTimeout(function () { el.classList.remove("num-up", "num-down"); }, 2400);
    }
  }

  function renderStats(meta) {
    var map = {
      playing: [meta.totalPlaying, fmtFull],
      visits: [meta.totalVisits, fmt],
      members: [meta.totalMembers, fmt],
      games: [meta.gameCount, fmtFull],
      groups: [meta.groupCount, fmtFull]
    };
    document.querySelectorAll("[data-stat]").forEach(function (el, i) {
      var k = el.getAttribute("data-stat");
      if (!map[k]) return;
      tween(el, map[k][0], map[k][1], k + ":" + i);
    });
    setText("liveCurrent", fmtFull(meta.totalPlaying));
    setText("liveVisits", fmt(meta.totalVisits));
    setText("liveMembers", fmt(meta.totalMembers));
  }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }

  // ------------------------------------------------------------- hero wall
  function renderWall(games) {
    var wall = document.getElementById("heroWall");
    if (!wall || wall.childElementCount) return;
    var pics = games.filter(function (g) { return g.thumbnail; }).slice(0, 24);
    if (pics.length < 6) return;
    var cols = [[], [], []];
    pics.forEach(function (g, i) { cols[i % 3].push(g); });
    wall.innerHTML = cols.map(function (col) {
      var tiles = col.map(function (g) {
        return '<div class="hero__tile" style="background-image:url(\'' + esc(g.thumbnail) + '\')"></div>';
      }).join("");
      return '<div class="hero__col">' + tiles + tiles + "</div>"; // doubled for a seamless loop
    }).join("");
    // fade in once the first few tiles have loaded
    var urls = pics.slice(0, 9).map(function (g) { return g.thumbnail; });
    var left = urls.length;
    var done = function () { if (--left <= 0) wall.classList.add("is-ready"); };
    urls.forEach(function (u) { var im = new Image(); im.onload = im.onerror = done; im.src = u; });
    setTimeout(function () { wall.classList.add("is-ready"); }, 2500);
    // pause the drift when the hero is off screen (saves battery)
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (ents) {
        wall.querySelectorAll(".hero__col").forEach(function (c) {
          c.style.animationPlayState = ents[0].isIntersecting ? "running" : "paused";
        });
      }).observe(wall);
    }
  }

  // -------------------------------------------------------- home showcase
  var showcaseData = [];
  function featureHTML(g, rank) {
    var img = g.banner || g.thumbnail;
    return (
      '<div class="feature__media">' +
        (img ? '<img src="' + esc(img) + '" alt="" decoding="async" />' : "") +
      "</div>" +
      '<div class="feature__body">' +
        "<div>" +
          '<div class="feature__rank">No. ' + String(rank).padStart(2, "0") + (rank === 1 ? " · Most played now" : " · By live players") + "</div>" +
          '<div class="feature__name">' + esc(g.name) + "</div>" +
          '<div class="feature__by">By ' + esc(g.creator || "Zap Works") + (g.creatorVerified ? " " + VERIFIED : "") + "</div>" +
        "</div>" +
        '<dl class="feature__stats">' +
          '<div class="kv"><dt><span class="live-dot dot-sm" aria-hidden="true"></span>Playing</dt><dd>' + fmtFull(g.playing) + "</dd></div>" +
          '<div class="kv"><dt>Visits</dt><dd>' + fmt(g.visits) + "</dd></div>" +
        "</dl>" +
      "</div>"
    );
  }
  function setFeature(g, rank) {
    var card = document.getElementById("featureCard");
    if (!card || !g) return;
    card.classList.remove("skeleton");
    card.href = g.link;
    card.target = "_blank";
    card.rel = "noopener";
    card.setAttribute("aria-label", g.name + " on Roblox (opens in a new tab)");
    card.innerHTML = featureHTML(g, rank);
  }
  function renderShowcase(games) {
    var list = document.getElementById("rankList");
    if (!list) return;
    var top = games.slice().sort(byPlaying).slice(0, 6);
    if (!top.length) return;
    showcaseData = top;
    var activeIdx = Number(list.getAttribute("data-active") || 0);
    setFeature(top[activeIdx] || top[0], activeIdx + 1);
    list.innerHTML = top.slice(1).map(function (g, i) {
      var img = g.banner || g.thumbnail;
      return (
        '<li><a class="rank" href="' + esc(g.link) + '" target="_blank" rel="noopener" data-idx="' + (i + 1) + '">' +
          '<span class="rank__n">' + String(i + 2).padStart(2, "0") + "</span>" +
          (img ? '<img class="rank__img" src="' + esc(img) + '" alt="" loading="lazy" decoding="async" />' : '<span class="rank__img"></span>') +
          '<span><span class="rank__name">' + esc(g.name) + "</span>" +
          '<span class="rank__by">' + esc(g.creator || "Zap Works") + (g.creatorVerified ? " " + VERIFIED : "") + "</span></span>" +
          '<span class="rank__meta"><span class="rank__live"><span class="live-dot dot-sm" aria-hidden="true"></span>' + fmtFull(g.playing) + "</span>" +
          '<span class="rank__visits">' + fmt(g.visits) + " visits</span></span>" +
          '<span class="sr-only"> (opens in a new tab)</span>' +
        "</a></li>"
      );
    }).join("");
    if (!list.__bound) {
      list.__bound = true;
      var canHover = window.matchMedia("(hover: hover)").matches;
      if (canHover) {
        list.addEventListener("mouseover", function (e) {
          var row = e.target.closest(".rank");
          if (!row) return;
          var idx = Number(row.getAttribute("data-idx"));
          if (Number(list.getAttribute("data-active")) === idx) return;
          list.setAttribute("data-active", idx);
          list.querySelectorAll(".rank").forEach(function (r) { r.classList.toggle("is-active", r === row); });
          setFeature(showcaseData[idx], idx + 1);
          document.dispatchEvent(new CustomEvent("zap:feature"));
        });
        list.addEventListener("mouseleave", function () {
          list.setAttribute("data-active", 0);
          list.querySelectorAll(".rank").forEach(function (r) { r.classList.remove("is-active"); });
          setFeature(showcaseData[0], 1);
          document.dispatchEvent(new CustomEvent("zap:feature"));
        });
      }
    }
  }

  // ------------------------------------------------------- home top games
  function renderTopGames(games) {
    var el = document.getElementById("topGames");
    if (!el) return;
    var top = games.slice().sort(byPlaying).slice(0, 4);
    var ids = top.map(function (g) { return g.placeId; }).join(",");
    if (el.getAttribute("data-ids") === ids) {
      top.forEach(function (g) { // same games: refresh numbers only
        var c = el.querySelector('[data-id="' + g.placeId + '"]');
        if (!c) return;
        var p = c.querySelector('[data-k="playing"]'), v = c.querySelector('[data-k="visits"]');
        if (p) p.innerHTML = ((g.playing || 0) > 0 ? '<span class="live-dot dot-sm" aria-hidden="true"></span>' : "") + fmtFull(g.playing);
        if (v) v.textContent = fmt(g.visits);
      });
      return;
    }
    el.setAttribute("data-ids", ids);
    el.innerHTML = top.map(cardHTML).join("");
  }

  // ------------------------------------------------------------ games grid
  var gridState = { sort: "most", q: "", games: [], live: false };
  function cardHTML(g) {
    var img = g.banner || g.thumbnail;
    var live = (g.playing || 0) > 0;
    return (
      '<a class="gcard" href="' + esc(g.link) + '" target="_blank" rel="noopener" data-id="' + g.placeId + '">' +
        '<span class="gcard__media">' +
          (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" decoding="async" />' : "") +
          '<span class="gcard__open" aria-hidden="true">' + ARROW_UR + "</span>" +
        "</span>" +
        '<span class="gcard__row"><span>' +
          '<span class="gcard__name">' + esc(g.name) + "</span>" +
          '<span class="gcard__by">By ' + esc(g.creator || "Zap Works") + (g.creatorVerified ? " " + VERIFIED : "") + "</span>" +
        '</span><span class="gcard__rank" data-rank></span></span>' +
        '<span class="gcard__stats">' +
          '<span class="gcard__stat"><span>Playing</span><b data-k="playing"' + (live ? "" : ' class="is-idle"') + ">" + (live ? '<span class="live-dot dot-sm" aria-hidden="true"></span>' : "") + fmtFull(g.playing) + "</b></span>" +
          '<span class="gcard__stat"><span>Visits</span><b data-k="visits">' + fmt(g.visits) + "</b></span>" +
        "</span>" +
        '<span class="sr-only"> (opens Roblox in a new tab)</span>' +
      "</a>"
    );
  }
  function sortedGames() {
    var arr = gridState.games.slice();
    arr.sort(gridState.sort === "visits" ? byVisits : gridState.sort === "az" ? byName : byPlaying);
    return arr;
  }
  var LEAD = 6; // the first six results get large cards, the rest a compact list
  function findCard(grid, id) {
    var list = document.getElementById("experiencesList");
    return grid.querySelector('[data-id="' + id + '"]') || (list && list.querySelector('[data-id="' + id + '"]'));
  }
  function layoutGrid(grid) {
    var list = document.getElementById("experiencesList");
    var q = gridState.q.trim().toLowerCase();
    var shownCount = 0;
    sortedGames().forEach(function (g) {
      var el = findCard(grid, g.placeId);
      if (!el) return;
      var hit = !q || String(g.name).toLowerCase().indexOf(q) !== -1 || String(g.creator || "").toLowerCase().indexOf(q) !== -1;
      el.hidden = !hit;
      if (hit) {
        shownCount++;
        el.querySelector("[data-rank]").textContent = gridState.sort === "az" ? "" : String(shownCount).padStart(2, "0");
      }
      // reorder in place, splitting into the lead grid and the compact list
      (hit && shownCount <= LEAD) || !list ? grid.appendChild(el) : list.appendChild(el);
    });
    var empty = grid.querySelector(".grid-empty");
    if (!shownCount) {
      if (!empty) { empty = document.createElement("div"); empty.className = "grid-empty"; grid.appendChild(empty); }
      empty.textContent = "No games match “" + gridState.q + "”.";
    } else if (empty) empty.remove();
    if (list) list.parentElement.hidden = shownCount <= LEAD;
    var count = document.getElementById("gameCount");
    if (count) count.textContent = shownCount + (shownCount === 1 ? " game" : " games");
  }
  function renderGrid(games, isLive) {
    var grid = document.getElementById("experiencesGrid");
    if (!grid) return;
    // full (re)build on first paint and when real data replaces the name-only fallback
    var first = !gridState.games.length || !grid.querySelector(".gcard") || (isLive && !gridState.live);
    gridState.games = games;
    gridState.live = gridState.live || !!isLive;
    if (first) {
      var lst = document.getElementById("experiencesList");
      if (lst) lst.innerHTML = "";
      grid.innerHTML = sortedGames().map(cardHTML).join("");
    } else {
      // live update numbers in place, keep the user's current order
      games.forEach(function (g) {
        var el = findCard(grid, g.placeId);
        if (!el) return;
        var p = el.querySelector('[data-k="playing"]');
        var v = el.querySelector('[data-k="visits"]');
        if (p) {
          p.innerHTML = ((g.playing || 0) > 0 ? '<span class="live-dot dot-sm" aria-hidden="true"></span>' : "") + fmtFull(g.playing);
          p.classList.toggle("is-idle", !((g.playing || 0) > 0));
        }
        if (v) v.textContent = fmt(g.visits);
      });
      return;
    }
    layoutGrid(grid);
    setupGridControls(grid);
    document.dispatchEvent(new CustomEvent("zap:grid"));
  }
  function setupGridControls(grid) {
    if (grid.__bound) return;
    grid.__bound = true;
    var bar = document.getElementById("sortBar");
    if (bar) {
      bar.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-sort]");
        if (!b) return;
        bar.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        gridState.sort = b.getAttribute("data-sort");
        layoutGrid(grid);
        document.dispatchEvent(new CustomEvent("zap:grid"));
      });
    }
    var search = document.getElementById("gameSearch");
    if (search) {
      var t;
      search.addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(function () { gridState.q = search.value; layoutGrid(grid); }, 90);
      });
    }
  }

  // --------------------------------------------------------------- groups
  function renderGroups(groups) {
    var el = document.getElementById("groupsGrid");
    if (!el || !groups || !groups.length) return;
    el.innerHTML = groups.slice().sort(function (a, b) { return (b.members || 0) - (a.members || 0); }).map(function (g) {
      var icon = safeUrl(g.icon);
      var link = safeUrl(g.link) || "https://www.roblox.com/communities/" + g.groupId;
      return (
        '<a class="group" href="' + esc(link) + '" target="_blank" rel="noopener" data-reveal-item>' +
          (icon ? '<img src="' + esc(icon) + '" alt="" loading="lazy" decoding="async" />' : '<span class="group__badge"></span>') +
          '<span style="min-width:0"><span class="group__name"><span class="group__name-text">' + esc(g.name) + "</span>" + (g.verified ? VERIFIED : "") + "</span>" +
          '<span class="group__members">' + (g.members != null ? fmt(g.members) + " members" : "—") + "</span></span>" +
          '<span class="group__go" aria-hidden="true">' + ARROW_UR + "</span>" +
          '<span class="sr-only"> (opens Roblox in a new tab)</span>' +
        "</a>"
      );
    }).join("");
  }

  // ---------------------------------------------------------------- chart
  var lastHistory = [];
  var graphRangeMs = 24 * 3600 * 1000;

  function niceStep(raw) {
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var norm = raw / mag;
    return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  }
  function smoothPath(pts) {
    if (pts.length < 2) return "";
    var d = "M " + pts[0][0].toFixed(2) + " " + pts[0][1].toFixed(2);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      d += " C " + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(2) + " " + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(2) +
        ", " + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(2) + " " + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(2) +
        ", " + p2[0].toFixed(2) + " " + p2[1].toFixed(2);
    }
    return d;
  }
  function bucket(points, max) {
    if (points.length <= max) return points;
    var size = Math.ceil(points.length / max), out = [];
    for (var i = 0; i < points.length; i += size) {
      var s = points.slice(i, i + size);
      out.push({ t: s[s.length - 1].t, v: Math.round(s.reduce(function (a, p) { return a + p.v; }, 0) / s.length) });
    }
    return out;
  }
  function setupRange() {
    var bar = document.getElementById("liveRange");
    if (!bar || bar.__bound) return;
    bar.__bound = true;
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-range]");
      if (!b) return;
      bar.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      graphRangeMs = (parseInt(b.getAttribute("data-range"), 10) || 1) * 24 * 3600 * 1000;
      renderGraph();
    });
  }
  function renderGraph() {
    var el = document.getElementById("liveChart");
    if (!el) return;
    var chart = el.closest(".live-chart");
    var ylabels = chart.querySelector(".live-chart__ylabels");
    var axis = chart.querySelector(".live-chart__axis");
    var note = document.getElementById("liveNote");
    var NS = "http://www.w3.org/2000/svg";

    var all = (lastHistory || []).filter(function (p) { return p && typeof p.v === "number" && typeof p.t === "number"; });
    if (all.length < 2) {
      el.innerHTML = '<div class="grid-empty">Collecting data…</div>';
      ylabels.innerHTML = ""; axis.innerHTML = "";
      return;
    }
    var latest = all[all.length - 1].t;
    var spanHrs = (latest - all[0].t) / 3600000;
    var bar = document.getElementById("liveRange");
    if (bar) {
      bar.querySelectorAll("button").forEach(function (b) {
        var days = parseInt(b.getAttribute("data-range"), 10) || 1;
        // show 7D once there are ~2 days of history, 30D once there are ~8 days
        b.hidden = days > 1 && spanHrs < (days === 7 ? 48 : 192);
        if (b.hidden && b.getAttribute("aria-pressed") === "true") {
          b.setAttribute("aria-pressed", "false");
          bar.querySelector('[data-range="1"]').setAttribute("aria-pressed", "true");
          graphRangeMs = 24 * 3600 * 1000;
        }
      });
      bar.hidden = !bar.querySelector("button:not([hidden]) ~ button:not([hidden]), button:not([hidden]) + button:not([hidden])");
    }
    var rangeStart = latest - graphRangeMs;
    var points = all.filter(function (p) { return p.t >= rangeStart; });
    if (points.length < 2) points = all.slice(-2);
    var coverage = all[0].t <= rangeStart;
    points = bucket(points, 140);
    if (note) {
      if (!coverage) {
        var hrs = (latest - all[0].t) / 3600000;
        note.textContent = "Last " + (hrs < 36 ? Math.max(1, Math.round(hrs)) + " hours" : Math.round(hrs / 24) + " days") + " · sampled every 5 minutes";
      } else note.textContent = "Sampled every 5 minutes.";
    }

    var W = 800, H = 260, PAD = 10, ticks = 4;
    var maxV = Math.max.apply(null, points.map(function (p) { return p.v; }).concat([1]));
    var minV = Math.min.apply(null, points.map(function (p) { return p.v; }));
    var top = maxV * 1.18;
    var step = niceStep(top / ticks);
    top = Math.ceil(top / step) * step;
    var bottom = Math.max(0, Math.floor((minV * 0.7) / step) * step);
    var span = Math.max(1, top - bottom);
    var minT = points[0].t, maxT = points[points.length - 1].t, rangeT = Math.max(1, maxT - minT);
    var pts = points.map(function (p) {
      return [((p.t - minT) / rangeT) * W, H - PAD - ((p.v - bottom) / span) * (H - PAD * 2)];
    });
    var lineD = smoothPath(pts);

    el.innerHTML = "";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    var defs = document.createElementNS(NS, "defs");
    defs.innerHTML = '<linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3d7bff" stop-opacity="0.32"/><stop offset="100%" stop-color="#8a5cff" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#3d7bff"/><stop offset="60%" stop-color="#8a5cff"/><stop offset="100%" stop-color="#45d6ff"/></linearGradient>';
    svg.appendChild(defs);
    var grid = document.createElementNS(NS, "g");
    grid.setAttribute("class", "live-chart__grid");
    for (var v = bottom; v <= top + 1e-9; v += step) {
      var y = H - PAD - ((v - bottom) / span) * (H - PAD * 2);
      var ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", 0); ln.setAttribute("x2", W); ln.setAttribute("y1", y); ln.setAttribute("y2", y);
      grid.appendChild(ln);
    }
    svg.appendChild(grid);
    var area = document.createElementNS(NS, "path");
    area.setAttribute("d", lineD + " L " + W + " " + H + " L 0 " + H + " Z");
    area.setAttribute("class", "live-chart__area");
    svg.appendChild(area);
    var line = document.createElementNS(NS, "path");
    line.setAttribute("d", lineD);
    line.setAttribute("class", "live-chart__line");
    svg.appendChild(line);
    el.appendChild(svg);

    var last = pts[pts.length - 1];
    var endDot = document.createElement("div");
    endDot.className = "live-end-dot";
    endDot.style.left = (last[0] / W) * 100 + "%";
    endDot.style.top = (last[1] / H) * 100 + "%";
    el.appendChild(endDot);
    var hover = document.createElement("div");
    hover.className = "live-hover-dot";
    el.appendChild(hover);
    var tip = document.createElement("div");
    tip.className = "live-chart__tip";
    el.appendChild(tip);
    var spanDays = rangeT > 20 * 3600 * 1000;

    function onMove(clientX) {
      var r = el.getBoundingClientRect();
      var fx = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      var t = minT + fx * rangeT, idx = 0, best = Infinity;
      for (var i = 0; i < points.length; i++) {
        var dd = Math.abs(points[i].t - t);
        if (dd < best) { best = dd; idx = i; }
      }
      var p = pts[idx];
      hover.style.left = (p[0] / W) * 100 + "%";
      hover.style.top = (p[1] / H) * 100 + "%";
      hover.style.display = "block";
      endDot.style.display = "none";
      var d = new Date(points[idx].t);
      tip.innerHTML = "<b>" + fmtFull(points[idx].v) + "</b> playing<small>" +
        esc((spanDays ? d.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " : "") + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })) + "</small>";
      tip.style.display = "block";
      var px = (p[0] / W) * r.width, py = (p[1] / H) * r.height;
      var left = Math.max(0, Math.min(r.width - tip.offsetWidth, px - tip.offsetWidth / 2));
      var topv = py - tip.offsetHeight - 14;
      if (topv < 0) topv = py + 16;
      tip.style.left = left + "px";
      tip.style.top = topv + "px";
    }
    function onLeave() { hover.style.display = "none"; endDot.style.display = "block"; tip.style.display = "none"; }
    el.onmousemove = function (e) { onMove(e.clientX); };
    el.onmouseleave = onLeave;
    el.ontouchmove = function (e) { if (e.touches[0]) onMove(e.touches[0].clientX); };
    el.ontouchend = onLeave;

    ylabels.innerHTML = "";
    for (var yv = top; yv >= bottom - 1e-9; yv -= step) {
      var s = document.createElement("div");
      s.textContent = fmt(yv);
      ylabels.appendChild(s);
    }
    axis.innerHTML = "";
    var n = Math.min(window.innerWidth < 600 ? 3 : 5, points.length);
    for (var k = 0; k < n; k++) {
      var ix = Math.round((k / (n - 1)) * (points.length - 1));
      var dt = new Date(points[ix].t);
      var lab = spanDays
        ? dt.toLocaleDateString([], { month: "short", day: "numeric" })
        : dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      var sp = document.createElement("span");
      sp.textContent = lab;
      axis.appendChild(sp);
    }
  }

  // ------------------------------------------------------------------ apply
  function apply(stats) {
    var fallback = window.ZAP_DATA || { games: [], groups: [] };
    var games = ((stats && stats.games) || fallback.games || []).map(normalise);
    var groups = (stats && stats.groups) || null;
    var meta = stats && stats.meta;

    if (stats && Array.isArray(stats.history)) lastHistory = stats.history;
    setupRange();
    renderGraph();

    if (meta) {
      renderStats(meta);
      var busiest = games.slice().sort(byPlaying)[0];
      var peak = document.getElementById("livePeak");
      if (peak && busiest) peak.innerHTML = fmtFull(busiest.playing) + "<small>" + esc(busiest.name) + "</small>";
      renderWall(games.slice().sort(byPlaying));
      renderShowcase(games);
      renderTopGames(games);
    }
    renderGrid(games, !!meta);
    if (groups) renderGroups(groups);
  }

  function readCache() {
    try {
      var v = JSON.parse(sessionStorage.getItem(STATS_KEY) || "null");
      return v && v.games ? v : null;
    } catch (e) { return null; }
  }
  function writeCache(s) {
    try { sessionStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) { /* quota / private mode */ }
  }

  var inflight = false;
  function refresh() {
    if (inflight) return Promise.resolve();
    inflight = true;
    return fetch("/api/stats?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (s && s.games) { writeCache(s); apply(s); }
      })
      .catch(function () { /* offline or no server: keep what we have */ })
      .then(function () { inflight = false; });
  }

  function load() {
    var needed = document.querySelector("[data-stat], #experiencesGrid, #rankList, #liveChart, #groupsGrid");
    if (!needed) return;
    var cached = readCache();
    apply(cached); // cached stats instantly, or the bundled names
    refresh();
    var timer = setInterval(function () { if (!document.hidden) refresh(); }, POLL_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    var resizeT;
    window.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(renderGraph, 150);
    });
    window.addEventListener("pagehide", function () { clearInterval(timer); });
  }

  document.addEventListener("DOMContentLoaded", load);
})();
