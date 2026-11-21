// =========================================================================
// Zap Works — shared interactions (no dependencies)
// header state · mobile menu · partner marquee · contact form · transitions
// =========================================================================
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- header
  function setupHeader() {
    var header = document.getElementById("siteHeader");
    if (!header) return;
    var lastY = window.scrollY;
    var ticking = false;

    function update() {
      var y = window.scrollY;
      header.classList.toggle("is-scrolled", y > 12);
      // hide on scroll down, show on scroll up (never while the menu is open)
      var hide = y > 480 && y > lastY + 2 && !document.documentElement.classList.contains("menu-open");
      if (y < lastY - 2 || y < 480) hide = false;
      if (Math.abs(y - lastY) > 2) {
        header.classList.toggle("is-hidden", hide);
        document.documentElement.classList.toggle("header-hidden", hide);
      }
      lastY = y;
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    header.addEventListener("focusin", function () {
      header.classList.remove("is-hidden");
      document.documentElement.classList.remove("header-hidden");
    });
    update();
  }

  // ----------------------------------------------------------- mobile menu
  function setupMenu() {
    var toggle = document.getElementById("navToggle");
    var menu = document.getElementById("mobileMenu");
    if (!toggle || !menu) return;
    var root = document.documentElement;
    var main = document.getElementById("main");
    var footer = document.querySelector(".site-footer");

    function setOpen(open) {
      root.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      menu.setAttribute("aria-hidden", String(!open));
      [main, footer].forEach(function (el) {
        if (!el) return;
        if (open) el.setAttribute("inert", ""); else el.removeAttribute("inert");
      });
      if (window.__zapLenis) open ? window.__zapLenis.stop() : window.__zapLenis.start();
      if (open) {
        var first = menu.querySelector("a");
        if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 60);
        document.dispatchEvent(new CustomEvent("zap:menu", { detail: { open: true } }));
      } else {
        document.dispatchEvent(new CustomEvent("zap:menu", { detail: { open: false } }));
      }
    }

    toggle.addEventListener("click", function () {
      setOpen(!root.classList.contains("menu-open"));
    });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && root.classList.contains("menu-open")) {
        setOpen(false);
        toggle.focus();
      }
      // keep focus inside the open menu (toggle button + menu links)
      if (e.key === "Tab" && root.classList.contains("menu-open")) {
        var items = [toggle].concat(Array.prototype.slice.call(menu.querySelectorAll("a, button")));
        var i = items.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    });
    window.matchMedia("(min-width: 1025px)").addEventListener("change", function (mq) {
      if (mq.matches) setOpen(false);
    });
  }

  // ------------------------------------------------------- partner marquee
  // mode: "mono" = white silhouette (line-art logos), "gray" = grayscale (badge logos)
  var PARTNERS = [
    { name: "Shelby", file: "shelby", mode: "mono" },
    { name: "Ferrari", file: "ferrari", mode: "gray", size: "tall" },
    { name: "Aston Martin", file: "aston-martin", mode: "mono" },
    { name: "Lamborghini", file: "lamborghini", mode: "gray", size: "tall" },
    { name: "Porsche", file: "porsche", mode: "gray", size: "tall" },
    { name: "Ford", file: "ford", mode: "gray" },
    { name: "Chevrolet", file: "chevrolet", mode: "mono" },
    { name: "Pagani", file: "pagani", mode: "mono", size: "wide" },
    { name: "Audi", file: "audi", mode: "mono" },
    { name: "Volkswagen", file: "volkswagen", mode: "mono" },
    { name: "Mazda", file: "mazda", mode: "mono" },
    { name: "Lotus", file: "lotus", mode: "gray" },
    { name: "Zenvo", file: "zenvo", mode: "mono" },
    { name: "KTM", file: "ktm", mode: "mono", size: "wide" },
    { name: "ABT", file: "abt", mode: "mono", size: "wide" },
    { name: "NFL", file: "nfl", mode: "gray", size: "tall" },
    { name: "FIFA", file: "fifa", mode: "mono", size: "wide" },
    { name: "Nickelodeon", file: "nickelodeon", mode: "mono" },
    { name: "Monster Jam", file: "monster-jam", mode: "gray", size: "tall" },
    { name: "Old Navy", file: "old-navy", mode: "gray", size: "wide" },
    { name: "Roblox", file: "roblox", mode: "mono", size: "wide" },
    { name: "Victoria", file: "victoria", mode: "gray", size: "tall" },
    { name: "Crest", file: "crest", mode: "mono", size: "tall" },
    { name: "Maris", file: "maris", mode: "mono", size: "tall" },
    { name: "Indigo", file: "indigo", mode: "gray" }
  ];
  window.ZAP_PARTNERS = PARTNERS;

  function setupPartners() {
    var rows = document.querySelectorAll("[data-partners]");
    if (!rows.length) return;
    var half = Math.ceil(PARTNERS.length / 2);
    var sets = { a: PARTNERS.slice(0, half), b: PARTNERS.slice(half) };

    function logoHTML(p) {
      return '<li class="logo logo--' + p.mode + (p.size ? " logo--" + p.size : "") + '">' +
        '<img src="/images/logos/' + p.file + '.webp" alt="' + p.name + '" decoding="async" /></li>';
    }

    rows.forEach(function (row) {
      var list = sets[row.getAttribute("data-partners")] || PARTNERS;
      var one = list.map(logoHTML).join("");
      var copies = 0;
      // Each track must be at least as wide as the row, or a gap opens at the end of the
      // loop on wide screens. Repeat the logo set until it is, and re-check once the logos
      // have loaded (their widths aren't known before that) and when the window resizes.
      function fill() {
        if (!copies) {
          row.innerHTML = '<ul class="marquee__track" role="list">' + one + "</ul>";
          copies = 1;
        }
        var track = row.firstElementChild;
        var setW = track.scrollWidth / copies;
        if (!setW) return;
        var need = Math.max(1, Math.ceil((row.clientWidth + 1) / setW));
        if (need !== copies || row.children.length < 2) {
          var extra = "";
          for (var i = 1; i < need; i++) extra += one.replace(/<li /g, '<li aria-hidden="true" ');
          // one labelled list for assistive tech + a visual duplicate for a seamless loop
          row.innerHTML =
            '<ul class="marquee__track" role="list">' + one + extra + "</ul>" +
            '<ul class="marquee__track" aria-hidden="true">' + one + extra + "</ul>";
          copies = need;
          row.querySelectorAll("img").forEach(function (img) {
            if (!img.complete) img.addEventListener("load", schedule, { once: true });
          });
        }
        // pace the loop by content width so both rows move at the same speed
        row.style.setProperty("--dur", Math.round(row.firstElementChild.scrollWidth / 45) + "s");
      }
      var pending = 0;
      function schedule() { cancelAnimationFrame(pending); pending = requestAnimationFrame(fill); }
      fill();
      row.querySelectorAll("img").forEach(function (img) {
        if (!img.complete) img.addEventListener("load", schedule, { once: true });
      });
      window.addEventListener("resize", schedule);
    });
  }

  // ---------------------------------------------------------- contact form
  var CONTACT_EMAIL = "zapworks@outlook.com";
  var SUBJECT_ALIASES = {
    acquisition: "Selling a game or group",
    join: "Join the team",
    business: "Business / Sponsorship",
    partnership: "Partnership"
  };

  function setupContactForm() {
    var form = document.getElementById("contactForm");
    if (!form) return;
    var status = document.getElementById("formStatus");
    var fields = {
      name: form.querySelector("#name"),
      email: form.querySelector("#email"),
      subject: form.querySelector("#subject"),
      message: form.querySelector("#message"),
      age: form.querySelector("#age13")
    };

    // prefill from links like /contact?subject=join&role=Game%20Developer
    var params = new URLSearchParams(location.search);
    var subj = params.get("subject");
    if (subj) {
      var wanted = SUBJECT_ALIASES[subj] || subj;
      Array.prototype.forEach.call(fields.subject.options, function (o) {
        if (o.value === wanted) fields.subject.value = wanted;
      });
    }
    var role = params.get("role");
    if (role && !fields.message.value) {
      fields.message.value = "Role: " + role.slice(0, 80) + "\n\n";
    }

    function setError(input, msg) {
      var wrap = input.closest(".field");
      var err = document.getElementById(input.id + "-err");
      if (wrap) wrap.classList.toggle("is-invalid", !!msg);
      input.setAttribute("aria-invalid", msg ? "true" : "false");
      if (err) err.textContent = msg || "";
    }

    function validate() {
      var ok = true;
      var first = null;
      var name = fields.name.value.trim();
      var email = fields.email.value.trim();
      var msg = fields.message.value.trim();
      if (!name) { setError(fields.name, "Please tell us who you are."); ok = false; first = first || fields.name; }
      else setError(fields.name, "");
      if (!email) { setError(fields.email, "We need an email to reply to."); ok = false; first = first || fields.email; }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setError(fields.email, "That email doesn't look right."); ok = false; first = first || fields.email; }
      else setError(fields.email, "");
      if (msg.length < 10) { setError(fields.message, "Add a little more detail (at least 10 characters)."); ok = false; first = first || fields.message; }
      else setError(fields.message, "");
      if (fields.age && !fields.age.checked) { setError(fields.age, "You need to be 13 or older to contact us."); ok = false; first = first || fields.age; }
      else if (fields.age) setError(fields.age, "");
      if (first) first.focus();
      return ok;
    }

    if (fields.age) fields.age.addEventListener("change", function () { if (fields.age.checked) setError(fields.age, ""); });
    ["name", "email", "message"].forEach(function (k) {
      fields[k].addEventListener("input", function () {
        if (fields[k].getAttribute("aria-invalid") === "true") setError(fields[k], "");
      });
    });

    var submitBtn = form.querySelector('button[type="submit"]');
    var trap = form.querySelector('input[name="website"]');

    function openMail(prefix) {
      var name = fields.name.value.trim();
      var body = "Name: " + name + "\nEmail: " + fields.email.value.trim() + "\n\n" + fields.message.value.trim();
      window.location.href = "mailto:" + CONTACT_EMAIL +
        "?subject=" + encodeURIComponent("[Zap Works] " + fields.subject.value) +
        "&body=" + encodeURIComponent(body);
      status.className = "form__status";
      status.textContent = prefix + " Your email app should open with the message ready — or email us at " + CONTACT_EMAIL + ".";
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!validate()) {
        status.className = "form__status";
        status.textContent = "Please fix the highlighted fields.";
        return;
      }
      if (form.getAttribute("aria-busy") === "true") return;
      form.setAttribute("aria-busy", "true");
      if (submitBtn) submitBtn.disabled = true;
      status.className = "form__status";
      status.textContent = "Sending…";

      fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fields.name.value.trim(),
          email: fields.email.value.trim(),
          subject: fields.subject.value,
          message: fields.message.value.trim(),
          page: location.pathname,
          age13: !!(fields.age && fields.age.checked),
          website: trap ? trap.value : ""
        })
      })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; }); })
        .then(function (res) {
          if (res.status === 200 && res.data.ok) {
            status.className = "form__status ok";
            status.textContent = "Message sent. We'll get back to you soon.";
            fields.message.value = "";
          } else if (res.status === 429) {
            status.className = "form__status";
            status.textContent = "Too many messages in a short time. Please try again in a few minutes.";
          } else if (res.status === 422) {
            status.className = "form__status";
            status.textContent = "Please check your details and try again.";
          } else {
            openMail("We couldn't send that directly.");
          }
        })
        .catch(function () { openMail("We couldn't send that directly."); })
        .then(function () {
          form.removeAttribute("aria-busy");
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }

  // ---------------------------------------------------- page transitions
  function setupTransitions() {
    if (reduceMotion) return;
    var veil = document.createElement("div");
    veil.className = "veil";
    veil.setAttribute("aria-hidden", "true");
    document.body.appendChild(veil);

    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page / anchor
      e.preventDefault();
      veil.classList.add("is-on");
      setTimeout(function () { location.href = url.href; }, 240);
    });
    window.addEventListener("pageshow", function () { veil.classList.remove("is-on"); });
  }

  // -------------------------------------------------------------- misc
  function setupYear() {
    var y = String(new Date().getFullYear());
    document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = y; });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupHeader();
    setupMenu();
    setupPartners();
    setupContactForm();
    setupTransitions();
    setupYear();
  });
})();
