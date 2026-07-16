/* ============================================================
   VIKING GRADING SOLUTIONS — main.js
   Site interactions. Everything here is progressive enhancement:
   the site is fully readable and navigable with JS disabled.
   ============================================================ */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- sticky header state ---------- */
  var head = document.querySelector(".site-head");
  var docEl = document.documentElement;

  /* Side-rail tiles ship with data-bg instead of background-image so their
     ~4MB of decorative photos never downloads unless the rails can actually
     show (ultrawide viewport) AND the visitor scrolls past the hero. */
  var railsLoaded = false;
  function loadRails() {
    if (railsLoaded || !window.matchMedia("(min-width: 2160px)").matches) return;
    railsLoaded = true;
    document.querySelectorAll(".side-rail [data-bg]").forEach(function (el) {
      el.style.backgroundImage = "url('" + el.getAttribute("data-bg") + "')";
    });
  }

  function onScroll() {
    if (head) head.classList.toggle("is-scrolled", window.scrollY > 24);
    // Side-rail cascade: hidden over the hero, revealed once you scroll into
    // the next section (~60% of a viewport down). No-op on pages without rails.
    var railsOn = window.scrollY > window.innerHeight * 0.6;
    docEl.classList.toggle("rails-visible", railsOn);
    if (railsOn) loadRails();
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- mobile nav (Escape closes; Tab stays inside; icon morphs
     via [aria-expanded] CSS; desktop resize force-unlocks body scroll) ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    var closeNav = function (returnFocus) {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      if (returnFocus) toggle.focus();
    };
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
      if (open) {
        var first = nav.querySelector("a");
        if (first) first.focus();
      }
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) closeNav(false);
    });
    document.addEventListener("keydown", function (e) {
      if (!nav.classList.contains("is-open")) return;
      if (e.key === "Escape") { closeNav(true); return; }
      if (e.key === "Tab") {
        var links = nav.querySelectorAll("a");
        if (!links.length) return;
        var first = links[0], last = links[links.length - 1];
        var inside = nav.contains(document.activeElement) || document.activeElement === toggle;
        if (!inside) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    var mqDesktop = window.matchMedia("(min-width: 1200px)");
    var onDesktop = function (e) { if (e.matches) closeNav(false); };
    mqDesktop.addEventListener ? mqDesktop.addEventListener("change", onDesktop)
                               : mqDesktop.addListener(onDesktop);
  }

  /* ---------- reveal on scroll (only if IO exists — content is
     visible by default; we pre-hide AFTER confirming we can reveal) ---------- */
  if ("IntersectionObserver" in window && !reduceMotion) {
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
    var read = ba.querySelector(".ba-read");
    if (!range || !after || !handle) return;
    function setPos(v) {
      after.style.clipPath = "inset(0 0 0 " + v + "%)";
      handle.style.left = v + "%";
      if (read) read.textContent = "◂ " + Math.round(v) + "% ▸";
    }
    range.addEventListener("input", function () { setPos(range.value); });
    setPos(range.value);
  });

  /* ---------- proof band count-up (markup ships the FINAL numbers;
     JS only animates from 0 when motion is welcome) ---------- */
  var proofNums = document.querySelectorAll(".proof .num [data-count]");
  if (proofNums.length && "IntersectionObserver" in window && !reduceMotion) {
    var pio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        pio.unobserve(en.target);
        var target = parseInt(en.target.getAttribute("data-count"), 10);
        var t0 = null;
        function tick(now) {
          if (!t0) t0 = now;
          var p = Math.min((now - t0) / 900, 1);
          p = 1 - Math.pow(1 - p, 3);
          en.target.textContent = Math.round(target * p);
          if (p < 1) requestAnimationFrame(tick);
        }
        en.target.textContent = "0";
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.5 });
    proofNums.forEach(function (n) { pio.observe(n); });
  }

  /* ---------- sticky mobile action bar (progressive enhancement;
     hidden while the estimate form itself is on screen) ---------- */
  if (!document.querySelector(".mobile-cta")) {
    var bar = document.createElement("div");
    bar.className = "mobile-cta";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Quick actions");
    bar.innerHTML =
      '<a class="btn btn-primary" href="book.html#estimate-form">Get an estimate</a>' +
      '<a class="btn btn-ghost" href="gallery.html">See our work</a>';
    document.body.appendChild(bar);
    document.body.classList.add("has-mobile-cta");
    var formEl = document.getElementById("estimate-form");
    if (formEl && "IntersectionObserver" in window) {
      new IntersectionObserver(function (en) {
        bar.classList.toggle("is-hidden", en[0].isIntersecting);
      }, { threshold: 0.1 }).observe(formEl);
    }
  }

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

  /* ---------- gallery lightbox ----------
     Cards are caption-less <button class="frame lb-open"> elements. Clicking
     one enlarges the photo; clicking ANYWHERE (image included), the X, or
     Escape closes it. Focus returns to the card that opened it. */
  var lbButtons = document.querySelectorAll(".lb-open");
  if (lbButtons.length) {
    var lb = document.createElement("div");
    lb.className = "lightbox";
    lb.hidden = true;
    lb.setAttribute("role", "dialog");
    lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "Enlarged photo");
    lb.innerHTML =
      '<figure class="lb-frame">' +
      '<img alt="">' +
      '<button class="lb-close" type="button" aria-label="Close enlarged photo">×</button>' +
      '</figure>';
    document.body.appendChild(lb);
    var lbImg = lb.querySelector("img");
    var lbClose = lb.querySelector(".lb-close");
    var lbOpener = null;

    function openLb(btn) {
      var img = btn.querySelector("img");
      if (!img) return;
      var src = img.getAttribute("src") || "";
      lbImg.src = src.replace("-640.jpg", "-1200.jpg");
      lbImg.srcset = img.getAttribute("srcset") || "";
      lbImg.sizes = "92vw";
      lbImg.alt = img.alt || "";
      lbOpener = btn;
      lb.hidden = false;
      document.body.style.overflow = "hidden";
      lbClose.focus();
    }
    function closeLb() {
      lb.hidden = true;
      lbImg.src = ""; lbImg.srcset = "";
      document.body.style.overflow = "";
      if (lbOpener) { lbOpener.focus(); lbOpener = null; }
    }
    lbButtons.forEach(function (btn) {
      btn.addEventListener("click", function () { openLb(btn); });
    });
    lb.addEventListener("click", closeLb); // anywhere: backdrop, image, or X
    document.addEventListener("keydown", function (e) {
      if (!lb.hidden && (e.key === "Escape" || e.key === "Tab")) {
        if (e.key === "Tab") { e.preventDefault(); return; } // single-control dialog
        closeLb();
      }
    });
  }

  /* ---------- current year ---------- */
  var yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();
})();
