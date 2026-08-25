// ---------- Zap Works — shared interactions ----------

// Mobile navigation toggle
function setupMobileNav() {
  const toggle = document.getElementById("navToggle");
  const mobileNav = document.getElementById("mobileNav");
  const mobileClose = document.getElementById("mobileNavClose");

  if (!toggle || !mobileNav) return;

  toggle.addEventListener("click", () => {
    mobileNav.classList.add("open");
  });

  if (mobileClose) {
    mobileClose.addEventListener("click", () => {
      mobileNav.classList.remove("open");
    });
  }

  // Close when a link is clicked
  mobileNav.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => mobileNav.classList.remove("open"));
  });
}

// Sort experiences (games page) by player count
function setupSorting() {
  const sortBar = document.getElementById("sortBar");
  const grid = document.getElementById("experiencesGrid");
  if (!sortBar || !grid) return;

  const buttons = sortBar.querySelectorAll(".sort-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const mode = btn.dataset.sort;
      const cards = Array.from(grid.querySelectorAll(".game-card"));
      const updated = document.createElement("div");

      if (mode === "most") {
        cards.sort((a, b) => b.dataset.players - a.dataset.players);
      } else {
        cards.sort((a, b) => a.dataset.players - b.dataset.players);
      }

      updated.className = grid.className;
      updated.id = grid.id;
      cards.forEach((c) => updated.appendChild(c));
      grid.replaceWith(updated);
    });
  });
}

// Contact form mock submission
function setupContactForm() {
  const form = document.getElementById("contactForm");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const status = form.querySelector(".form__status");
    const name = form.querySelector("#name")?.value;

    status.className = "form__status ok";
    status.textContent = `Thanks${name ? ", " + name : ""}! Your message is on its way. We'll get back to you shortly.`;
    status.classList.add("ok");

    form.reset();
    setTimeout(() => {
      status.className = "form__status";
      status.classList.remove("ok");
      status.textContent = "";
    }, 6000);
  });
}

// Highlight active nav link based on current path
function highlightActiveLink() {
  const path = window.location.pathname.split("/").pop() || "index.html";
  const normalized = path === "" ? "index.html" : path;
  document.querySelectorAll(".nav__links a, .mobile-nav a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href && href === normalized) a.classList.add("active");
  });
}

// Hit the target of a Catmull-Rom spline for a smooth line chart
function smoothPath(pts) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

// Live concurrent-players chart (bound-style) — builds + animates an SVG
function setupLiveChart() {
  const el = document.getElementById("liveChart");
  if (!el) return;

  const NS = "http://www.w3.org/2000/svg";
  const W = 800;
  const H = 260;
  const PAD = 14;

  // Past 7 days of concurrent players (trending up)
  const values = [420, 488, 460, 532, 610, 700, 654, 760, 880, 952, 1088, 1204, 1452, 1316, 780];
  const peak = Math.max(...values);
  const min = Math.min(...values);

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - PAD - ((v - min) / (peak - min)) * (H - PAD * 2);
    return [x, y];
  });

  const lineD = smoothPath(pts);
  const areaD = lineD + ` L ${W} ${H} L 0 ${H} Z`;

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");

  // defs: gradients
  const defs = document.createElementNS(NS, "defs");
  defs.innerHTML =
    `<linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0%" stop-color="#2f6bff" stop-opacity="0.35"/>
       <stop offset="100%" stop-color="#2f6bff" stop-opacity="0"/>
     </linearGradient>
     <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
       <stop offset="0%" stop-color="#2f6bff"/>
       <stop offset="100%" stop-color="#35e0ff"/>
     </linearGradient>`;
  svg.appendChild(defs);

  // horizontal grid lines
  const grid = document.createElementNS(NS, "g");
  grid.setAttribute("class", "live-chart__grid");
  grid.setAttribute("vector-effect", "non-scaling-stroke");
  for (let i = 1; i <= 4; i++) {
    const y = (H / 5) * i;
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

  const halo = document.createElementNS(NS, "circle");
  halo.setAttribute("class", "live-chart__halo");
  halo.setAttribute("r", 16);
  svg.appendChild(halo);

  const dot = document.createElementNS(NS, "circle");
  dot.setAttribute("class", "live-chart__dot");
  dot.setAttribute("r", 5);
  svg.appendChild(dot);

  el.appendChild(svg);

  // day labels
  const axis = el.querySelector(".live-chart__axis");
  if (axis) {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    axis.innerHTML = days.map((d) => `<span>${d}</span>`).join("");
  }

  // animate the dot travelling along the line
  const pathEl = svg.querySelector(".live-chart__line");
  const length = pathEl.getTotalLength();
  let t = 0;

  function frame() {
    t += 0.0032;
    if (t > 1) t = 0;
    const pos = pathEl.getPointAtLength(length * t);
    dot.setAttribute("cx", pos.x);
    dot.setAttribute("cy", pos.y);
    halo.setAttribute("cx", pos.x);
    halo.setAttribute("cy", pos.y);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // count up the peak + average numbers
  const peakEl = document.getElementById("livePeak");
  const avgEl = document.getElementById("liveAvg");
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  if (peakEl) {
    const duration = 1400;
    const start = performance.now();
    function step(now) {
      const p = Math.min(1, (now - start) / duration);
      peakEl.textContent = Math.round(peak * p).toLocaleString();
      if (avgEl) avgEl.textContent = Math.round(avg * p).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupMobileNav();
  setupSorting();
  setupContactForm();
  setupLiveChart();
  highlightActiveLink();
});
