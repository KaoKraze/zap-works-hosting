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

  // set a number and flash it green/red when it changes (same feel as the hero stats)
  function setNum(el, value, formatter) {
    if (!el) return;
    var prev = el.getAttribute("data-v");
    el.textContent = formatter(value);
    if (value == null) return;
    el.setAttribute("data-v", value);
    if (prev == null || prev === "" || Number(prev) === value) return;
    el.classList.remove("num-up", "num-down");
    void el.offsetWidth;
    el.classList.add(value > Number(prev) ? "num-up" : "num-down");
    clearTimeout(el.__t);
    el.__t = setTimeout(function () { el.classList.remove("num-up", "num-down"); }, 2400);
  }

  function renderStats(meta) {
    var map = {
      playing: [meta.totalPlaying, fmtFull],
      peak: [meta.recordPeak, fmtFull],
      visits: [meta.totalVisits, fmt],
      members: [meta.totalMembers, fmt],
      games: [meta.gameCount, fmtFull],
      groups: [meta.groupCount, fmtFull]
    };
    document.querySelectorAll("[data-stat]").forEach(function (el, i) {
      var k = el.getAttribute("data-stat");
      if (!map[k]) return;
      if (k === "peak" && !(map[k][0] > 0)) return; // older/cached data: keep the 67,150 already on the page
      tween(el, map[k][0], map[k][1], k + ":" + i);
    });
    setNum(document.getElementById("liveCurrent"), meta.totalPlaying, fmtFull);
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
          '<div class="kv"><dt>Playing</dt><dd>' + fmtFull(g.playing) + "</dd></div>" +
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
          '<span class="rank__meta"><span class="rank__live">' + fmtFull(g.playing) + "</span>" +
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
        setNum(p, g.playing, fmtFull);
        setNum(v, g.visits, fmt);
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
          '<span class="gcard__stat"><span>Playing</span><b data-k="playing" data-v="' + (g.playing == null ? "" : g.playing) + '"' + (live ? "" : ' class="is-idle"') + ">" + fmtFull(g.playing) + "</b></span>" +
          '<span class="gcard__stat"><span>Visits</span><b data-k="visits" data-v="' + (g.visits == null ? "" : g.visits) + '">' + fmt(g.visits) + "</b></span>" +
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
    if (list) {
      list.parentElement.hidden = shownCount <= LEAD;
      // two columns that fill top-to-bottom: left column first, then the right
      list.style.setProperty("--rows", Math.max(1, Math.ceil(Math.max(0, shownCount - LEAD) / 2)));
    }
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
          setNum(p, g.playing, fmtFull);
          p.classList.toggle("is-idle", !((g.playing || 0) > 0));
        }
        setNum(v, g.visits, fmt);
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
  // Multi-line player chart (Roblox-dashboard style): Total + the busiest games
  // + "Other games". Legend items toggle lines; the y-axis eases to fit what's visible.
  var TOTAL_COLOR = "#6ea2ff", OTHER_COLOR = "#9aa3b5";
  // fixed colour slots — the server gives each charted game a slot it keeps
  var GAME_COLORS = ["#b07cff", "#45d6ff", "#ff7aa8", "#ffb44d", "#4fdc8f", "#ffe15a",
    "#f472d0", "#ff8a5c", "#2dd4bf", "#a3e635", "#c4b5fd", "#f87171"];
  var MAX_GAME_LINES = 6;
  var chart = { days: 1, data: null, series: [], hidden: {}, focus: null, y: null, yAnim: null, loading: false };

  function niceStep(raw) {
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var norm = raw / mag;
    return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  }
  function smoothPath(pts) {
    var d = "", run = [];
    function flush() {
      if (run.length === 1) d += "M " + run[0][0].toFixed(1) + " " + run[0][1].toFixed(1) + " l 0.01 0 ";
      else if (run.length > 1) {
        d += "M " + run[0][0].toFixed(1) + " " + run[0][1].toFixed(1);
        for (var i = 0; i < run.length - 1; i++) {
          var p0 = run[i - 1] || run[i], p1 = run[i], p2 = run[i + 1], p3 = run[i + 2] || p2;
          d += " C " + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + " " + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) +
            ", " + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + " " + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) +
            ", " + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
        }
      }
      run = [];
    }
    pts.forEach(function (p) { if (p) run.push(p); else flush(); }); // gaps break the line
    flush();
    return d;
  }

  function buildSeries(data) {
    var series = [{ id: "total", name: "Total", color: TOTAL_COLOR, values: data.total }];
    var gamesData = data.games || [];
    var lines = data.lines || MAX_GAME_LINES;
    gamesData.slice(0, lines).forEach(function (g, i) {
      var slot = typeof g.color === "number" ? g.color : i;
      series.push({ id: "g" + g.placeId, name: g.name, color: GAME_COLORS[slot % GAME_COLORS.length], values: g.values });
    });
    var rest = gamesData.slice(lines);
    if (rest.length) {
      var other = data.t.map(function (_, i) {
        var any = false, sum = 0;
        rest.forEach(function (g) { if (g.values[i] != null) { any = true; sum += g.values[i]; } });
        return any ? sum : null;
      });
      series.push({ id: "other", name: "Other games", color: OTHER_COLOR, values: other });
    }
    return series;
  }

  function visibleSeries() {
    return chart.series.filter(function (s) { return !chart.hidden[s.id]; });
  }
  function targetY() {
    var max = 0, min = Infinity;
    visibleSeries().forEach(function (s) {
      s.values.forEach(function (v) { if (v != null) { if (v > max) max = v; if (v < min) min = v; } });
    });
    if (!isFinite(min)) { min = 0; max = 10; }
    var top = Math.max(10, max * 1.12);
    var step = niceStep(top / 4);
    top = Math.ceil(top / step) * step;
    var bottom = Math.max(0, Math.floor((min * 0.85) / step) * step);
    return { top: top, bottom: bottom, step: step };
  }
  function animateY() {
    var to = targetY();
    if (!chart.y || reduceMotion) { chart.y = to; drawChart(); return; }
    var from = { top: chart.y.top, bottom: chart.y.bottom };
    var start = null;
    cancelAnimationFrame(chart.yAnim);
    var step = function (ts) {
      if (start == null) start = ts;
      var p = Math.min(1, (ts - start) / 450), e = 1 - Math.pow(1 - p, 3);
      chart.y = { top: from.top + (to.top - from.top) * e, bottom: from.bottom + (to.bottom - from.bottom) * e, step: to.step };
      drawChart();
      if (p < 1) chart.yAnim = requestAnimationFrame(step);
    };
    chart.yAnim = requestAnimationFrame(step);
  }

  function renderLegend() {
    var el = document.getElementById("chartLegend");
    if (!el) return;
    el.innerHTML = chart.series.map(function (s) {
      var off = !!chart.hidden[s.id];
      return '<button type="button" class="legend__item" data-id="' + esc(s.id) + '" aria-pressed="' + !off + '" style="--c:' + s.color + '">' +
        '<span class="legend__swatch" aria-hidden="true"></span>' + esc(s.name) + "</button>";
    }).join("");
  }

  function setupChartControls() {
    var bar = document.getElementById("liveRange");
    if (bar && !bar.__bound) {
      bar.__bound = true;
      bar.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-range]");
        if (!b) return;
        bar.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        chart.days = parseInt(b.getAttribute("data-range"), 10) || 1;
        loadHistory();
      });
    }
    var legend = document.getElementById("chartLegend");
    if (legend && !legend.__bound) {
      legend.__bound = true;
      legend.addEventListener("click", function (e) {
        var b = e.target.closest(".legend__item");
        if (!b) return;
        var id = b.getAttribute("data-id");
        var shown = visibleSeries().length;
        if (!chart.hidden[id] && shown <= 1) return; // keep at least one line
        chart.hidden[id] = !chart.hidden[id];
        b.setAttribute("aria-pressed", String(!chart.hidden[id]));
        if (chart.hidden[id] && chart.focus === id) chart.focus = null;
        animateY();
      });
      legend.addEventListener("mouseover", function (e) {
        var b = e.target.closest(".legend__item");
        var id = b && !chart.hidden[b.getAttribute("data-id")] ? b.getAttribute("data-id") : null;
        if (id !== chart.focus) { chart.focus = id; drawChart(); }
      });
      legend.addEventListener("mouseleave", function () { if (chart.focus) { chart.focus = null; drawChart(); } });
      legend.addEventListener("focusin", function (e) {
        var b = e.target.closest(".legend__item");
        chart.focus = b && !chart.hidden[b.getAttribute("data-id")] ? b.getAttribute("data-id") : null;
        drawChart();
      });
      legend.addEventListener("focusout", function () { chart.focus = null; drawChart(); });
    }
  }

  function drawChart() {
    var el = document.getElementById("liveChart");
    if (!el || !chart.data) return;
    var wrap = el.closest(".live-chart");
    var ylabels = wrap.querySelector(".live-chart__ylabels");
    var axis = wrap.querySelector(".live-chart__axis");
    var NS = "http://www.w3.org/2000/svg";
    var data = chart.data;
    if (!data.t || data.t.length < 2) {
      el.innerHTML = '<div class="grid-empty">Collecting data…</div>';
      ylabels.innerHTML = ""; axis.innerHTML = "";
      return;
    }
    var W = Math.max(300, el.clientWidth || 800), H = Math.max(160, el.clientHeight || 300), PAD = 8;
    var minT = data.from, maxT = data.to, rangeT = Math.max(1, maxT - minT);
    var y = chart.y || targetY();
    var span = Math.max(1, y.top - y.bottom);
    function X(t) { return ((t - minT) / rangeT) * W; }
    function Y(v) { return H - PAD - ((v - y.bottom) / span) * (H - PAD * 2); }

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' +
      '<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3d7bff" stop-opacity="0.26"/><stop offset="100%" stop-color="#8a5cff" stop-opacity="0"/></linearGradient></defs>' +
      '<g class="live-chart__grid">';
    for (var v = y.bottom; v <= y.top + 1e-6; v += y.step) svg += '<line x1="0" x2="' + W + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>';
    svg += "</g>";
    var vis = visibleSeries();
    vis.slice().reverse().forEach(function (s) { // total drawn last = on top
      var pts = data.t.map(function (t, i) { return s.values[i] == null ? null : [X(t), Y(s.values[i])]; });
      var dim = chart.focus && chart.focus !== s.id;
      if (s.id === "total") {
        var first = pts.find(function (p) { return p; }), last = pts.slice().reverse().find(function (p) { return p; });
        if (first && last) svg += '<path class="live-chart__area" d="' + smoothPath(pts) + " L " + last[0].toFixed(1) + " " + H + " L " + first[0].toFixed(1) + " " + H + ' Z"' + (dim ? ' opacity="0.25"' : "") + "/>";
      }
      svg += '<path class="live-chart__line' + (s.id === "total" ? " is-total" : "") + '" d="' + smoothPath(pts) + '" style="stroke:' + s.color + '"' +
        (dim ? ' opacity="0.15"' : chart.focus === s.id ? ' stroke-width="3"' : "") + "/>";
    });
    svg += '<line class="live-chart__cursor" x1="0" x2="0" y1="0" y2="' + H + '" visibility="hidden"/></svg>';
    el.innerHTML = svg + '<div class="live-chart__tip" role="status" aria-live="off"></div>';

    // y labels
    ylabels.innerHTML = "";
    for (var yv = y.top; yv >= y.bottom - 1e-6; yv -= y.step) {
      var lab = document.createElement("div");
      lab.textContent = fmt(Math.round(yv));
      lab.style.top = Y(yv) + "px";
      ylabels.appendChild(lab);
    }
    // x labels across the whole requested range
    axis.innerHTML = "";
    var n = window.innerWidth < 600 ? 3 : 5;
    var dayRange = rangeT > 26 * 3600 * 1000;
    for (var k = 0; k < n; k++) {
      var dt = new Date(minT + (k / (n - 1)) * rangeT);
      var sp = document.createElement("span");
      sp.textContent = dayRange ? dt.toLocaleDateString([], { month: "short", day: "numeric" }) : dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      axis.appendChild(sp);
    }

    // hover: cursor line + one tooltip listing every visible line
    var tip = el.querySelector(".live-chart__tip");
    var cursor = el.querySelector(".live-chart__cursor");
    function move(clientX) {
      var r = el.getBoundingClientRect();
      var t = minT + ((clientX - r.left) / r.width) * rangeT;
      var idx = -1, best = Infinity;
      data.t.forEach(function (tt, i) { var dd = Math.abs(tt - t); if (dd < best) { best = dd; idx = i; } });
      if (idx < 0) return;
      var x = X(data.t[idx]);
      cursor.setAttribute("x1", x); cursor.setAttribute("x2", x); cursor.setAttribute("visibility", "visible");
      var rows = vis.map(function (s) { return { s: s, v: s.values[idx] }; }).filter(function (r2) { return r2.v != null; })
        .sort(function (a, b2) { return b2.v - a.v; });
      var d = new Date(data.t[idx]);
      tip.innerHTML = '<div class="tip__time">' + esc(d.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + "</div>" +
        rows.map(function (r2) {
          return '<div class="tip__row"><span class="tip__sw" style="background:' + r2.s.color + '"></span><span class="tip__name">' + esc(r2.s.name) + "</span><b>" + fmtFull(r2.v) + "</b></div>";
        }).join("");
      tip.style.display = "block";
      var left = x + 16;
      if (left + tip.offsetWidth > r.width) left = x - tip.offsetWidth - 16;
      tip.style.left = Math.max(0, left) + "px";
      tip.style.top = "8px";
    }
    function leave() { tip.style.display = "none"; cursor.setAttribute("visibility", "hidden"); }
    el.onmousemove = function (e) { move(e.clientX); };
    el.onmouseleave = leave;
    el.ontouchstart = el.ontouchmove = function (e) { if (e.touches[0]) move(e.touches[0].clientX); };
    el.ontouchend = leave;
  }

  function loadHistory() {
    if (!document.getElementById("liveChart") || chart.loading) return Promise.resolve();
    chart.loading = true;
    var days = chart.days;
    return fetch("/api/history?days=" + days + "&t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || d.days !== chart.days) return;
        var firstLoad = !chart.data;
        chart.data = d;
        updateChartNote(d);
        var prevIds = chart.series.map(function (s) { return s.id; }).join();
        chart.series = buildSeries(d);
        if (prevIds !== chart.series.map(function (s) { return s.id; }).join()) renderLegend();
        if (firstLoad) { chart.y = targetY(); drawChart(); } else animateY();
      })
      .catch(function () { /* keep the last chart */ })
      .then(function () { chart.loading = false; });
  }
  // While history is shorter than the chosen range, say how far back it goes.
  function updateChartNote(d) {
    var head = document.querySelector(".chart-panel__head");
    if (!head) return;
    var note = document.getElementById("chartNote");
    if (!note) {
      note = document.createElement("p");
      note.id = "chartNote";
      note.className = "chart-panel__note";
      var range = document.getElementById("liveRange");
      head.insertBefore(note, range);
    }
    if (!d.partial) { note.hidden = true; return; }
    var since = new Date(d.from);
    var label = d.days === 1 ? "24 hours" : d.days + " days";
    note.textContent = "Recording since " + since.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " +
      since.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " · fills to " + label + " over time";
    note.hidden = false;
  }
  function redrawChart() { if (chart.data) drawChart(); }

  // ------------------------------------------------------------------ apply
  function apply(stats) {
    var fallback = window.ZAP_DATA || { games: [], groups: [] };
    var games = ((stats && stats.games) || fallback.games || []).map(normalise);
    var groups = (stats && stats.groups) || null;
    var meta = stats && stats.meta;

    setupChartControls();

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
    loadHistory();
    var timer = setInterval(function () { if (!document.hidden) refresh(); }, POLL_MS);
    var historyTimer = setInterval(function () { if (!document.hidden) loadHistory(); }, 60000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    var resizeT;
    window.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(redrawChart, 150);
    });
    window.addEventListener("pagehide", function () { clearInterval(timer); clearInterval(historyTimer); });
  }

  document.addEventListener("DOMContentLoaded", load);
})();
