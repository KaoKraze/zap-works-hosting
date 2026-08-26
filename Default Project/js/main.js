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

// Sort experiences (games page) by the active tab — instant, in-place
function setupSorting() {
  const sortBar = document.getElementById("sortBar");
  if (!sortBar) return;

  const buttons = sortBar.querySelectorAll(".sort-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const mode = btn.dataset.sort;
      const grid = document.getElementById("experiencesGrid");
      if (!grid) return;

      const cards = Array.from(grid.querySelectorAll(".game-card")).sort((a, b) => {
        const av = parseInt(a.dataset.visits || "0", 10);
        const ap = parseInt(a.dataset.players || "0", 10);
        const bv = parseInt(b.dataset.visits || "0", 10);
        const bp = parseInt(b.dataset.players || "0", 10);
        if (mode === "visits") return bv - av;
        if (mode === "least") return ap - bp;
        return bp - ap;
      });

      // reorder in place (no node replacement) so it's instant & reliable
      cards.forEach((c) => grid.appendChild(c));
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

// Highlight active nav link based on current path (clean URLs)
function highlightActiveLink() {
  const page = location.pathname.replace(/\/$/, "").split("/").pop() || "index";
  document.querySelectorAll(".nav__links a, .mobile-nav a").forEach((a) => {
    const href = (a.getAttribute("href") || "").split(/[?#]/)[0];
    if (href.startsWith("#") || href === "") return;
    let target = href.replace(/^\/+/, "").replace(/\.html$/, "") || "index";
    if (target === page) a.classList.add("active");
  });
}

// Smooth inertial scroll (Lenis-style) so the page glides like interstudios
function setupSmoothScroll() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  if (reduced || touch) return; // keep native for reduced-motion + touch

  let target = window.scrollY;
  let current = window.scrollY;
  let raf = null;
  const lerp = 0.1;

  // our own animation drives the scroll; disable CSS smooth to avoid conflicts
  document.documentElement.style.scrollBehavior = "auto";

  function clampMax() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  function tick() {
    current += (target - current) * lerp;
    if (Math.abs(target - current) < 0.6) {
      current = target;
      window.scrollTo(0, current);
      raf = null;
      return;
    }
    window.scrollTo(0, current);
    raf = requestAnimationFrame(tick);
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  window.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      target += e.deltaY;
      const max = clampMax();
      target = Math.max(0, Math.min(max, target));
      kick();
    },
    { passive: false }
  );

  // smooth anchor navigation (offset for the sticky header)
  document.addEventListener("click", (e) => {
    const href = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!href) return;
    const id = href.getAttribute("href");
    const el = document.querySelector(id);
    if (!el) return;
    e.preventDefault();
    target = el.getBoundingClientRect().top + window.scrollY - 80;
    target = Math.max(0, Math.min(clampMax(), target));
    kick();
  });

  window.addEventListener("resize", () => {
    target = window.scrollY;
    current = window.scrollY;
  });
}

// Partner logos rendered into the scrolling banner(s).
// Names = the visible fallback; file = images/partners/<file>
const ZAP_PARTNERS = [
  { name: "Shelby", file: "shelby.png" },
  { name: "Victoria", file: "victoria.png" },
  { name: "Ford", file: "ford.png" },
  { name: "Ferrari", file: "ferrari.png" },
  { name: "Crest", file: "crest.png" },
  { name: "Aston Martin", file: "aston-martin.png" },
  { name: "Lamborghini", file: "lamborghini.png" },
  { name: "Porsche", file: "porsche.png" },
  { name: "KTM", file: "ktm.png" },
  { name: "NFL", file: "nfl.png" },
  { name: "Nickelodeon", file: "nickelodeon.png" },
  { name: "Roblox", file: "roblox.png" },
  { name: "Chevrolet", file: "chevrolet.png" },
  { name: "ABT", file: "abt.png" },
  { name: "Pagani", file: "pagani.png" },
  { name: "Lotus", file: "lotus.png" },
  { name: "Monster Jam", file: "monster-jam.png" },
  { name: "Audi", file: "audi.png" },
  { name: "Volkswagen", file: "volkswagen.png" },
  { name: "Mazda", file: "mazda.png" },
  { name: "Zenvo", file: "zenvo.png" },
  { name: "FIFA", file: "fifa.png" },
  { name: "Old Navy", file: "old-navy.png" },
  { name: "Maris", file: "maris.png" },
  { name: "Indigo", file: "indigo.png" }
];

function setupPartners() {
  const tracks = document.querySelectorAll("#partnerTrack");
  if (!tracks.length) return;

  const item = (p) =>
    '<span class="partner" aria-label="' + p.name + '">' +
      '<img src="images/partners/' + p.file + '" alt="' + p.name + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\';" />' +
      '<span class="partner__fallback">' + p.name + "</span>" +
    "</span>";

  const set = ZAP_PARTNERS.map(item).join("");

  tracks.forEach((track) => {
    const marquee = track.closest(".partners__marquee");
    const group = document.createElement("div");
    group.className = "partners__group";
    group.innerHTML = set;
    track.appendChild(group);

    // add copies until the track always fills the viewport while scrolling
    let copies = 1;
    function ensureCopies() {
      const gw = group.scrollWidth;
      const cw = marquee ? marquee.clientWidth : window.innerWidth;
      const needed = gw > 0 ? Math.ceil(cw / gw) + 1 : 2;
      while (copies < needed) {
        track.appendChild(group.cloneNode(true));
        copies++;
      }
    }
    requestAnimationFrame(ensureCopies);

    // measure once icons/images are likely loaded
    window.addEventListener("load", ensureCopies);

    // JS-driven marquee: never desyncs, stays continuous even after tab-out
    let offset = 0;
    let paused = false;
    let last = performance.now();
    const SPEED = 0.05; // px per ms

    function tick(now) {
      const gw = group.scrollWidth;
      if (gw > 0) {
        const dt = Math.min(50, now - last);
        if (!paused) offset = (offset + SPEED * dt) % gw;
        track.style.transform = "translateX(" + -offset + "px)";
      }
      last = now;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    track.addEventListener("mouseenter", () => (paused = true));
    track.addEventListener("mouseleave", () => (paused = false));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupMobileNav();
  setupSorting();
  setupContactForm();
  setupSmoothScroll();
  setupPartners();
  highlightActiveLink();
});
