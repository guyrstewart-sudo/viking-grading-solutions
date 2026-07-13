/* ============================================================
   VIKING GRADING SOLUTIONS — main.js
   Site interactions. Everything here is progressive enhancement:
   the site is fully readable and navigable with JS disabled.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- sticky header state ---------- */
  var head = document.querySelector(".site-head");
  var docEl = document.documentElement;
  function onScroll() {
    if (head) head.classList.toggle("is-scrolled", window.scrollY > 24);
    // Side-rail cascade: hidden over the hero, revealed once you scroll into
    // the next section (~60% of a viewport down). No-op on pages without rails.
    docEl.classList.toggle("rails-visible", window.scrollY > window.innerHeight * 0.6);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- mobile nav ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        document.body.style.overflow = "";
      }
    });
  }

  /* ---------- reveal on scroll (only if IO exists — content is
     visible by default; we pre-hide AFTER confirming we can reveal) ---------- */
  if ("IntersectionObserver" in window &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.documentElement.classList.add("rv-init");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("rv-in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    document.querySelectorAll(".rv").forEach(function (el) { io.observe(el); });
  }

  /* ---------- gallery filters ---------- */
  var filterWrap = document.querySelector(".filters");
  if (filterWrap) {
    var cards = document.querySelectorAll("[data-cat]");
    filterWrap.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-filter]");
      if (!btn) return;
      filterWrap.querySelectorAll("button").forEach(function (b) {
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      var f = btn.getAttribute("data-filter");
      cards.forEach(function (c) {
        var show = (f === "all" || c.getAttribute("data-cat") === f);
        c.style.display = show ? "" : "none";
        // A card revealed by the filter may never have been scrolled into
        // view, so it's still pre-hidden by .rv (opacity:0). Force it visible
        // with inline styles (which beat the stylesheet) so filtering never
        // leaves a blank gap in the masonry.
        if (show) {
          c.classList.add("rv-in");
          c.style.opacity = "1";
          c.style.transform = "none";
        }
      });
    });
  }

  /* ---------- before/after slider ---------- */
  document.querySelectorAll(".ba").forEach(function (ba) {
    var range = ba.querySelector("input[type=range]");
    var after = ba.querySelector(".after-wrap");
    var handle = ba.querySelector(".ba-handle");
    if (!range || !after || !handle) return;
    function setPos(v) {
      after.style.clipPath = "inset(0 0 0 " + v + "%)";
      handle.style.left = v + "%";
    }
    range.addEventListener("input", function () { setPos(range.value); });
    setPos(range.value);
  });

  /* ---------- estimate form ----------
     The form ships un-wired (no backend on a static site). Until the
     FormSubmit endpoint is activated (see docs/stripe-square-booking-setup.md),
     submissions show a friendly interim notice instead of failing silently. */
  var form = document.getElementById("estimate-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      if (form.getAttribute("action").indexOf("{{") !== -1) {
        e.preventDefault();
        var note = document.getElementById("form-pending");
        if (note) {
          note.hidden = false;
          note.scrollIntoView({ block: "nearest" });
        }
      }
    });
  }

  /* ---------- current year ---------- */
  var yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();
})();
