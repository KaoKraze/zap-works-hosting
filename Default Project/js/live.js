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
    const art = ART[i % ART.length];
    return (
      '<a class="game-card" href="' + esc(g.link) + '" target="_blank" rel="noopener" data-players="' + (g.playing || 0) + '">' +
        '<div class="game-card__art ' + art + '"><span class="shape" style="width:82px;height:82px;left:12%;top:18%;background:rgba(255,255,255,.28)"></span></div>' +
        '<div class="game-card__players"><span class="live"></span>' + fmt(g.playing) + "</div>" +
        '<div class="game-card__body">' +
          '<div class="game-card__title">' + esc(g.name) + "</div>" +
          '<div class="game-card__by">By Zap Works ' + CHECK + "</div>" +
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
    set("liveAvg", fmtFull(Math.round(meta.totalPlaying / Math.max(1, meta.gameCount))));
    set("liveCount", fmt(meta.gameCount));
  }

  function set(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function allDiscordEmpty(d) {
    return !Array.isArray(d) || d.length === 0;
  }

  function apply(stats) {
    const games = (stats && stats.games) || window.ZAP_DATA.games;
    const groups = (stats && stats.groups) || window.ZAP_DATA.groups;
    const discord = (stats && stats.discord) || window.ZAP_DATA.discord;
    const meta = (stats && stats.meta) || null;

    // Order big -> small (or Honor the active sort button on the games page)
    const sortMode = (document.querySelector(".sort-btn.active") || {}).dataset?.sort || "most";

    const fullGames = games.map((g) => ({
      placeId: g.placeId,
      name: g.name,
      playing: g.playing,
      visits: g.visits,
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
