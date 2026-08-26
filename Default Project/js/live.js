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
  const VERIFIED =
    '<svg class="rbx-verified" viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#2f6bff"/><path d="M7.2 12.6l3.4 3.4L16.8 9" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
    else if (mode === "visits") arr.sort((a, b) => (b.visits || 0) - (a.visits || 0));
    else arr.sort((a, b) => (b.playing || 0) - (a.playing || 0));
    return arr;
  }

  function gameCardHTML(g, i) {
    const art = g.thumbnail
      ? '<div class="game-card__art game-card__art--img" style="background-image:url(' + "'" + esc(g.thumbnail) + "'" + ')"></div>'
      : '<div class="game-card__art ' + ART[i % ART.length] + '"></div>';
    return (
      '<a class="game-card" href="' + esc(g.link) + '" target="_blank" rel="noopener" data-players="' + (g.playing || 0) + '" data-visits="' + (g.visits || 0) + '">' +
        art +
        '<div class="game-card__players"><span class="live"></span>' + fmt(g.playing) + "</div>" +
        '<div class="game-card__body">' +
          '<div class="game-card__title">' + esc(g.name) + "</div>" +
          '<div class="game-card__by">By ' + esc(g.creator || "Zap Works") + (g.creatorVerified ? " " + VERIFIED : "") + "</div>" +
          '<div class="game-card__visits">' + fmt(g.visits) + " visits</div>" +
        "</div>" +
      "</a>"
    );
  }

  function groupCardHTML(g, i) {
    const badge = g.icon
      ? '<span class="group-card__badge" style="background-image:url(' + "'" + esc(g.icon) + "'" + ')"></span>'
      : '<span class="group-card__badge" style="background:' + GRADS[i % GRADS.length] + '">' + esc(initials(g.name)) + "</span>";
    return (
      '<a class="group-card" href="' + esc(g.link) + '" target="_blank" rel="noopener">' +
        badge +
        '<span class="group-card__info">' +
          '<span class="group-card__name"><span class="group-card__name-text">' + esc(g.name) + "</span>" + (g.verified ? VERIFIED : "") + "</span>" +
          '<span class="group-card__members" id="gm-' + g.groupId + '">' + fmt(g.members) + " members</span>" +
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
    setNum("liveCurrent", "playing", meta.totalPlaying, "full");
    set("livePeak", fmtFull(meta.peakPlaying));
    setNum("liveVisits", "visits", meta.totalVisits, "short");
    setNum("liveMembers", "members", meta.totalMembers, "full");
    set("liveCount", fmt(meta.gameCount));
  }

  function set(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  // ---- live counters with direction (green up / red down) ----
  const prev = {};
  const prevGroups = {};
  const timers = {};

  function setNum(id, key, value, mode) {
    const el = document.getElementById(id);
    if (!el) return;
    const txt = mode === "full" ? fmtFull(value) : fmt(value);
    const prevVal = prev[key];
    prev[key] = value;

    el.textContent = txt;

    // shrink very long numbers so they never overflow their card
    if (el.classList.contains("stat-card__value") || el.classList.contains("metric__value")) {
      const digits = (txt || "").replace(/[^\d]/g, "").length;
      if (el.classList.contains("stat-card__value")) {
        el.style.fontSize = digits >= 12 ? "1.5rem" : digits >= 10 ? "1.9rem" : "";
      } else {
        el.style.fontSize = digits >= 12 ? "1.05rem" : digits >= 10 ? "1.3rem" : "";
      }
    }

    // on a real change: glow the number + pop, then fade back to white
    if (prevVal != null && value != null && value !== prevVal) {
      el.classList.toggle("num-up", value > prevVal);
      el.classList.toggle("num-down", value < prevVal);
      el.classList.remove("pop");
      void el.offsetWidth; // restart animation
      el.classList.add("pop");
      clearTimeout(timers[id]);
      timers[id] = setTimeout(() => {
        el.classList.remove("num-up", "num-down");
      }, 3000);
    }
  }

  function groupDeltas(groups) {
    groups.forEach((g) => {
      const el = document.getElementById("gm-" + g.groupId);
      if (!el) return;
      const d = prevGroups[g.groupId];
      prevGroups[g.groupId] = g.members;
      if (d != null && g.members != null && g.members !== d) {
        el.classList.toggle("num-up", g.members > d);
        el.classList.toggle("num-down", g.members < d);
        el.classList.remove("pop");
        void el.offsetWidth;
        el.classList.add("pop");
        clearTimeout(timers["gm-" + g.groupId]);
        timers["gm-" + g.groupId] = setTimeout(() => {
          el.classList.remove("num-up", "num-down");
        }, 3000);
      }
    });
  }

  function allDiscordEmpty(d) {
    return !Array.isArray(d) || d.length === 0;
  }

  // ---- hero: thumbnail collage + 3 floating game frames ----
  // Persistent across polls: the DOM + timer are built once (with the newest
  // data), the cycle index keeps advancing through every game, and re-polls only
  // refresh the data — never reset back to the top 3.
  let heroData = [];
  let heroBase = 0;
  let heroTimer = null;
  let heroStarted = false;
  let heroListeners = false;

  function heroCardHTML(g) {
    return (
      '<a class="hero__fcard" href="' + esc(g.link) + '" target="_blank" rel="noopener">' +
        '<span class="art">' +
          (g.thumbnail ? '<img src="' + esc(g.thumbnail) + '" alt="" loading="eager" />' : "") +
          '<i class="shade"></i>' +
        "</span>" +
        '<span class="body">' +
          '<span class="ttl">' + esc(g.name) + "</span>" +
          '<span class="by">By ' + esc(g.creator || "Zap Works") + (g.creatorVerified ? " " + VERIFIED : "") + "</span>" +
        "</span>" +
      "</a>"
    );
  }

  function heroFill(card, g) {
    if (!g || !card) return;
    const art = card.querySelector(".art");
    let img = art.querySelector("img");
    if (g.thumbnail) {
      if (!img) {
        img = document.createElement("img");
        art.prepend(img);
      }
      img.src = g.thumbnail;
      img.style.display = "block";
    } else if (img) {
      img.style.display = "none";
    }
    card.querySelector(".ttl").textContent = g.name;
    card.querySelector(".by").innerHTML = "By " + esc(g.creator || "Zap Works") + (g.creatorVerified ? " " + VERIFIED : "");
  }

  function addTilt(card) {
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform =
        "perspective(900px) rotateY(" + (px * 9).toFixed(2) + "deg) rotateX(" + (-py * 9).toFixed(2) + "deg) scale(1.02)";
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "perspective(900px) rotateX(0) rotateY(0) scale(1)";
    });
  }

  function heroTick() {
    if (heroData.length < 2) return;
    const cards = document.querySelectorAll("#heroFeatured .hero__fcard");
    heroBase = (heroBase + 1) % heroData.length;
    cards.forEach((card) => (card.style.opacity = "0"));
    setTimeout(() => {
      cards.forEach((card, i) => heroFill(card, heroData[(heroBase + i) % heroData.length]));
      requestAnimationFrame(() => cards.forEach((card) => (card.style.opacity = "1")));
    }, 160);
  }

  function heroStart() {
    if (heroStarted || heroData.length <= 2) return;
    heroStarted = true;
    heroTimer = setInterval(heroTick, 4500);
  }

  function heroStop() {
    if (heroTimer) {
      clearInterval(heroTimer);
      heroTimer = null;
      heroStarted = false;
    }
  }

  function renderHero(games) {
    const host = document.getElementById("heroFeatured");
    const backdrop = document.getElementById("heroBackdrop");
    if (!host) return;

    heroData = games.slice().sort((a, b) => (b.playing || 0) - (a.playing || 0));

    // backdrop collage (built once)
    if (backdrop && backdrop.childElementCount === 0) {
      backdrop.innerHTML = heroData
        .slice(0, 18)
        .map((g) => '<div class="tile' + (g.thumbnail ? "" : " tile--fallback") + '" style="' + (g.thumbnail ? "background-image:url('" + esc(g.thumbnail) + "')" : "") + '"></div>')
        .join("");
    }

    // build the two full-size frames only once
    if (!host.querySelector(".hero__float") && heroData.length) {
      host.innerHTML =
        '<div class="hero__float">' +
          '<div class="hero__fcard">' + heroCardHTML(heroData[0] || games[0]) + "</div>" +
          '<div class="hero__fcard">' + heroCardHTML(heroData[1] || games[0]) + "</div>" +
        "</div>";

      host.querySelectorAll(".hero__fcard").forEach(addTilt);

      if (!heroListeners) {
        host.addEventListener("mouseenter", heroStop);
        host.addEventListener("mouseleave", heroStart);
        heroListeners = true;
      }
    }

    heroStart();
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
    // headroom so the line sits mid-graph (roughly a quarter below the top)
    const headroom = Math.max(5000, Math.ceil(maxV * 0.25));
    let top = maxV + headroom;
    const step = niceStep(top / (ticks - 1), ticks);
    top = Math.ceil(top / step) * step;

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
    svg.setAttribute("overflow", "visible"); // let the dot overlay into the padding

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

    // ---- hover interaction: show the CCU at the cursor (Roblox-style) ----
    const hoverHalo = document.createElementNS(NS, "circle");
    hoverHalo.setAttribute("class", "live-chart__hover");
    hoverHalo.setAttribute("r", 16);
    hoverHalo.setAttribute("visibility", "hidden");
    const hoverDot = document.createElementNS(NS, "circle");
    hoverDot.setAttribute("class", "live-chart__hoverdot");
    hoverDot.setAttribute("r", 6);
    hoverDot.setAttribute("visibility", "hidden");
    svg.appendChild(hoverHalo);
    svg.appendChild(hoverDot);

    const tip = document.createElement("div");
    tip.className = "live-chart__tip";
    el.appendChild(tip);

    svg.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const fx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = minT + fx * rangeT;
      let idx = 0;
      let best = Infinity;
      for (let i = 0; i < points.length; i++) {
        const dd = Math.abs(points[i].t - t);
        if (dd < best) {
          best = dd;
          idx = i;
        }
      }
      const p = pts[idx];
      const px = (p[0] / W) * rect.width;
      const py = (p[1] / H) * rect.height;

      hoverHalo.setAttribute("cx", p[0]);
      hoverHalo.setAttribute("cy", p[1]);
      hoverDot.setAttribute("cx", p[0]);
      hoverDot.setAttribute("cy", p[1]);
      hoverHalo.setAttribute("visibility", "visible");
      hoverDot.setAttribute("visibility", "visible");
      dot.setAttribute("visibility", "hidden");
      halo.setAttribute("visibility", "hidden");

      tip.innerHTML = '<span class="live-chart__tip-dot"></span>Total <b>' + fmt(points[idx].v) + "</b>";
      tip.style.display = "block";
      const tipW = tip.offsetWidth;
      const tipH = tip.offsetHeight;
      let left = px - tipW / 2;
      left = Math.max(4, Math.min(rect.width - tipW - 4, left));
      let topv = py - tipH - 14;
      if (topv < 6) topv = py + 18; // flip below when near the top
      tip.style.left = left + "px";
      tip.style.top = topv + "px";
    });

    svg.addEventListener("mouseleave", () => {
      hoverHalo.setAttribute("visibility", "hidden");
      hoverDot.setAttribute("visibility", "hidden");
      dot.setAttribute("visibility", "visible");
      halo.setAttribute("visibility", "visible");
      tip.style.display = "none";
    });

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
      creatorVerified: !!g.creatorVerified,
      thumbnail: g.thumbnail,
      link: g.link || "https://www.roblox.com/games/" + g.placeId
    }));

    renderGrid(document.getElementById("experiencesGrid"), sortGames(fullGames, sortMode), gameCardHTML);
    renderGrid(document.getElementById("featuredGrid"), sortGames(fullGames, "most").slice(0, 4), gameCardHTML);
    renderGroups(document.getElementById("groupsGrid"), groups);
    groupDeltas(groups);

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
    renderHero(fullGames);
  }

  async function load() {
    let stats = null;
    const bust = "?t=" + Date.now(); // defeat any CDN/cache on the API
    try {
      const res = await fetch("/api/stats" + bust, { cache: "no-store" });
      if (res.ok) stats = await res.json();
    } catch (err) {
      stats = null; // offline / no server -> fallback names only
    }
    apply(stats);

    // refresh periodically for a live feel
    setInterval(async () => {
      try {
        const res = await fetch("/api/stats" + bust, { cache: "no-store" });
        if (res.ok) apply(await res.json());
      } catch (err) {
        /* keep current */
      }
    }, 10000);
  }

  document.addEventListener("DOMContentLoaded", load);
})();
