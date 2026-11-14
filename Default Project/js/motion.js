// =========================================================================
// Zap Works — motion layer
// GSAP 3 (ScrollTrigger + SplitText) and Lenis smooth scrolling.
// Progressive enhancement: everything is readable without this file.
//  - html.motion is set in <head> only when prefers-reduced-motion is off
//  - Lenis runs only for fine pointers (mouse/trackpad); touch keeps native scroll
//  - Lenis is driven by GSAP's ticker, and ScrollTrigger listens to Lenis,
//    so both share one animation loop and never fight over the scroll position
// =========================================================================
(function () {
  "use strict";

  var root = document.documentElement;
  var gsap = window.gsap;
  var motionOK = root.classList.contains("motion");

  function bail() {
    root.classList.remove("motion");
    window.__zapMotion = true;
  }

  function init() {
    if (!motionOK) { window.__zapMotion = true; return; }
    if (!gsap || !window.ScrollTrigger) { bail(); return; }
    var ScrollTrigger = window.ScrollTrigger;
    var SplitText = window.SplitText;
    gsap.registerPlugin(ScrollTrigger);
    if (SplitText) gsap.registerPlugin(SplitText);
    window.__zapMotion = true;
    gsap.defaults({ ease: "power3.out", duration: 0.9 });

    // ------------------------------------------------------------- Lenis
    var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (window.Lenis && finePointer) {
      var lenis = new window.Lenis({
        lerp: 0.11,
        wheelMultiplier: 1,
        smoothWheel: true,
        anchors: { offset: -88 }
      });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
      gsap.ticker.lagSmoothing(0);
      window.__zapLenis = lenis;
      // a hash in the URL on arrival (e.g. /about#acquisition)
      if (location.hash) {
        var target = document.querySelector(location.hash);
        if (target) setTimeout(function () { lenis.scrollTo(target, { offset: -88, immediate: true }); }, 50);
      }
    }

    // ------------------------------------------------------ reveal helpers
    var heroEls = gsap.utils.toArray(".hero [data-reveal], .page-hero [data-reveal], .notfound [data-reveal]");
    var restEls = gsap.utils.toArray("[data-reveal]").filter(function (el) { return heroEls.indexOf(el) === -1; });

    gsap.set(restEls, { opacity: 0, y: 28 });
    ScrollTrigger.batch(restEls, {
      start: "top 90%",
      once: true,
      onEnter: function (batch) {
        gsap.to(batch, { opacity: 1, y: 0, duration: 1, stagger: 0.08, overwrite: true, clearProps: "transform" });
      }
    });

    // keyboard users: anything that receives focus is revealed immediately
    document.addEventListener("focusin", function (e) {
      var el = e.target.closest && e.target.closest("[data-reveal], .gcard, .rank");
      if (el && parseFloat(getComputedStyle(el).opacity) < 1) gsap.to(el, { opacity: 1, y: 0, x: 0, duration: 0.3, overwrite: true });
    });

    // split headings: line-by-line rise from a mask
    function splitHeading(el, delay, immediate) {
      if (!SplitText) { el.classList.add("split-ready"); return null; }
      var tween;
      SplitText.create(el, {
        type: "lines",
        mask: "lines",
        linesClass: "split-line",
        autoSplit: true,
        onSplit: function (self) {
          el.classList.add("split-ready");
          if (tween) { tween.progress(1); return; } // re-split on resize: no replay
          tween = gsap.from(self.lines, {
            yPercent: 112,
            duration: 1.15,
            ease: "expo.out",
            stagger: 0.09,
            delay: delay || 0,
            scrollTrigger: immediate ? null : { trigger: el, start: "top 88%", once: true }
          });
          return tween;
        }
      });
      return tween;
    }

    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(function () {
      // intro sequence for whatever hero is on this page
      var heroTitle = document.querySelector(".hero [data-split], .page-hero [data-split], .notfound [data-split]");
      if (heroTitle) splitHeading(heroTitle, 0.12, true);
      gsap.set(heroEls, { opacity: 0, y: 22 });
      gsap.to(heroEls, { opacity: 1, y: 0, duration: 1.1, stagger: 0.09, delay: 0.32, ease: "expo.out", clearProps: "transform" });

      gsap.utils.toArray("[data-split]").forEach(function (el) {
        if (el !== heroTitle) splitHeading(el, 0, false);
      });
      ScrollTrigger.refresh();
    });

    // ------------------------------------------------------ scroll effects
    var mm = gsap.matchMedia();
    mm.add("(min-width: 761px)", function () {
      var wall = document.getElementById("heroWall");
      if (wall) {
        gsap.to(wall, {
          yPercent: -10,
          ease: "none",
          scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true }
        });
      }
      gsap.utils.toArray(".hero .hero__inner").forEach(function (el) {
        gsap.to(el, {
          yPercent: -14,
          opacity: 0.2,
          ease: "none",
          scrollTrigger: { trigger: ".hero", start: "60% 55%", end: "bottom top", scrub: true }
        });
      });
      var mark = document.querySelector(".footer-mark");
      if (mark) {
        gsap.from(mark, {
          yPercent: 55,
          ease: "none",
          scrollTrigger: { trigger: ".site-footer", start: "top bottom", end: "bottom bottom", scrub: true }
        });
      }
    });

    // capability rows: underline draws in as each row enters
    gsap.utils.toArray(".cap, .role").forEach(function (row) {
      ScrollTrigger.create({
        trigger: row,
        start: "top 85%",
        once: true,
        onEnter: function () { row.classList.add("is-in"); }
      });
    });

    // ------------------------------------------- live-data driven moments
    document.addEventListener("zap:feature", function () {
      var img = document.querySelector("#featureCard .feature__media img");
      if (img) gsap.fromTo(img, { opacity: 0.2, scale: 1.05 }, { opacity: 1, scale: 1, duration: 0.7, ease: "expo.out", clearProps: "transform" });
    });

    var gridShown = false;
    document.addEventListener("zap:grid", function () {
      var cards = gsap.utils.toArray("#experiencesGrid .gcard:not([hidden]), #experiencesList .gcard:not([hidden])");
      if (!gridShown) {
        gridShown = true;
        gsap.set(cards, { opacity: 0, y: 24 });
        ScrollTrigger.batch(cards, {
          start: "top 95%",
          once: true,
          onEnter: function (b) { gsap.to(b, { opacity: 1, y: 0, stagger: 0.05, duration: 0.8, overwrite: true, clearProps: "transform" }); }
        });
      } else {
        gsap.fromTo(cards.slice(0, 12), { opacity: 0, y: 12 }, { opacity: 1, y: 0, stagger: 0.025, duration: 0.5, overwrite: true, clearProps: "transform" });
        gsap.set(cards.slice(12), { opacity: 1, y: 0 });
      }
      ScrollTrigger.refresh();
    });

    var showcase = document.getElementById("rankList");
    if (showcase && "MutationObserver" in window) {
      var firstFill = true;
      new MutationObserver(function () {
        if (!firstFill) return;
        firstFill = false;
        var rows = showcase.querySelectorAll(".rank");
        gsap.from(rows, {
          opacity: 0, x: 18, stagger: 0.06, duration: 0.8, clearProps: "transform",
          scrollTrigger: { trigger: showcase, start: "top 88%", once: true }
        });
        ScrollTrigger.refresh();
      }).observe(showcase, { childList: true });
    }

    // menu link stagger
    document.addEventListener("zap:menu", function (e) {
      if (!e.detail.open) return;
      gsap.fromTo("#mobileMenu nav a", { y: 28, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.05, duration: 0.7, ease: "expo.out", delay: 0.05 });
    });

    window.addEventListener("load", function () { ScrollTrigger.refresh(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
