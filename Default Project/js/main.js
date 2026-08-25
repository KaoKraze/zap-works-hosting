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

document.addEventListener("DOMContentLoaded", () => {
  setupMobileNav();
  setupSorting();
  setupContactForm();
  highlightActiveLink();
});
